// reactions.js · like/react to a post. RLS still enforces the unique
// (post_id, user_id, reaction_type) constraint and the allow_reactions flag.
//
// Uses data-role attributes rather than ids so this same markup/logic works
// both for the single button on post.html and for many compact buttons at
// once in the feed (ids would collide once there's more than one on a page).

import { supabase } from './supabase.js';
import { getSession } from './session.js';
import { showToast, friendlyError } from './utils.js';
import { ICONS, smallIcon } from './icons.js';

const REACTION_TYPE = 'like';

export async function getReactionState(postId) {
  const session = getSession();
  const [{ count }, mine] = await Promise.all([
    supabase.from('post_reactions').select('id', { count: 'exact', head: true }).eq('post_id', postId),
    session
      ? supabase
          .from('post_reactions')
          .select('id')
          .eq('post_id', postId)
          .eq('user_id', session.user.id)
          .eq('reaction_type', REACTION_TYPE)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { count: count || 0, reacted: Boolean(mine.data) };
}

/** compact:true renders it as a small `.post-card-action` (feed cards);
 *  compact:false (default) renders the full-size `.reaction-btn` (post.html). */
export function renderReactionButton({ count, reacted }, { compact = false } = {}) {
  const cls = compact ? 'post-card-action' : 'reaction-btn';
  const icon = reacted
    ? (compact ? smallIcon('heartFilled') : ICONS.heartFilled)
    : (compact ? smallIcon('heartOutline') : ICONS.heartOutline);
  return `
    <button type="button" class="${cls}" data-role="reaction-btn" aria-pressed="${reacted}" aria-label="Like">
      <span data-role="reaction-icon" aria-hidden="true">${icon}</span>
      <span data-role="reaction-count">${count}</span>
    </button>
  `;
}

/** container must contain exactly one reaction button (scope it to a single
 *  post's markup — e.g. the post.html reactions region, or one feed card). */
export async function toggleReaction(postId, container) {
  const session = getSession();
  if (!session) {
    window.location.href = `login.html?redirect=post.html?id=${encodeURIComponent(postId)}`;
    return;
  }
  const btn = container.querySelector('[data-role="reaction-btn"]');
  const iconEl = container.querySelector('[data-role="reaction-icon"]');
  const countEl = container.querySelector('[data-role="reaction-count"]');
  const compact = btn.classList.contains('post-card-action');
  const wasReacted = btn.getAttribute('aria-pressed') === 'true';

  btn.setAttribute('aria-pressed', String(!wasReacted));
  iconEl.innerHTML = wasReacted
    ? (compact ? smallIcon('heartOutline') : ICONS.heartOutline)
    : (compact ? smallIcon('heartFilled') : ICONS.heartFilled);
  if (!wasReacted) {
    iconEl.classList.remove('reaction-icon-pop');
    void iconEl.offsetWidth; // restart the animation if clicked again quickly
    iconEl.classList.add('reaction-icon-pop');
  }
  countEl.textContent = String(Number(countEl.textContent) + (wasReacted ? -1 : 1));

  try {
    if (wasReacted) {
      const { error } = await supabase
        .from('post_reactions')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', session.user.id)
        .eq('reaction_type', REACTION_TYPE);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('post_reactions')
        .insert({ post_id: postId, user_id: session.user.id, reaction_type: REACTION_TYPE });
      if (error) throw error;
    }
  } catch (error) {
    // roll back optimistic update
    btn.setAttribute('aria-pressed', String(wasReacted));
    iconEl.innerHTML = wasReacted
      ? (compact ? smallIcon('heartFilled') : ICONS.heartFilled)
      : (compact ? smallIcon('heartOutline') : ICONS.heartOutline);
    countEl.textContent = String(Number(countEl.textContent) + (wasReacted ? 1 : -1));
    showToast(friendlyError(error), 'error');
  }
}
