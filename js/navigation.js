// navigation.js — shared chrome behavior included on every authenticated page:
// hamburger menu, notification badge, admin link visibility, logout, the
// Owner-only create-post FAB, and marking the active bottom-nav item.

import { supabase } from './supabase.js';
import { qs } from './utils.js';
import { onSessionChange, isOwner, isStaff, requireAuth, whenReady } from './session.js';

const hamburgerToggle = qs('#hamburger-toggle');
const hamburgerMenu = qs('#hamburger-menu');
const adminLink = qs('#admin-link');
const logoutBtn = qs('#logout-btn');
const notifBadge = qs('#notif-badge');
const fab = qs('#create-post-fab');

function closeMenu() {
  if (!hamburgerMenu) return;
  hamburgerMenu.hidden = true;
  hamburgerToggle?.setAttribute('aria-expanded', 'false');
}

function openMenu() {
  if (!hamburgerMenu) return;
  hamburgerMenu.hidden = false;
  hamburgerToggle?.setAttribute('aria-expanded', 'true');
  qs('a, button', hamburgerMenu)?.focus();
}

if (hamburgerToggle && hamburgerMenu) {
  hamburgerToggle.addEventListener('click', () => {
    const isOpen = hamburgerToggle.getAttribute('aria-expanded') === 'true';
    if (isOpen) closeMenu();
    else openMenu();
  });

  document.addEventListener('click', (event) => {
    if (hamburgerMenu.hidden) return;
    if (hamburgerMenu.contains(event.target) || hamburgerToggle.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !hamburgerMenu.hidden) {
      closeMenu();
      hamburgerToggle.focus();
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });
}

async function refreshUnreadBadge() {
  if (!notifBadge) return;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);
  if (error) return;
  if (count && count > 0) {
    notifBadge.hidden = false;
    notifBadge.textContent = count > 99 ? '99+' : String(count);
  } else {
    notifBadge.hidden = true;
  }
}

onSessionChange(({ session }) => {
  if (adminLink) adminLink.hidden = !isStaff();
  if (fab) fab.hidden = !isOwner();
  if (session) refreshUnreadBadge();
  else if (notifBadge) notifBadge.hidden = true;
});

// Pages that require a logged-in user redirect to login.html once the
// initial session check resolves. Public-feeling pages (index/forums/post/
// forum/search) stay readable to everyone by design, per the product spec,
// but still get the chrome above updated once a session is known.
const AUTH_REQUIRED_PAGES = new Set([
  'create.html',
  'notifications.html',
  'settings.html',
  'admin.html',
]);

const currentPage = window.location.pathname.split('/').pop() || 'index.html';
if (AUTH_REQUIRED_PAGES.has(currentPage)) {
  whenReady().then(() => requireAuth());
}

export { refreshUnreadBadge };
