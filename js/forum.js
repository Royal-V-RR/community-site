// forum.js · forum.html: a single thread with its replies. Staff can lock or
// unlock; locked threads reject new replies both here and via RLS.

import { supabase } from './supabase.js';
import { qs, qsa, setState, friendlyError, getUrlParam, escapeHtml, textToSafeHtml, formatDate, showToast } from './utils.js';
import { avatarImg, roleBadge, renderCommentItem } from './components.js';
import { getSession, isStaff, onSessionChange } from './session.js';
import { submitReport, moderateContent } from './moderation.js';

const threadId = getUrlParam('id');
const statusRegion = qs('#thread-status');
const article = qs('#thread-article');
const headerEl = qs('#thread-header');
const contentEl = qs('#thread-content');
const modActionsEl = qs('#thread-moderation-actions');
const lockToggleBtn = qs('#lock-toggle-btn');
const replyForm = qs('#reply-form');
const replyInput = qs('#reply-input');
const lockedNotice = qs('#locked-notice');
const repliesStatus = qs('#replies-status');
const repliesList = qs('#replies-list');
const reportBtn = qs('#thread-report-btn');

let currentThread = null;
const replyCache = new Map();

async function loadThread() {
  if (!threadId) {
    setState(statusRegion, 'error', 'No thread specified.');
    return;
  }
  setState(statusRegion, 'loading');

  const { data: thread, error } = await supabase
    .from('forum_threads')
    .select(`
      id, title, content, is_locked, is_pinned, created_at,
      profiles:author_id ( id, username, display_name, avatar_path, role )
    `)
    .eq('id', threadId)
    .single();

  if (error || !thread) {
    setState(statusRegion, 'error', 'This thread could not be found.');
    return;
  }

  currentThread = thread;
  setState(statusRegion, null);
  article.hidden = false;

  const author = thread.profiles || {};
  headerEl.innerHTML = `
    <h1>${escapeHtml(thread.title)}</h1>
    <div class="thread-item-header">
      ${avatarImg(author, 32)}
      <span class="author">${escapeHtml(author.display_name || author.username || 'Unknown')}</span>
      ${roleBadge(author.role)}
      <span class="timestamp">${formatDate(thread.created_at)}</span>
    </div>
  `;
  contentEl.innerHTML = textToSafeHtml(thread.content);

  updateModerationControls();
  updateReplyFormState();
  loadReplies();
}

function updateModerationControls() {
  if (!currentThread) return;
  const staff = isStaff();
  modActionsEl.hidden = !staff;
  if (staff) {
    lockToggleBtn.textContent = currentThread.is_locked ? 'Unlock Thread' : 'Lock Thread';
  }
}

function updateReplyFormState() {
  if (!currentThread) return;
  const locked = currentThread.is_locked;
  replyForm.hidden = locked;
  lockedNotice.hidden = !locked;
}

lockToggleBtn?.addEventListener('click', async () => {
  if (!currentThread) return;
  const action = currentThread.is_locked ? 'unlock' : 'lock';
  try {
    await moderateContent('forum_thread', currentThread.id, action);
    currentThread.is_locked = !currentThread.is_locked;
    updateModerationControls();
    updateReplyFormState();
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
});

async function loadReplies() {
  setState(repliesStatus, 'loading');

  const { data, error } = await supabase
    .from('forum_replies')
    .select(`
      id, content, author_id, created_at, deleted_at,
      profiles:author_id ( id, username, display_name, avatar_path, role )
    `)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) {
    setState(repliesStatus, 'error', friendlyError(error));
    return;
  }

  if (data.length === 0) {
    setState(repliesStatus, 'empty', 'No replies yet.');
    repliesList.innerHTML = '';
    return;
  }

  setState(repliesStatus, null);
  const session = getSession();
  const staff = isStaff();
  replyCache.clear();
  data.forEach((reply) => replyCache.set(reply.id, reply.content));
  repliesList.innerHTML = data
    .map((reply) =>
      renderCommentItem(reply, {
        canModerate: staff,
        isAuthor: session && reply.author_id === session.user.id,
      })
    )
    .join('');

  qsa('[data-action="delete-comment"]', repliesList).forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteReply(btn.dataset.id));
  });
  qsa('[data-action="edit-comment"]', repliesList).forEach((btn) => {
    btn.addEventListener('click', () => handleEditReply(btn.dataset.id));
  });
}

function handleEditReply(replyId) {
  const li = qs(`#comment-${replyId}`);
  const bodyEl = li.querySelector('[data-content]');
  const original = replyCache.get(replyId) ?? '';

  const textarea = document.createElement('textarea');
  textarea.value = original;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary btn-small';
  saveBtn.textContent = 'Save';

  bodyEl.replaceWith(textarea);
  textarea.insertAdjacentElement('afterend', saveBtn);
  textarea.focus();

  saveBtn.addEventListener('click', async () => {
    const newContent = textarea.value.trim();
    if (!newContent) return;
    try {
      const { error } = await supabase.from('forum_replies').update({ content: newContent }).eq('id', replyId);
      if (error) throw error;
      loadReplies();
    } catch (error) {
      showToast(friendlyError(error), 'error');
    }
  });
}

async function handleDeleteReply(replyId) {
  if (!window.confirm('Delete this reply?')) return;
  try {
    const li = qs(`#comment-${replyId}`);
    const isOwnReply = li?.querySelector('[data-action="edit-comment"]');
    if (isOwnReply) {
      const { error } = await supabase.from('forum_replies').delete().eq('id', replyId);
      if (error) throw error;
    } else {
      await moderateContent('forum_reply', replyId, 'delete');
    }
    loadReplies();
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
}

replyForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = replyInput.value.trim();
  if (!content) return;
  const session = getSession();
  if (!session) {
    window.location.href = `login.html?redirect=forum.html?id=${encodeURIComponent(threadId)}`;
    return;
  }
  const submitBtn = replyForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const { error } = await supabase.from('forum_replies').insert({
      thread_id: threadId,
      author_id: session.user.id,
      content,
    });
    if (error) throw error;
    replyInput.value = '';
    loadReplies();
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

reportBtn?.addEventListener('click', async () => {
  if (!currentThread) return;
  if (!getSession()) {
    window.location.href = `login.html?redirect=forum.html?id=${encodeURIComponent(threadId)}`;
    return;
  }
  const reason = window.prompt('Tell us what is wrong with this thread:');
  if (!reason || !reason.trim()) return;
  try {
    await submitReport('forum_thread', currentThread.id, reason.trim());
    showToast('Report submitted. Thank you.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
});

onSessionChange(() => {
  updateModerationControls();
});

loadThread();
