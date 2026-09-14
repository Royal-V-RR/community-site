// comments.js · the comment thread on post.html. Exported as initComments()
// so post.js can wire it up once the post itself has loaded.

import { supabase } from './supabase.js';
import { qs, qsa, setState, friendlyError, showToast } from './utils.js';
import { renderCommentItem } from './components.js';
import { getSession, isStaff, onSessionChange } from './session.js';
import { moderateContent } from './moderation.js';

const commentsSection = qs('#comments-section');
const commentForm = qs('#comment-form');
const commentInput = qs('#comment-input');
const commentsStatus = qs('#comments-status');
const commentsList = qs('#comments-list');

let activePostId = null;
const commentCache = new Map();

const COMMENT_SELECT = `
  id, content, author_id, created_at, deleted_at,
  profiles:author_id ( id, username, display_name, avatar_path, role )
`;

export function initComments(postId, allowComments) {
  activePostId = postId;
  if (!allowComments) {
    commentForm.hidden = true;
    const notice = document.createElement('p');
    notice.className = 'muted-text';
    notice.textContent = 'Comments are turned off for this post.';
    commentForm.insertAdjacentElement('afterend', notice);
  }
  loadComments();
}

async function loadComments() {
  if (!activePostId) return;
  setState(commentsStatus, 'loading');

  const { data, error } = await supabase
    .from('comments')
    .select(COMMENT_SELECT)
    .eq('post_id', activePostId)
    .order('created_at', { ascending: true });

  if (error) {
    setState(commentsStatus, 'error', friendlyError(error));
    return;
  }

  if (data.length === 0) {
    setState(commentsStatus, 'empty', 'No comments yet. Be the first to reply.');
    commentsList.innerHTML = '';
    return;
  }

  setState(commentsStatus, null);
  const session = getSession();
  const staff = isStaff();
  commentCache.clear();
  data.forEach((comment) => commentCache.set(comment.id, comment.content));
  commentsList.innerHTML = data
    .map((comment) =>
      renderCommentItem(comment, {
        canModerate: staff,
        isAuthor: session && comment.author_id === session.user.id,
      })
    )
    .join('');
  attachRowHandlers();
}

function attachRowHandlers() {
  qsa('[data-action="delete-comment"]', commentsList).forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
  qsa('[data-action="edit-comment"]', commentsList).forEach((btn) => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });
}

async function handleDelete(commentId) {
  if (!window.confirm('Delete this comment?')) return;
  try {
    const session = getSession();
    const li = qs(`#comment-${commentId}`);
    const isOwnComment = li?.querySelector('[data-action="edit-comment"]');
    if (isOwnComment) {
      const { error } = await supabase.from('comments').delete().eq('id', commentId);
      if (error) throw error;
    } else {
      await moderateContent('comment', commentId, 'delete');
    }
    loadComments();
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
}

function handleEdit(commentId) {
  const li = qs(`#comment-${commentId}`);
  const bodyEl = li.querySelector('[data-content]');
  const original = commentCache.get(commentId) ?? '';

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
      const { error } = await supabase.from('comments').update({ content: newContent }).eq('id', commentId);
      if (error) throw error;
      loadComments();
    } catch (error) {
      showToast(friendlyError(error), 'error');
    }
  });
}

commentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = commentInput.value.trim();
  if (!content) return;
  const session = getSession();
  if (!session) {
    window.location.href = `login.html?redirect=post.html?id=${encodeURIComponent(activePostId)}`;
    return;
  }
  const submitBtn = commentForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const { error } = await supabase.from('comments').insert({
      post_id: activePostId,
      author_id: session.user.id,
      content,
    });
    if (error) throw error;
    commentInput.value = '';
    loadComments();
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

onSessionChange(() => activePostId && loadComments());
