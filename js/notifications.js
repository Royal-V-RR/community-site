// notifications.js · notifications.html. Only ever reads/updates the
// caller's own rows; RLS backs this up regardless.

import { supabase } from './supabase.js';
import { qs, qsa, setState, friendlyError } from './utils.js';
import { renderNotificationItem } from './components.js';
import { whenReady, requireAuth } from './session.js';
import { refreshUnreadBadge } from './navigation.js';

const statusRegion = qs('#notifications-status');
const listEl = qs('#notifications-list');
const markAllBtn = qs('#mark-all-read-btn');

async function loadNotifications() {
  setState(statusRegion, 'loading');
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    setState(statusRegion, 'error', friendlyError(error));
    return;
  }

  if (data.length === 0) {
    setState(statusRegion, 'empty', 'No notifications yet.');
    listEl.innerHTML = '';
    return;
  }

  setState(statusRegion, null);
  listEl.innerHTML = data.map(renderNotificationItem).join('');

  qsa('.notification-item', listEl).forEach((item) => {
    if (item.dataset.unread === 'true') {
      const link = item.querySelector('a');
      link?.addEventListener(
        'click',
        async (event) => {
          event.preventDefault();
          await markRead(item.dataset.id);
          window.location.href = link.getAttribute('href');
        },
        { once: true }
      );
    }
  });
}

async function markRead(id) {
  await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  refreshUnreadBadge();
}

markAllBtn?.addEventListener('click', async () => {
  markAllBtn.disabled = true;
  try {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
    await loadNotifications();
    refreshUnreadBadge();
  } finally {
    markAllBtn.disabled = false;
  }
});

whenReady().then(() => {
  if (requireAuth()) return;
  loadNotifications();
});
