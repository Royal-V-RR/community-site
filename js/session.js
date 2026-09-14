// session.js — tracks the current auth session and the caller's OWN profile
// row (read straight from the database, never trusted from anywhere else).
// UI-level convenience only: real authorization is enforced by RLS/RPCs.

import { supabase } from './supabase.js';

let currentSession = null;
let currentProfile = null;
const listeners = new Set();

async function loadProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, bio, avatar_path, banner_path, role, status, created_at')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Failed to load profile', error);
    return null;
  }
  return data;
}

async function refresh() {
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  currentProfile = currentSession ? await loadProfile(currentSession.user.id) : null;
  notify();
  return { session: currentSession, profile: currentProfile };
}

function notify() {
  for (const listener of listeners) {
    try {
      listener({ session: currentSession, profile: currentProfile });
    } catch (err) {
      console.error('Session listener error', err);
    }
  }
}

export function onSessionChange(listener) {
  listeners.add(listener);
  if (currentSession !== null || currentProfile !== null) {
    listener({ session: currentSession, profile: currentProfile });
  }
  return () => listeners.delete(listener);
}

export function getSession() {
  return currentSession;
}

export function getProfile() {
  return currentProfile;
}

export function isLoggedIn() {
  return Boolean(currentSession);
}

export function isStaff() {
  return Boolean(currentProfile && ['OWNER', 'ADMIN', 'MODERATOR'].includes(currentProfile.role));
}

export function isOwner() {
  return Boolean(currentProfile && currentProfile.role === 'OWNER');
}

export async function refreshProfile() {
  if (!currentSession) return null;
  currentProfile = await loadProfile(currentSession.user.id);
  notify();
  return currentProfile;
}

/** Redirect to login.html if not authenticated. Call after the initial
 * session load resolves. Returns true if the redirect happened. */
export function requireAuth() {
  if (!currentSession) {
    window.location.href = 'login.html';
    return true;
  }
  return false;
}

// Kick off the initial load immediately, then keep in sync with auth events.
const initialLoad = refresh();

supabase.auth.onAuthStateChange(async (_event, session) => {
  currentSession = session;
  currentProfile = session ? await loadProfile(session.user.id) : null;
  notify();
});

export function whenReady() {
  return initialLoad;
}
