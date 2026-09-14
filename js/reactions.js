// reactions.js · like/react to a post. RLS still enforces the unique
// (post_id, user_id, reaction_type) constraint and the allow_reactions flag.

import { supabase } from './supabase.js';
import { getSession } from './session.js';
import { showToast, friendlyError } from './utils.js';
import { ICONS } from './icons.js';

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

export function renderReactionButton({ count, reacted }) {
  return `
    <button type="button" id="reaction-btn" class="reaction-btn" aria-pressed="${reacted}">
      <span id="reaction-icon" aria-hidden="true">${reacted ? ICONS.heartFilled : ICONS.heartOutline}</span>
      <span id="reaction-count">${count}</span>
    </button>
  `;
}

export async function toggleReaction(postId, container) {
  const session = getSession();
  if (!session) {
    window.location.href = `login.html?redirect=post.html?id=${encodeURIComponent(postId)}`;
    return;
  }
  const btn = container.querySelector('#reaction-btn');
  const iconEl = container.querySelector('#reaction-icon');
  const countEl = container.querySelector('#reaction-count');
  const wasReacted = btn.getAttribute('aria-pressed') === 'true';

  btn.setAttribute('aria-pressed', String(!wasReacted));
  iconEl.innerHTML = wasReacted ? ICONS.heartOutline : ICONS.heartFilled;
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
    iconEl.innerHTML = wasReacted ? ICONS.heartFilled : ICONS.heartOutline;
    countEl.textContent = String(Number(countEl.textContent) + (wasReacted ? 1 : -1));
    showToast(friendlyError(error), 'error');
  }
}
