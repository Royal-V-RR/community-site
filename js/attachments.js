// attachments.js — safely renders post attachments. Unknown/unsupported
// types always render as a plain download link/file card, never inline
// executable content (no <script>, no <iframe> to arbitrary sources).

import { escapeHtml, isSafeUrl } from './utils.js';
import { renderFileCard } from './components.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg'];

export function renderAttachment(attachment) {
  if (!isSafeUrl(attachment.storage_path)) {
    return renderFileCard(attachment);
  }
  const src = escapeHtml(attachment.storage_path);
  const alt = escapeHtml(attachment.file_name || 'attachment');

  if (IMAGE_TYPES.includes(attachment.mime_type)) {
    return `<img class="attachment-media" src="${src}" alt="${alt}" loading="lazy">`;
  }
  if (VIDEO_TYPES.includes(attachment.mime_type)) {
    return `<video class="attachment-media" src="${src}" controls preload="metadata"></video>`;
  }
  if (AUDIO_TYPES.includes(attachment.mime_type)) {
    return `<audio src="${src}" controls style="width:100%"></audio>`;
  }
  return renderFileCard(attachment);
}

export function renderAttachmentGrid(attachments, layout = 'grid') {
  if (!attachments || attachments.length === 0) return '';
  const layoutClass = layout === 'stack' ? 'layout-stack' : '';
  return `<div class="attachment-grid ${layoutClass}">${attachments
    .sort((a, b) => a.display_order - b.display_order)
    .map(renderAttachment)
    .join('')}</div>`;
}
