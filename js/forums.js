// forums.js — forums.html: lists threads in the single "General" forum and
// lets any active member start a new one.

import { supabase } from './supabase.js';
import { qs, setState, friendlyError } from './utils.js';
import { renderThreadListItem } from './components.js';
import { getSession } from './session.js';
import { PAGE_SIZE } from './config.js';

const newThreadBtn = qs('#new-thread-btn');
const newThreadForm = qs('#new-thread-form');
const newThreadStatus = qs('#new-thread-status');
const titleInput = qs('#thread-title-input');
const contentInput = qs('#thread-content-input');
const threadsStatus = qs('#threads-status');
const threadsList = qs('#threads-list');
const loadMoreBtn = qs('#threads-load-more');

let page = 0;
let reachedEnd = false;

const THREAD_SELECT = `
  id, title, is_locked, is_pinned, created_at,
  profiles:author_id ( id, username, display_name, avatar_path, role )
`;

newThreadBtn?.addEventListener('click', () => {
  if (!getSession()) {
    window.location.href = 'login.html?redirect=forums.html';
    return;
  }
  newThreadForm.hidden = !newThreadForm.hidden;
});

newThreadForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title || !content) return;

  const session = getSession();
  const submitBtn = newThreadForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  setState(newThreadStatus, 'loading');

  try {
    const { error } = await supabase.from('forum_threads').insert({
      author_id: session.user.id,
      title,
      content,
    });
    if (error) throw error;
    titleInput.value = '';
    contentInput.value = '';
    newThreadForm.hidden = true;
    setState(newThreadStatus, null);
    loadThreads(true);
  } catch (error) {
    setState(newThreadStatus, 'error', friendlyError(error));
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadThreads(reset = false) {
  if (reset) {
    page = 0;
    reachedEnd = false;
    threadsList.innerHTML = '';
  }
  if (reachedEnd) return;

  setState(threadsStatus, 'loading');
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('forum_threads')
    .select(THREAD_SELECT)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    setState(threadsStatus, 'error', friendlyError(error));
    return;
  }

  if (page === 0 && data.length === 0) {
    setState(threadsStatus, 'empty', 'No threads yet. Start the first one.');
    loadMoreBtn.hidden = true;
    return;
  }

  setState(threadsStatus, null);
  threadsList.insertAdjacentHTML('beforeend', data.map(renderThreadListItem).join(''));

  if (data.length < PAGE_SIZE) {
    reachedEnd = true;
    loadMoreBtn.hidden = true;
  } else {
    loadMoreBtn.hidden = false;
    page += 1;
  }
}

loadMoreBtn?.addEventListener('click', () => loadThreads());

loadThreads(true);
