// feed.js — powers index.html: featured posts + the main chronological feed.

import { supabase } from './supabase.js';
import { qs, setState, friendlyError } from './utils.js';
import { renderPostCard } from './components.js';
import { PAGE_SIZE } from './config.js';

const feedList = qs('#feed-list');
const feedStatus = qs('#feed-status');
const loadMoreBtn = qs('#feed-load-more');
const featuredSection = qs('#featured-section');
const featuredList = qs('#featured-list');

let page = 0;
let reachedEnd = false;

const POST_SELECT = `
  id, title, content, is_pinned, is_featured, created_at,
  profiles:author_id ( id, username, display_name, avatar_path, role )
`;

async function loadFeatured() {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .or('is_featured.eq.true,is_pinned.eq.true')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !data || data.length === 0) return;
  featuredSection.hidden = false;
  featuredList.innerHTML = data.map(renderPostCard).join('');
}

async function loadFeed(reset = false) {
  if (reset) {
    page = 0;
    reachedEnd = false;
    feedList.innerHTML = '';
  }
  if (reachedEnd) return;

  setState(feedStatus, 'loading');
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    setState(feedStatus, 'error', friendlyError(error));
    return;
  }

  setState(feedStatus, null);

  if (page === 0 && data.length === 0) {
    setState(feedStatus, 'empty', 'No posts yet.');
    loadMoreBtn.hidden = true;
    return;
  }

  feedList.insertAdjacentHTML('beforeend', data.map(renderPostCard).join(''));

  if (data.length < PAGE_SIZE) {
    reachedEnd = true;
    loadMoreBtn.hidden = true;
  } else {
    loadMoreBtn.hidden = false;
    page += 1;
  }
}

loadMoreBtn?.addEventListener('click', () => loadFeed());

loadFeatured();
loadFeed(true);
