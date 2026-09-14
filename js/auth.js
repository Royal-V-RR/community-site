// auth.js · powers login.html and register.html. Logout lives in
// navigation.js since the logout button is in the shared hamburger menu.

import { supabase } from './supabase.js';
import { qs, setState, friendlyError, validators, getUrlParam } from './utils.js';

const loginForm = qs('#login-form');
const registerForm = qs('#register-form');

function setFieldError(id, message) {
  const el = qs(`#${id}-error`);
  if (el) el.textContent = message || '';
}

function clearFieldErrors(ids) {
  ids.forEach((id) => setFieldError(id, ''));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
if (loginForm) {
  const statusRegion = qs('#login-form-status');
  const submitBtn = qs('#login-submit');
  const forgotLink = qs('#forgot-password-link');
  const forgotPanel = qs('#forgot-password-panel');
  const resetBtn = qs('#reset-submit');
  const resetStatus = qs('#reset-status');

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(['login-identifier', 'login-password']);
    setState(statusRegion, null);

    const identifier = qs('#login-identifier').value.trim();
    const password = qs('#login-password').value;

    if (!validators.isNonEmpty(identifier)) {
      setFieldError('login-identifier', 'Enter your email or username.');
      return;
    }
    if (!validators.isNonEmpty(password)) {
      setFieldError('login-password', 'Enter your password.');
      return;
    }

    submitBtn.disabled = true;
    setState(statusRegion, 'loading', 'Logging in…');

    try {
      let email = identifier;
      if (!identifier.includes('@')) {
        const { data: profile, error: lookupError } = await supabase
          .from('profiles')
          .select('id, username')
          .eq('username', identifier)
          .maybeSingle();
        if (lookupError || !profile) throw new Error('Invalid login credentials');
        const { data: authLookup, error: authLookupError } = await supabase
          .rpc('email_for_username', { lookup_username: identifier });
        if (authLookupError || !authLookup) throw new Error('Invalid login credentials');
        email = authLookup;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      setState(statusRegion, null);
      const redirectTo = getUrlParam('redirect') || 'index.html';
      window.location.href = redirectTo;
    } catch (error) {
      setState(statusRegion, 'error', friendlyError(error));
    } finally {
      submitBtn.disabled = false;
    }
  });

  if (forgotLink && forgotPanel) {
    forgotLink.addEventListener('click', (event) => {
      event.preventDefault();
      forgotPanel.hidden = !forgotPanel.hidden;
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const email = qs('#reset-email').value.trim();
      if (!validators.isValidEmail(email)) {
        setState(resetStatus, 'error', 'Enter a valid email address.');
        return;
      }
      resetBtn.disabled = true;
      setState(resetStatus, 'loading', 'Sending…');
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}${window.location.pathname.replace('login.html', 'settings.html')}`,
        });
        if (error) throw error;
        setState(resetStatus, null);
        setState(resetStatus, 'empty', 'If that email exists, a reset link is on its way.');
      } catch (error) {
        setState(resetStatus, 'error', friendlyError(error));
      } finally {
        resetBtn.disabled = false;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
if (registerForm) {
  const statusRegion = qs('#register-form-status');
  const submitBtn = qs('#register-submit');

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fieldIds = ['reg-username', 'reg-display-name', 'reg-email', 'reg-password', 'reg-password-confirm'];
    clearFieldErrors(fieldIds);
    setState(statusRegion, null);

    const username = qs('#reg-username').value.trim();
    const displayName = qs('#reg-display-name').value.trim();
    const email = qs('#reg-email').value.trim();
    const password = qs('#reg-password').value;
    const passwordConfirm = qs('#reg-password-confirm').value;
    const avatarFile = qs('#reg-avatar').files[0] || null;

    let hasError = false;
    if (!validators.isValidUsername(username)) {
      setFieldError('reg-username', 'Use 3 to 24 letters, numbers, underscores, or hyphens.');
      hasError = true;
    }
    if (!validators.isNonEmpty(displayName)) {
      setFieldError('reg-display-name', 'Enter a display name.');
      hasError = true;
    }
    if (!validators.isValidEmail(email)) {
      setFieldError('reg-email', 'Enter a valid email address.');
      hasError = true;
    }
    if (!validators.minLength(password, 8)) {
      setFieldError('reg-password', 'Use at least 8 characters.');
      hasError = true;
    }
    if (password !== passwordConfirm) {
      setFieldError('reg-password-confirm', 'Passwords do not match.');
      hasError = true;
    }
    if (hasError) return;

    submitBtn.disabled = true;
    setState(statusRegion, 'loading', 'Creating your account…');

    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();
      if (existing) {
        setFieldError('reg-username', 'That username is already taken.');
        setState(statusRegion, null);
        return;
      }

      // username/display_name travel as auth metadata (not a direct insert
      // into profiles) because the public.profiles row itself is created
      // server-side by the handle_new_user trigger (009_handle_new_user.sql).
      // That trigger runs with elevated privileges regardless of whether
      // signUp() returns a live session, which a direct client-side insert
      // here could not do — see that migration's comment for why.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username, display_name: displayName } },
      });
      if (signUpError) throw signUpError;

      const userId = signUpData.user?.id;
      if (!userId) {
        setState(statusRegion, 'empty', 'Check your email to confirm your account, then log in.');
        return;
      }

      if (!signUpData.session) {
        setState(statusRegion, 'empty', 'Check your email to confirm your account, then log in.');
        return;
      }

      if (avatarFile) {
        try {
          const { uploadAvatar } = await import('./uploads.js');
          const avatarUrl = await uploadAvatar(userId, avatarFile);
          await supabase.from('profiles').update({ avatar_path: avatarUrl }).eq('id', userId);
        } catch (uploadErr) {
          console.error('Avatar upload failed', uploadErr);
        }
      }

      setState(statusRegion, null);
      window.location.href = 'index.html';
    } catch (error) {
      setState(statusRegion, 'error', friendlyError(error));
    } finally {
      submitBtn.disabled = false;
    }
  });
}
