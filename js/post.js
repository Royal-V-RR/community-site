// post.js · post.html: loads one post, renders attachments/reactions, and
// wires up the comment thread (comments.js) plus Owner-only edit/delete and
// the report flow (moderation.js).

import { supabase } from './supabase.js';
import { qs, setState, friendlyError, getUrlParam, escapeHtml, textToSafeHtml, formatDate, showToast } from './utils.js';
import { avatarImg, roleBadge } from './components.js';
import { renderAttachmentGrid } from './attachments.js';
import { getReactionState, renderReactionButton, toggleReaction } from './reactions.js';
import { onSessionChange, getSession, isOwner } from './session.js';
import { submitReport, deletePostWithAttachments } from './moderation.js';
import { initComments } from './comments.js';
import { initPollVoting } from './poll.js';

const postId = getUrlParam('id');
const statusRegion = qs('#post-status');
const article = qs('#post-article');
const headerEl = qs('#post-header');
const contentEl = qs('#post-content');
const titleEl = qs('#post-title');
const attachmentsEl = qs('#post-attachments');
const pollEl = qs('#post-poll');
const reactionsEl = qs('#post-reactions');
const overflowBtn = qs('#post-overflow-btn');
const overflowMenu = qs('#post-overflow-menu');
const ownerActions = qs('#post-owner-actions');
const editLink = qs('#post-edit-link');
const deleteBtn = qs('#post-delete-btn');
const reportBtn = qs('#post-report-btn');
const commentInput = qs('#comment-input');

let currentPost = null;

async function loadPost() {
  if (!postId) {
    setState(statusRegion, 'error', 'No post specified.');
    return;
  }
  setState(statusRegion, 'loading');

  const { data: post, error } = await supabase
    .from('posts')
    .select(`
      id, title, content, allow_comments, allow_reactions, appearance_settings, created_at,
      profiles:author_id ( id, username, display_name, avatar_path, role )
    `)
    .eq('id', postId)
    .single();

  if (error || !post) {
    setState(statusRegion, 'error', 'This post could not be found.');
    return;
  }

  currentPost = post;
  setState(statusRegion, null);
  article.hidden = false;

  const author = post.profiles || {};
  headerEl.innerHTML = `
    ${avatarImg(author, 40)}
    <div>
      <a href="profile.html?user=${encodeURIComponent(author.username || '')}">${escapeHtml(author.display_name || author.username || 'Unknown')}</a>
      ${roleBadge(author.role)}
      <div class="timestamp muted-text">${formatDate(post.created_at)}</div>
    </div>
  `;
  contentEl.innerHTML = textToSafeHtml(post.content);

  const showTitle = post.appearance_settings?.show_title !== false;
  if (post.title && showTitle) {
    titleEl.textContent = post.title;
    titleEl.hidden = false;
  } else {
    titleEl.hidden = true;
  }

  applyAppearanceSettings(post.appearance_settings);

  const { data: attachments } = await supabase
    .from('post_attachments')
    .select('*')
    .eq('post_id', post.id)
    .order('display_order');
  attachmentsEl.innerHTML = renderAttachmentGrid(attachments || [], post.appearance_settings?.attachment_layout);

  initPollVoting(post.id, pollEl);

  if (post.allow_reactions) {
    const state = await getReactionState(post.id);
    reactionsEl.innerHTML = renderReactionButton(state);
    qs('#reaction-btn', reactionsEl).addEventListener('click', () => toggleReaction(post.id, reactionsEl));
  }

  initComments(post.id, post.allow_comments);
  updateOwnerControls();
}

function applyAppearanceSettings(settings) {
  if (!settings) return;
  if (settings.alignment === 'center') {
    article.style.textAlign = 'center';
  }
  if (settings.accent_color) {
    article.style.setProperty('--accent', settings.accent_color);
  }
  if (settings.image_size) {
    const sizeMap = { small: '160px', medium: '320px', large: '480px' };
    attachmentsEl.style.setProperty('--attachment-max-height', sizeMap[settings.image_size] || '320px');
  }
}

function updateOwnerControls() {
  if (!currentPost) return;
  const owner = isOwner();
  ownerActions.hidden = !owner;
  if (owner) {
    editLink.href = `create.html?id=${encodeURIComponent(currentPost.id)}`;
  }
}

overflowBtn?.addEventListener('click', () => {
  const isOpen = overflowBtn.getAttribute('aria-expanded') === 'true';
  overflowBtn.setAttribute('aria-expanded', String(!isOpen));
  overflowMenu.hidden = isOpen;
});

document.addEventListener('click', (event) => {
  if (overflowMenu.hidden) return;
  if (overflowMenu.contains(event.target) || overflowBtn.contains(event.target)) return;
  overflowMenu.hidden = true;
  overflowBtn.setAttribute('aria-expanded', 'false');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !overflowMenu.hidden) {
    overflowMenu.hidden = true;
    overflowBtn.setAttribute('aria-expanded', 'false');
    overflowBtn.focus();
  }
});

function closeOverflowMenu() {
  overflowMenu.hidden = true;
  overflowBtn.setAttribute('aria-expanded', 'false');
}

commentInput?.addEventListener('input', () => {
  commentInput.style.height = 'auto';
  commentInput.style.height = `${Math.min(commentInput.scrollHeight, 160)}px`;
});

deleteBtn?.addEventListener('click', async () => {
  if (!currentPost) return;
  closeOverflowMenu();
  if (!window.confirm('Delete this post? This cannot be undone.')) return;
  try {
    await deletePostWithAttachments(currentPost.id);
    window.location.href = 'index.html';
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
});

reportBtn?.addEventListener('click', async () => {
  if (!currentPost) return;
  closeOverflowMenu();
  if (!getSession()) {
    window.location.href = `login.html?redirect=post.html?id=${encodeURIComponent(currentPost.id)}`;
    return;
  }
  const reason = window.prompt('Tell us what is wrong with this post:');
  if (!reason || !reason.trim()) return;
  try {
    await submitReport('post', currentPost.id, reason.trim());
    showToast('Report submitted. Thank you.', 'success');
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
});

onSessionChange(() => updateOwnerControls());
loadPost();
