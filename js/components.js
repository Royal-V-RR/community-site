// components.js · shared DOM-rendering helpers. Every function returns an
// HTML string built with escapeHtml() around any user-supplied text.

import { escapeHtml, textToSafeHtml, formatDate, formatFileSize, isSafeUrl } from './utils.js';
import { ICONS, smallIcon } from './icons.js';
import { renderReactionButton } from './reactions.js';

export function avatarImg(profile, size = 40) {
  const alt = escapeHtml(profile?.display_name || profile?.username || 'User');
  const src = profile?.avatar_path
    ? escapeHtml(profile.avatar_path)
    : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile?.display_name || profile?.username || '?')}`;
  return `<img class="avatar" style="width:${size}px;height:${size}px" src="${src}" alt="${alt}" loading="lazy">`;
}

export function roleBadge(role) {
  if (!role || role === 'MEMBER') return '';
  return `<span class="role-badge" data-role="${escapeHtml(role)}">${escapeHtml(role)}</span>`;
}

export function statusTag(status) {
  if (!status || status === 'ACTIVE') return '';
  return `<span class="admin-status-tag" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

const CARD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function renderCardThumbnail(attachments) {
  const sorted = (attachments || []).slice().sort((a, b) => a.display_order - b.display_order);
  const first = sorted[0];
  if (!first || !CARD_IMAGE_TYPES.includes(first.mime_type) || !isSafeUrl(first.storage_path)) return '';
  const src = escapeHtml(first.storage_path);
  const extra = sorted.length > 1 ? `<span class="post-card-thumb-count">+${sorted.length - 1}</span>` : '';
  return `<div class="post-card-thumb-wrap"><img class="post-card-thumb" src="${src}" alt="" loading="lazy">${extra}</div>`;
}

export function renderPostCard(post) {
  const author = post.profiles || {};
  const title = post.title ? `<h3 class="post-card-title">${escapeHtml(post.title)}</h3>` : '';
  const badges = [];
  if (post.is_pinned) badges.push('<span class="pill">Pinned</span>');
  if (post.is_featured) badges.push('<span class="pill">Featured</span>');
  const excerpt = (post.content || '').slice(0, 220);
  const commentCount = post.comment_count?.[0]?.count ?? 0;
  const reactionCount = post.reaction_count?.[0]?.count ?? 0;
  const postUrl = `post.html?id=${encodeURIComponent(post.id)}`;

  return `
    <article class="post-card" data-post-id="${post.id}">
      <a class="post-card-link" href="${postUrl}">
        <div class="post-card-header">
          ${avatarImg(author, 36)}
          <div class="post-card-meta">
            <span class="author">${escapeHtml(author.display_name || author.username || 'Unknown')}</span>
            <span class="timestamp">${formatDate(post.created_at)}</span>
          </div>
        </div>
        ${badges.length ? `<div class="post-card-badges">${badges.join('')}</div>` : ''}
        ${title}
        <div class="post-content">${textToSafeHtml(excerpt)}${post.content.length > 220 ? '…' : ''}</div>
        ${renderCardThumbnail(post.post_attachments)}
      </a>
      <div class="post-card-actions">
        <a class="post-card-action" href="${postUrl}#comment-input" aria-label="Comments">
          ${smallIcon('messageSquare')}<span>${commentCount}</span>
        </a>
        ${renderReactionButton({ count: reactionCount, reacted: Boolean(post.reacted) }, { compact: true })}
        <button type="button" class="post-card-action post-card-action-report" data-action="report" data-post-id="${post.id}" aria-label="Report">
          ${smallIcon('flag')}
        </button>
      </div>
    </article>
  `;
}

export function renderCommentItem(comment, { canModerate = false, isAuthor = false } = {}) {
  const author = comment.profiles || {};
  if (comment.deleted_at) {
    return `<li class="comment-item" id="comment-${comment.id}">
      <p class="comment-deleted">Comment removed.</p>
    </li>`;
  }
  const actions = [];
  if (isAuthor) {
    actions.push(`<button type="button" class="btn btn-link" data-action="edit-comment" data-id="${comment.id}">Edit</button>`);
  }
  if (isAuthor || canModerate) {
    actions.push(`<button type="button" class="btn btn-link" data-action="delete-comment" data-id="${comment.id}">Delete</button>`);
  }
  return `
    <li class="comment-item" id="comment-${comment.id}">
      <div class="comment-item-header">
        ${avatarImg(author, 28)}
        <span class="author">${escapeHtml(author.display_name || author.username || 'Unknown')}</span>
        ${roleBadge(author.role)}
        <span class="timestamp">${formatDate(comment.created_at)}</span>
      </div>
      <div class="comment-body" data-content>${textToSafeHtml(comment.content)}</div>
      ${actions.length ? `<div class="comment-item-actions">${actions.join('')}</div>` : ''}
    </li>
  `;
}

export function renderThreadListItem(thread) {
  const author = thread.profiles || {};
  const badges = [];
  if (thread.is_pinned) badges.push('<span class="pill">Pinned</span>');
  if (thread.is_locked) badges.push('<span class="pill">Locked</span>');
  return `
    <li class="thread-item">
      ${badges.length ? `<div class="thread-item-badges">${badges.join('')}</div>` : ''}
      <a href="forum.html?id=${encodeURIComponent(thread.id)}">${escapeHtml(thread.title)}</a>
      <div class="thread-item-header">
        ${avatarImg(author, 24)}
        <span class="author">${escapeHtml(author.display_name || author.username || 'Unknown')}</span>
        <span class="timestamp">${formatDate(thread.created_at)}</span>
      </div>
    </li>
  `;
}

export function renderNotificationItem(notification) {
  const href = notificationHref(notification);
  return `
    <li class="notification-item" data-id="${notification.id}" data-unread="${!notification.is_read}">
      <div>
        <p class="message">${escapeHtml(notification.message)}</p>
        <span class="timestamp">${formatDate(notification.created_at)}</span>
      </div>
      ${href ? `<a class="btn btn-link" href="${href}">View</a>` : ''}
    </li>
  `;
}

function notificationHref(notification) {
  if (notification.target_type === 'post' && notification.target_id) {
    return `post.html?id=${encodeURIComponent(notification.target_id)}`;
  }
  if (notification.target_type === 'forum_thread' && notification.target_id) {
    return `forum.html?id=${encodeURIComponent(notification.target_id)}`;
  }
  return '';
}

export function renderFileCard(attachment) {
  const name = escapeHtml(attachment.file_name);
  const size = attachment.file_size ? escapeHtml(formatFileSize(attachment.file_size)) : '';
  return `
    <div class="file-card">
      <span class="file-icon" aria-hidden="true">${ICONS.file}</span>
      <div class="file-meta">
        <div class="file-name">${name}</div>
        <div class="file-sub">${size}</div>
      </div>
      <a class="btn btn-secondary btn-small" href="${escapeHtml(attachment.storage_path)}" target="_blank" rel="noopener noreferrer">Open</a>
    </div>
  `;
}
