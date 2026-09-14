// moderation.js — thin wrappers around the secure RPC functions from
// 003_functions.sql / 005_moderation.sql. Every call still relies on the
// database to reject anything the caller isn't allowed to do; these wrappers
// only exist to keep the calling code in comments.js/forum.js/admin.js short.

import { supabase } from './supabase.js';

export async function submitReport(targetType, targetId, reason) {
  const { error } = await supabase.from('reports').insert({
    target_type: targetType,
    target_id: targetId,
    reason,
  });
  if (error) throw error;
}

export async function moderateContent(contentType, contentId, action, reason = null) {
  const { error } = await supabase.rpc('moderate_content', {
    content_type: contentType,
    content_id: contentId,
    action,
    mod_reason: reason,
  });
  if (error) throw error;
}

export async function promoteToModerator(userId) {
  const { error } = await supabase.rpc('promote_to_moderator', { target_user_id: userId });
  if (error) throw error;
}

export async function promoteToAdmin(userId) {
  const { error } = await supabase.rpc('promote_to_admin', { target_user_id: userId });
  if (error) throw error;
}

export async function demoteStaff(userId) {
  const { error } = await supabase.rpc('demote_staff', { target_user_id: userId });
  if (error) throw error;
}

export async function banUser(userId, reason = null) {
  const { error } = await supabase.rpc('ban_user', { target_user_id: userId, ban_reason: reason });
  if (error) throw error;
}

export async function unbanUser(userId) {
  const { error } = await supabase.rpc('unban_user', { target_user_id: userId });
  if (error) throw error;
}

export async function resolveReport(reportId, status, note = null) {
  const { error } = await supabase.rpc('resolve_report', {
    target_report_id: reportId,
    new_status: status,
    resolution_note: note,
  });
  if (error) throw error;
}

export async function markReportReviewing(reportId) {
  const { error } = await supabase.rpc('mark_report_reviewing', { target_report_id: reportId });
  if (error) throw error;
}

export async function deletePostWithAttachments(postId) {
  const { error } = await supabase.rpc('delete_post_with_attachments', { target_post_id: postId });
  if (error) throw error;
}
