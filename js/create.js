// create.js · create.html. Owner-only in practice (RLS enforces it server
// side); this module guards the UI and handles publish/edit + attachments.

import { supabase } from './supabase.js';
import { qs, qsa, setState, friendlyError, getUrlParam, escapeHtml, formatFileSize, showToast, textToSafeHtml } from './utils.js';
import { whenReady, isOwner, getSession } from './session.js';
import { validateFiles, uploadPostAttachment } from './uploads.js';
import { renderAttachmentGrid } from './attachments.js';
import { initPollEditor, collectPollDraft, savePoll } from './poll.js';

const statusRegion = qs('#create-status');
const form = qs('#create-form');
const titleInput = qs('#post-title-input');
const contentInput = qs('#post-content-input');
const filesInput = qs('#post-files-input');
const previewList = qs('#attachment-preview-list');
const publishBtn = qs('#publish-btn');
const cancelBtn = qs('#create-cancel-btn');
const previewBtn = qs('#preview-btn');
const previewPanel = qs('#preview-panel');
const previewContent = qs('#preview-content');
const advancedToggle = qs('#advanced-toggle');
const advancedPanel = qs('#advanced-panel');

const pollToggleBtn = qs('#poll-toggle-btn');
const pollBuilder = qs('#poll-builder');
const pollQuestionInput = qs('#poll-question-input');
const pollOptionsList = qs('#poll-options-list');
const pollAddOptionBtn = qs('#poll-add-option-btn');
const pollRemoveBtn = qs('#poll-remove-btn');
const pollClosesInput = qs('#poll-closes-input');

initPollEditor({
  toggleBtn: pollToggleBtn,
  builder: pollBuilder,
  optionsList: pollOptionsList,
  addOptionBtn: pollAddOptionBtn,
  removeBtn: pollRemoveBtn,
  questionInput: pollQuestionInput,
});

const editingPostId = getUrlParam('id');
let selectedFiles = [];
let existingAttachments = [];

advancedToggle?.addEventListener('click', () => {
  const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
  advancedToggle.setAttribute('aria-expanded', String(!expanded));
  advancedPanel.hidden = expanded;
});

filesInput?.addEventListener('change', () => {
  selectedFiles = Array.from(filesInput.files);
  renderPreviewList();
});

function renderPreviewList() {
  previewList.innerHTML = selectedFiles
    .map(
      (file, index) => `
      <li>
        <span>${escapeHtml(file.name)} · ${formatFileSize(file.size)}</span>
        <button type="button" class="btn btn-link" data-remove-index="${index}">Remove</button>
      </li>`
    )
    .join('');
  qsa('[data-remove-index]', previewList).forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedFiles.splice(Number(btn.dataset.removeIndex), 1);
      renderPreviewList();
    });
  });
}

previewBtn?.addEventListener('click', () => {
  previewPanel.hidden = !previewPanel.hidden;
  if (!previewPanel.hidden) {
    const title = titleInput.value.trim();
    previewContent.innerHTML = `
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      <div class="post-content">${textToSafeHtml(contentInput.value)}</div>
    `;
  }
});

function collectAppearanceSettings() {
  return {
    show_title: qs('#opt-show-title').checked,
    attachment_layout: qs('#opt-attachment-layout').value,
    image_size: qs('#opt-image-size').value,
    alignment: qs('#opt-alignment').value,
    accent_color: qs('#opt-accent').value,
  };
}

