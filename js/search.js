// search.js · search.html: a single debounced query fanned out across
// posts, forum threads, and users, filtered by the active tab.

import { supabase } from './supabase.js';
import { qs, qsa, setState, debounce, escapeHtml, formatDate, sanitizeIlikeTerm } from './utils.js';
import { avatarImg, roleBadge } from './components.js';

const input = qs('#search-input');
const statusRegion = qs('#search-status');
const resultsEl = qs('#search-results');
const tabs = qsa('.tab-btn');

let activeFilter = 'all';

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    activeFilter = tab.dataset.filter;
    runSearch(input.value.trim());
  });
});

const runSearchDebounced = debounce((value) => runSearch(value), 350);
input?.addEventListener('input', () => runSearchDebounced(input.value.trim()));

async function runSearch(query) {
  if (!query) {
    setState(statusRegion, null);
    resultsEl.innerHTML = '';
    return;
  }

  setState(statusRegion, 'loading');
  const safeQuery = sanitizeIlikeTerm(query);
  if (!safeQuery) {
    setState(statusRegion, 'empty', 'No results found.');
    resultsEl.innerHTML = '';
    return;
  }
  const like = `%${safeQuery}%`;
  const tasks = [];

  if (activeFilter === 'all' || activeFilter === 'posts') {
    tasks.push(
      supabase
        .from('posts')
        .select('id, title, content, created_at')
        .or(`title.ilike.${like},content.ilike.${like}`)
        .limit(10)
        .then(({ data }) => ({ type: 'posts', data: data || [] }))
    );
  }
  if (activeFilter === 'all' || activeFilter === 'threads') {
    tasks.push(
      supabase
        .from('forum_threads')
        .select('id, title, created_at')
        .ilike('title', like)
        .limit(10)
        .then(({ data }) => ({ type: 'threads', data: data || [] }))
    );
  }
  if (activeFilter === 'all' || activeFilter === 'users') {
    tasks.push(
      supabase
        .from('profiles')
        .select('id, username, display_name, avatar_path, role')
        .or(`username.ilike.${like},display_name.ilike.${like}`)
        .limit(10)
        .then(({ data }) => ({ type: 'users', data: data || [] }))
    );
  }

  const results = await Promise.all(tasks);
  const totalCount = results.reduce((sum, r) => sum + r.data.length, 0);

  setState(statusRegion, null);
  if (totalCount === 0) {
    setState(statusRegion, 'empty', 'No results found.');
    resultsEl.innerHTML = '';
    return;
  }

  resultsEl.innerHTML = results.map(renderGroup).filter(Boolean).join('');
}

function renderGroup({ type, data }) {
  if (data.length === 0) return '';
  if (type === 'posts') {
    return `
      <div class="search-result-group">
        <h3>Posts</h3>
        ${data
          .map(
            (p) => `<p><a href="post.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title || p.content.slice(0, 60))}</a>
            <span class="muted-text"> · ${formatDate(p.created_at)}</span></p>`
          )
          .join('')}
      </div>`;
  }
  if (type === 'threads') {
    return `
      <div class="search-result-group">
        <h3>Threads</h3>
        ${data
          .map(
            (t) => `<p><a href="forum.html?id=${encodeURIComponent(t.id)}">${escapeHtml(t.title)}</a>
            <span class="muted-text"> · ${formatDate(t.created_at)}</span></p>`
          )
          .join('')}
      </div>`;
  }
  return `
    <div class="search-result-group">
      <h3>People</h3>
      ${data
        .map(
          (u) => `<p><a href="profile.html?user=${encodeURIComponent(u.username)}">${avatarImg(u, 24)} ${escapeHtml(
            u.display_name
          )} ${roleBadge(u.role)}</a></p>`
        )
        .join('')}
    </div>`;
}
