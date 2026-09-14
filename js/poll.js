// poll.js · two halves in one module: initPollEditor() builds the poll
// question/options/image UI inside create.html and exposes a way to collect
// that state for create.js to save; initPollVoting() renders and wires up
// voting on post.html.

import { supabase } from './supabase.js';
import { qs, qsa, escapeHtml, showToast, friendlyError } from './utils.js';
import { getSession, onSessionChange } from './session.js';
import { uploadPostAttachment } from './uploads.js';
import { ICONS } from './icons.js';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

// ---------------------------------------------------------------------------
// Editor (create.html)
// ---------------------------------------------------------------------------
let optionRowCount = 0;

export function initPollEditor({ toggleBtn, builder, optionsList, addOptionBtn, removeBtn, questionInput }) {
  toggleBtn?.addEventListener('click', () => {
    const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closePoll();
    } else {
      toggleBtn.setAttribute('aria-expanded', 'true');
      builder.hidden = false;
      if (optionsList.children.length === 0) {
        addOptionRow(optionsList);
        addOptionRow(optionsList);
      }
    }
  });

  function closePoll() {
    toggleBtn.setAttribute('aria-expanded', 'false');
    builder.hidden = true;
  }

  removeBtn?.addEventListener('click', () => {
    optionsList.innerHTML = '';
    questionInput.value = '';
    closePoll();
  });

  addOptionBtn?.addEventListener('click', () => addOptionRow(optionsList));
}

function addOptionRow(optionsList) {
  if (optionsList.children.length >= MAX_OPTIONS) {
    showToast(`Polls support up to ${MAX_OPTIONS} options.`, 'error');
    return;
  }
  optionRowCount += 1;
  const rowId = `poll-opt-${optionRowCount}-${Date.now()}`;
  const li = document.createElement('li');
  li.className = 'poll-option-row';
  li.dataset.rowId = rowId;
  li.innerHTML = `
    <label class="poll-option-image-label" for="${rowId}-image">
      ${ICONS.image}
      <span class="sr-only">Add an image for this option</span>
    </label>
    <input type="file" id="${rowId}-image" accept="image/png,image/jpeg,image/webp" data-poll-image>
    <input type="text" placeholder="Option text" data-poll-label maxlength="80">
    <button type="button" class="btn btn-link" data-remove-option aria-label="Remove option">${ICONS.close}</button>
  `;
  optionsList.appendChild(li);

  const imageInput = li.querySelector('[data-poll-image]');
  const imageLabel = li.querySelector('.poll-option-image-label');
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      imageLabel.innerHTML = `<img src="${reader.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  li.querySelector('[data-remove-option]').addEventListener('click', () => {
    if (optionsList.children.length <= MIN_OPTIONS) {
      showToast(`Polls need at least ${MIN_OPTIONS} options.`, 'error');
      return;
    }
    li.remove();
  });
}

/** Reads the current editor state. Returns null if no poll is being built. */
export function collectPollDraft({ builder, questionInput, optionsList, closesInput }) {
  if (builder.hidden) return null;
  const question = questionInput.value.trim();
  const rows = qsa('.poll-option-row', optionsList);
  const options = rows
    .map((row) => ({
      label: row.querySelector('[data-poll-label]').value.trim(),
      imageFile: row.querySelector('[data-poll-image]').files[0] || null,
    }))
    .filter((opt) => opt.label);

  if (!question || options.length < MIN_OPTIONS) return { invalid: true };

  return {
    question,
    options,
    closesAt: closesInput.value ? new Date(closesInput.value).toISOString() : null,
  };
}

/** Creates the poll + options rows for a freshly-created post, uploading any
 * option images to the same per-post storage folder as post attachments. */
export async function savePoll(postId, draft) {
  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({ post_id: postId, question: draft.question, closes_at: draft.closesAt })
    .select('id')
    .single();
  if (pollError) throw pollError;

  let order = 0;
  for (const option of draft.options) {
    let imagePath = null;
    if (option.imageFile) {
      const { publicUrl } = await uploadPostAttachment(postId, option.imageFile);
      imagePath = publicUrl;
    }
    const { error } = await supabase.from('poll_options').insert({
      poll_id: poll.id,
      label: option.label,
      image_path: imagePath,
      display_order: order,
    });
    if (error) throw error;
    order += 1;
  }
}

// ---------------------------------------------------------------------------
// Voting widget (post.html)
// ---------------------------------------------------------------------------
export async function initPollVoting(postId, container) {
  const { data: poll } = await supabase.from('polls').select('*').eq('post_id', postId).maybeSingle();
  if (!poll) return;

  await renderPoll(poll, container);
  onSessionChange(() => renderPoll(poll, container));
}

async function renderPoll(poll, container) {
  const { data: options } = await supabase
    .from('poll_options')
    .select('*')
    .eq('poll_id', poll.id)
    .order('display_order');
  const { data: votes } = await supabase.from('poll_votes').select('option_id, user_id').eq('poll_id', poll.id);

  const session = getSession();
  const totalVotes = votes?.length || 0;
  const myVote = session ? votes?.find((v) => v.user_id === session.user.id) : null;
  const isClosed = poll.closes_at && new Date(poll.closes_at) <= new Date();

  const counts = new Map();
  (votes || []).forEach((v) => counts.set(v.option_id, (counts.get(v.option_id) || 0) + 1));

  container.innerHTML = `
    <div class="poll-widget">
      <p class="poll-question">${escapeHtml(poll.question)}</p>
      <ul class="poll-option-list">
        ${(options || [])
          .map((opt) => {
            const count = counts.get(opt.id) || 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isMine = myVote && myVote.option_id === opt.id;
            return `
              <li>
                <button type="button" class="poll-option-btn" data-option-id="${opt.id}" aria-pressed="${Boolean(isMine)}">
                  <span class="poll-option-fill" style="--fill:${pct}%"></span>
                  ${opt.image_path ? `<img class="poll-option-thumb" src="${escapeHtml(opt.image_path)}" alt="">` : ''}
                  <span class="poll-option-label">${escapeHtml(opt.label)}</span>
                  <span class="poll-option-pct">${totalVotes > 0 ? `${pct}%` : ''}</span>
                </button>
              </li>
            `;
          })
          .join('')}
      </ul>
      <p class="poll-meta">
        ${totalVotes} vote${totalVotes === 1 ? '' : 's'}
        ${isClosed ? ' · Poll closed' : ''}
      </p>
    </div>
  `;

  if (isClosed) return;

  qsa('.poll-option-btn', container).forEach((btn) => {
    btn.addEventListener('click', () => handleVote(poll, btn.dataset.optionId, myVote, container));
  });
}

async function handleVote(poll, optionId, myVote, container) {
  const session = getSession();
  if (!session) {
    window.location.href = `login.html?redirect=post.html?id=${encodeURIComponent(poll.post_id)}`;
    return;
  }
  if (myVote && myVote.option_id === optionId) return; // already voted this option

  try {
    if (myVote) {
      const { error } = await supabase
        .from('poll_votes')
        .delete()
        .eq('poll_id', poll.id)
        .eq('user_id', session.user.id);
      if (error) throw error;
    }
    const { error } = await supabase
      .from('poll_votes')
      .insert({ poll_id: poll.id, option_id: optionId, user_id: session.user.id });
    if (error) throw error;
    renderPoll(poll, container);
  } catch (error) {
    showToast(friendlyError(error), 'error');
  }
}