async function loadExistingPost() {
  const { data: post, error } = await supabase
    .from('posts')
    .select('*')
    .eq('id', editingPostId)
    .single();
  if (error || !post) {
    setState(statusRegion, 'error', 'Could not load that post to edit.');
    return;
  }
  titleInput.value = post.title || '';
  contentInput.value = post.content;
  qs('#opt-allow-comments').checked = post.allow_comments;
  qs('#opt-allow-reactions').checked = post.allow_reactions;
  qs('#opt-featured').checked = post.is_featured;
  qs('#opt-pinned').checked = post.is_pinned;
  qs('#opt-content-format').value = post.content_format;
  if (post.appearance_settings) {
    qs('#opt-attachment-layout').value = post.appearance_settings.attachment_layout || 'grid';
    qs('#opt-image-size').value = post.appearance_settings.image_size || 'medium';
    qs('#opt-alignment').value = post.appearance_settings.alignment || 'left';
    qs('#opt-accent').value = post.appearance_settings.accent_color || '#5b8def';
  }
  publishBtn.textContent = 'Save';
  if (pollToggleBtn) {
    pollToggleBtn.hidden = true;
    pollToggleBtn.title = 'Polls can only be added when a post is first created.';
  }

  const { data: attachments } = await supabase
    .from('post_attachments')
    .select('*')
    .eq('post_id', editingPostId)
    .order('display_order');
  existingAttachments = attachments || [];
  if (existingAttachments.length) {
    previewList.insertAdjacentHTML(
      'beforebegin',
      `<div class="attachment-grid">${renderAttachmentGrid(existingAttachments)}</div>`
    );
  }
}

async function publish() {
  const content = contentInput.value.trim();
  if (!content) {
    setState(statusRegion, 'error', 'Write something before publishing.');
    return;
  }

  const fileErrors = await validateFiles(selectedFiles);
  if (fileErrors.length) {
    setState(statusRegion, 'error', fileErrors.join(' '));
    return;
  }

  const pollDraft = collectPollDraft({
    builder: pollBuilder,
    questionInput: pollQuestionInput,
    optionsList: pollOptionsList,
    closesInput: pollClosesInput,
  });
  if (pollDraft?.invalid) {
    setState(statusRegion, 'error', 'A poll needs a question and at least two options.');
    return;
  }

  publishBtn.disabled = true;
  setState(statusRegion, 'loading', editingPostId ? 'Saving…' : 'Publishing…');

  const session = getSession();
  const payload = {
    author_id: session.user.id,
    title: titleInput.value.trim() || null,
    content,
    content_format: qs('#opt-content-format').value,
    allow_comments: qs('#opt-allow-comments').checked,
    allow_reactions: qs('#opt-allow-reactions').checked,
    is_featured: qs('#opt-featured').checked,
    is_pinned: qs('#opt-pinned').checked,
    appearance_settings: collectAppearanceSettings(),
  };

  try {
    let postId = editingPostId;
    if (editingPostId) {
      const { error } = await supabase.from('posts').update(payload).eq('id', editingPostId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('posts').insert(payload).select('id').single();
      if (error) throw error;
      postId = data.id;
    }

    if (selectedFiles.length > 0) {
      let order = existingAttachments.length;
      for (const file of selectedFiles) {
        const { publicUrl } = await uploadPostAttachment(postId, file);
        const { error: attachError } = await supabase.from('post_attachments').insert({
          post_id: postId,
          storage_path: publicUrl,
          file_name: file.name,
          mime_type: file.type,
          file_size: file.size,
          display_order: order,
        });
        if (attachError) throw attachError;
        order += 1;
      }
    }

    if (pollDraft && !editingPostId) {
      await savePoll(postId, pollDraft);
    }

    setState(statusRegion, null);
    window.location.href = `post.html?id=${encodeURIComponent(postId)}`;
  } catch (error) {
    setState(statusRegion, 'error', friendlyError(error));
  } finally {
    publishBtn.disabled = false;
  }
}

publishBtn?.addEventListener('click', publish);
cancelBtn?.addEventListener('click', () => {
  window.location.href = editingPostId ? `post.html?id=${encodeURIComponent(editingPostId)}` : 'index.html';
});
form?.addEventListener('submit', (event) => event.preventDefault());

whenReady().then(() => {
  if (!isOwner()) {
    setState(statusRegion, 'error', 'Only the Owner can create or edit posts.');
    form.hidden = true;
    publishBtn.hidden = true;
    return;
  }
  if (editingPostId) loadExistingPost();
});
