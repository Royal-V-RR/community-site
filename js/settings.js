// settings.js — settings.html. Theme/accent are pure client-side preferences
// stored in localStorage (fine here — this is a real deployed page, not a
// sandboxed artifact preview). Account changes go through Supabase Auth.

import { supabase } from './supabase.js';
import { qs, setState, friendlyError, validators } from './utils.js';
import { whenReady, requireAuth, getProfile, getSession } from './session.js';

const THEME_KEY = 'community-site:theme';
const ACCENT_KEY = 'community-site:accent';
const PREFS_KEY = 'community-site:notification-prefs';

const themeSelect = qs('#theme-select');
const accentInput = qs('#accent-select');
const emailForm = qs('#email-form');
const emailInput = qs('#settings-email');
const passwordForm = qs('#password-form');
const passwordInput = qs('#settings-new-password');
const accountStatus = qs('#account-status');
const notifyComments = qs('#notify-comments');
const notifyReplies = qs('#notify-replies');
const privacyShowFollows = qs('#privacy-show-follows');
const deleteAccountBtn = qs('#delete-account-btn');
const deleteAccountPanel = qs('#delete-account-panel');
const deleteConfirmInput = qs('#delete-confirm-input');
const deleteAccountStatus = qs('#delete-account-status');
const deleteAccountConfirmBtn = qs('#delete-account-confirm-btn');

function applyTheme(theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.dataset.theme = resolved;
}

function loadLocalPrefs() {
  const theme = localStorage.getItem(THEME_KEY) || 'dark';
  const accent = localStorage.getItem(ACCENT_KEY);
  const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');

  themeSelect.value = theme;
  applyTheme(theme);
  if (accent) {
    accentInput.value = accent;
    document.documentElement.style.setProperty('--accent', accent);
  }
  notifyComments.checked = prefs.comments !== false;
  notifyReplies.checked = prefs.replies !== false;
  privacyShowFollows.checked = prefs.showFollows !== false;
}

themeSelect?.addEventListener('change', () => {
  localStorage.setItem(THEME_KEY, themeSelect.value);
  applyTheme(themeSelect.value);
});

accentInput?.addEventListener('input', () => {
  localStorage.setItem(ACCENT_KEY, accentInput.value);
  document.documentElement.style.setProperty('--accent', accentInput.value);
});

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      comments: notifyComments.checked,
      replies: notifyReplies.checked,
      showFollows: privacyShowFollows.checked,
    })
  );
}
[notifyComments, notifyReplies, privacyShowFollows].forEach((el) => el?.addEventListener('change', savePrefs));

emailForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!validators.isValidEmail(email)) {
    setState(accountStatus, 'error', 'Enter a valid email address.');
    return;
  }
  setState(accountStatus, 'loading', 'Updating email…');
  try {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw error;
    setState(accountStatus, 'empty', 'Check your inbox to confirm the new email.');
  } catch (error) {
    setState(accountStatus, 'error', friendlyError(error));
  }
});

passwordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  if (!validators.minLength(password, 8)) {
    setState(accountStatus, 'error', 'Use at least 8 characters.');
    return;
  }
  setState(accountStatus, 'loading', 'Updating password…');
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    passwordInput.value = '';
    setState(accountStatus, 'empty', 'Password updated.');
  } catch (error) {
    setState(accountStatus, 'error', friendlyError(error));
  }
});

deleteAccountBtn?.addEventListener('click', () => {
  deleteAccountPanel.hidden = !deleteAccountPanel.hidden;
});

deleteAccountConfirmBtn?.addEventListener('click', async () => {
  const profile = getProfile();
  if (!profile) return;
  if (deleteConfirmInput.value.trim() !== profile.username) {
    setState(deleteAccountStatus, 'error', 'Type your username exactly to confirm.');
    return;
  }
  if (profile.role === 'OWNER') {
    setState(deleteAccountStatus, 'error', 'The Owner account cannot be deleted from here.');
    return;
  }
  setState(deleteAccountStatus, 'loading', 'Deleting…');
  try {
    // Deleting the auth user requires elevated privileges the frontend does
    // not have. We remove the profile row (cascading to the user's content
    // per the foreign keys) and sign out; a scheduled server-side job or an
    // Edge Function with the service role key should complete auth.users
    // deletion. This keeps the service role key out of the frontend.
    const { error } = await supabase.from('profiles').delete().eq('id', profile.id);
    if (error) throw error;
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  } catch (error) {
    setState(deleteAccountStatus, 'error', friendlyError(error));
  }
});

whenReady().then(() => {
  if (requireAuth()) return;
  const session = getSession();
  if (session) emailInput.value = session.user.email || '';
  loadLocalPrefs();
});
