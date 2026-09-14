// profile.js · profile.html. Shows own profile (no ?user= param) or another
// user's profile (?user=username). Edit form only renders for the owner of
// the profile being viewed.

import { supabase } from './supabase.js';
import { qs, setState, friendlyError, getUrlParam, escapeHtml, validators, showToast } from './utils.js';
import { renderPostCard } from './components.js';
import { whenReady, getSession, getProfile, refreshProfile } from './session.js';
import { getFollowState, toggleFollow } from './follows.js';
import { uploadAvatar, uploadBanner } from './uploads.js';

const statusRegion = qs('#profile-status');
const view = qs('#profile-view');
const bannerEl = qs('#profile-banner');
const avatarEl = qs('#profile-avatar');
const displayNameEl = qs('#profile-display-name');
const usernameEl = qs('#profile-username');
const roleBadgeEl = qs('#profile-role-badge');
const bioEl = qs('#profile-bio');
const followStats = qs('#profile-follow-stats');
const followersCount = qs('#followers-count');
const followingCount = qs('#following-count');
const followToggleBtn = qs('#follow-toggle-btn');
const editBtn = qs('#edit-profile-btn');
const activityList = qs('#profile-activity-list');

const editForm = qs('#edit-profile-form');
const editDisplayName = qs('#edit-display-name');
const editUsername = qs('#edit-username');
const editBio = qs('#edit-bio');
const editAvatarInput = qs('#edit-avatar');
const editBannerInput = qs('#edit-banner');
const editStatus = qs('#edit-profile-status');
const cancelEditBtn = qs('#cancel-edit-profile');

let profileData = null;

async function loadProfile() {
  setState(statusRegion, 'loading');
  const username = getUrlParam('user');

  let query = supabase.from('profiles').select('*');
  if (username) {
    query = query.eq('username', username);
  } else {
    const session = getSession();
    if (!session) {
      window.location.href = 'login.html?redirect=profile.html';
      return;
    }
    query = query.eq('id', session.user.id);
  }

  const { data, error } = await query.single();
  if (error || !data) {
    setState(statusRegion, 'error', 'That profile could not be found.');
    return;
  }

  profileData = data;
  setState(statusRegion, null);
  render();
  loadActivity();
}

function render() {
  view.hidden = false;
  bannerEl.style.backgroundImage = profileData.banner_path ? `url(${CSS.escape(profileData.banner_path)})` : '';

  const freshAvatarEl = qs('#profile-avatar');
  freshAvatarEl.src = profileData.avatar_path
    ? profileData.avatar_path
    : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profileData.display_name || profileData.username || '?')}`;
  freshAvatarEl.alt = profileData.display_name || profileData.username || 'User';

  displayNameEl.textContent = profileData.display_name;
  usernameEl.textContent = `@${profileData.username}`;

  const freshRoleBadgeEl = qs('#profile-role-badge');
  if (profileData.role && profileData.role !== 'MEMBER') {
    freshRoleBadgeEl.textContent = profileData.role;
    freshRoleBadgeEl.dataset.role = profileData.role;
    freshRoleBadgeEl.hidden = false;
  } else {
    freshRoleBadgeEl.textContent = '';
    freshRoleBadgeEl.removeAttribute('data-role');
    freshRoleBadgeEl.hidden = true;
  }

  bioEl.textContent = profileData.bio || '';

  const session = getSession();
  const isOwnProfile = session && session.user.id === profileData.id;

  editBtn.hidden = !isOwnProfile;
  followStats.hidden = isOwnProfile;

  if (!isOwnProfile) {
    getFollowState(profileData.id).then(({ followers, following, isFollowing }) => {
      followersCount.textContent = String(followers);
      followingCount.textContent = String(following);
      followToggleBtn.dataset.following = String(isFollowing);
      followToggleBtn.textContent = isFollowing ? 'Following' : 'Follow';
      followToggleBtn.hidden = false;
    });
  }
}

followToggleBtn?.addEventListener('click', () => {
  if (profileData) toggleFollow(profileData.id, followToggleBtn);
});

async function loadActivity() {
  const isOwner = profileData.role === 'OWNER';
  activityList.innerHTML = '<p class="muted-text">Loading…</p>';

  if (isOwner) {
    const { data: posts } = await supabase
      .from('posts')
      .select(`
        id, title, content, is_pinned, is_featured, created_at,
        profiles:author_id ( id, username, display_name, avatar_path, role )
      `)
      .eq('author_id', profileData.id)
      .order('created_at', { ascending: false })
      .limit(10);
    activityList.innerHTML = posts && posts.length
      ? posts.map(renderPostCard).join('')
      : '<p class="muted-text">No posts yet.</p>';
    return;
  }

  const { data: threads } = await supabase
    .from('forum_threads')
    .select('id, title, created_at')
    .eq('author_id', profileData.id)
    .order('created_at', { ascending: false })
    .limit(10);
  activityList.innerHTML = threads && threads.length
    ? threads
        .map(
          (t) =>
            `<p><a href="forum.html?id=${encodeURIComponent(t.id)}">${escapeHtml(t.title)}</a></p>`
        )
        .join('')
    : '<p class="muted-text">No forum activity yet.</p>';
}

editBtn?.addEventListener('click', () => {
  editDisplayName.value = profileData.display_name;
  editUsername.value = profileData.username;
  editBio.value = profileData.bio || '';
  view.hidden = true;
  editForm.hidden = false;
});

cancelEditBtn?.addEventListener('click', () => {
  editForm.hidden = true;
  view.hidden = false;
});

editForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const displayName = editDisplayName.value.trim();
  const username = editUsername.value.trim();
  const bio = editBio.value.trim();

  if (!validators.isNonEmpty(displayName)) {
    setState(editStatus, 'error', 'Enter a display name.');
    return;
  }
  if (!validators.isValidUsername(username)) {
    setState(editStatus, 'error', 'Use 3 to 24 letters, numbers, underscores, or hyphens.');
    return;
  }

  setState(editStatus, 'loading', 'Saving…');
  const saveBtn = editForm.querySelector('button[type="submit"]');
  saveBtn.disabled = true;

  try {
    const updates = { display_name: displayName, username, bio };

    if (editAvatarInput.files[0]) {
      updates.avatar_path = await uploadAvatar(profileData.id, editAvatarInput.files[0]);
    }
    if (editBannerInput.files[0]) {
      updates.banner_path = await uploadBanner(profileData.id, editBannerInput.files[0]);
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', profileData.id);
    if (error) throw error;

    profileData = { ...profileData, ...updates };
    await refreshProfile();
    setState(editStatus, null);
    editForm.hidden = true;
    render();
  } catch (error) {
    setState(editStatus, 'error', friendlyError(error));
  } finally {
    saveBtn.disabled = false;
  }
});

whenReady().then(loadProfile);

// iOS Safari restores the exact DOM state (including whichever panel was
// visible) from its back-forward cache on a swipe-back, without re-running
// this script. Force it back to view mode so editing doesn't "stick".
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    editForm.hidden = true;
    view.hidden = false;
  }
});
