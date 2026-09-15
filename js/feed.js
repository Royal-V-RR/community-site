// feed.js — powers index.html: featured posts + the main chronological feed.

import { supabase } from './supabase.js';
import { qs, setState, friendlyError, showToast } from './utils.js';
import { renderPostCard } from './components.js';
import { toggleReaction } from './reactions.js';
import { getSession } from './session.js';
import { submitReport } from './moderation.js';
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
  profiles:author_id ( id, username, display_name, avatar_path, role ),
  post_attachments ( id, storage_path, file_name, mime_type, display_order ),
  comment_count:comments(count),
  reaction_count:post_reactions(count)
`;

// Batches the "did I react to this?" lookup for a whole page of posts at
// once, instead of one query per card — the counts themselves already come
// back from POST_SELECT above.
async function withReactedState(posts) {
  const session = getSession();
  if (!session || posts.length === 0) return posts;
  const { data } = await supabase
    .from('post_reactions')
    .select('post_id')
    .eq('user_id', session.user.id)
    .eq('reaction_type', 'like')
    .in('post_id', posts.map((p) => p.id));
  const reacted = new Set((data || []).map((r) => r.post_id));
  return posts.map((p) => ({ ...p, reacted: reacted.has(p.id) }));
}

// Delegated click handling for the compact action row on every card — the
// like button toggles in place, the report button opens the same prompt
// flow post.html uses. Wired once per list container rather than per card.
function wireCardActions(container) {
  if (!container) return;
  container.addEventListener('click', async (event) => {
    const reactionBtn = event.target.closest('[data-role="reaction-btn"]');
    if (reactionBtn) {
      const card = reactionBtn.closest('.post-card');
      if (card) await toggleReaction(card.dataset.postId, card);
      return;
    }

    const reportBtn = event.target.closest('[data-action="report"]');
    if (reportBtn) {
      const postId = reportBtn.dataset.postId;
      if (!getSession()) {
        window.location.href = 'login.html?redirect=index.html';
        return;
      }
      const reason = window.prompt('Tell us what is wrong with this post:');
      if (!reason || !reason.trim()) return;
      try {
        await submitReport('post', postId, reason.trim());
        showToast('Report submitted. Thank you.', 'success');
      } catch (error) {
        showToast(friendlyError(error), 'error');
      }
    }
  });
}

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
  featuredList.innerHTML = (await withReactedState(data)).map(renderPostCard).join('');
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

  const posts = await withReactedState(data);
  feedList.insertAdjacentHTML('beforeend', posts.map(renderPostCard).join(''));

  if (data.length < PAGE_SIZE) {
    reachedEnd = true;
    loadMoreBtn.hidden = true;
  } else {
    loadMoreBtn.hidden = false;
    page += 1;
  }
}

loadMoreBtn?.addEventListener('click', () => loadFeed());
wireCardActions(feedList);
wireCardActions(featuredList);

loadFeatured();
loadFeed(true);
