// uploads.js — validates and uploads files to Supabase Storage. Storage
// bucket policies (created manually per README step 3) are the real
// enforcement; this module also checks limits client-side for fast, friendly
// feedback before spending the user's upload bandwidth.

import { supabase } from './supabase.js';
import { STORAGE_BUCKETS, DEFAULT_UPLOAD_LIMITS } from './config.js';

let cachedLimits = null;

export async function getUploadLimits() {
  if (cachedLimits) return cachedLimits;
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'upload_limits')
    .maybeSingle();
  if (error || !data) {
    cachedLimits = DEFAULT_UPLOAD_LIMITS;
  } else {
    cachedLimits = {
      maxFileSizeMb: data.value.max_file_size_mb ?? DEFAULT_UPLOAD_LIMITS.maxFileSizeMb,
      maxFilesPerPost: data.value.max_files_per_post ?? DEFAULT_UPLOAD_LIMITS.maxFilesPerPost,
    };
  }
  return cachedLimits;
}

export async function validateFiles(files) {
  const limits = await getUploadLimits();
  const errors = [];
  if (files.length > limits.maxFilesPerPost) {
    errors.push(`You can attach up to ${limits.maxFilesPerPost} files.`);
  }
  const maxBytes = limits.maxFileSizeMb * 1024 * 1024;
  for (const file of files) {
    if (file.size > maxBytes) {
      errors.push(`"${file.name}" is larger than ${limits.maxFileSizeMb} MB.`);
    }
  }
  return errors;
}

function safeFileName(originalName) {
  const ext = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : '';
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return ext ? `${stamp}-${random}.${ext}` : `${stamp}-${random}`;
}

export async function uploadAvatar(userId, file) {
  const path = `${userId}/${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKETS.avatars).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKETS.avatars).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadBanner(userId, file) {
  const path = `${userId}/${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKETS.banners).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKETS.banners).getPublicUrl(path);
  return data.publicUrl;
}

/** Uploads a post attachment. postId must already exist (create the post row
 * first, then attach files) so the storage path can be scoped per-post. */
export async function uploadPostAttachment(postId, file) {
  const path = `${postId}/${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKETS.postAttachments).upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKETS.postAttachments).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}
