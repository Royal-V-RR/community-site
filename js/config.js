// config.js — ONLY the public Supabase URL, the public anon/publishable key,
// and non-secret frontend configuration belong in this file. Never put a
// service role key, database password, or Owner password here.

export const SUPABASE_URL = 'https://vraozfkfkqncdshotint.supabase.co/rest/v1/';
export const SUPABASE_ANON_KEY = 'sb_publishable_JGWwNkFLA6ssGwb7KzkVJw_meL27aNB';

// Fallback client-side defaults; the real limits are read from
// public.site_settings (key = 'upload_limits') at runtime by uploads.js.
export const DEFAULT_UPLOAD_LIMITS = {
  maxFileSizeMb: 25,
  maxFilesPerPost: 10,
};

export const STORAGE_BUCKETS = {
  avatars: 'avatars',
  banners: 'banners',
  postAttachments: 'post-attachments',
};

export const OWNER_USERNAME = 'RoyalV-';

export const PAGE_SIZE = 20;
