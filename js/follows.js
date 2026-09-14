// follows.js — follow/unfollow another profile. Self-follow is rejected by
// both the RLS policy and the table CHECK constraint.

import { supabase } from './supabase.js';
import { getSession } from './session.js';
import { showToast, friendlyError } from './utils.js';

export async function getFollowState(profileId) {
  const session = getSession();
  const [{ count: followers }, { count: following }, mine] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', profileId),
    supabase.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', profileId),
    session
      ? supabase
          .from('follows')
          .select('follower_id')
          .eq('follower_id', session.user.id)
          .eq('following_id', profileId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    followers: followers || 0,
    following: following || 0,
    isFollowing: Boolean(mine.data),
  };
}

export async function toggleFollow(profileId, button) {
  const session = getSession();
  if (!session) {
    window.location.href = `login.html?redirect=profile.html`;
    return;
  }
  if (session.user.id === profileId) return;

  const wasFollowing = button.dataset.following === 'true';
  button.disabled = true;

  try {
    if (wasFollowing) {
      const { error } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', session.user.id)
        .eq('following_id', profileId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('follows')
        .insert({ follower_id: session.user.id, following_id: profileId });
      if (error) throw error;
    }
    button.dataset.following = String(!wasFollowing);
    button.textContent = wasFollowing ? 'Follow' : 'Following';
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    button.disabled = false;
  }
}
