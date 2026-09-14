// admin.js · admin.html. The tab UI here is convenience only: every action
// re-hits a SECURITY DEFINER RPC that independently checks the caller's real
// role, so this page cannot be used to escalate privileges even if someone
// bypasses the UI gate below.

import { supabase } from './supabase.js';
import { qs, qsa, setState, friendlyError, escapeHtml, formatDate, showToast, debounce, sanitizeIlikeTerm } from './utils.js';
import { statusTag, roleBadge, avatarImg } from './components.js';
import { whenReady, requireAuth, isStaff, isOwner, getProfile } from './session.js';
import {
  promoteToModerator,
  promoteToAdmin,
  demoteStaff,
  banUser,
  unbanUser,
  resolveReport,
  markReportReviewing,
  moderateContent,
} from './moderation.js';

const guardStatus = qs('#admin-guard-status');
const contentEl = qs('#admin-content');
const tabs = qsa('.tab-btn');
const panels = qsa('.admin-panel');

const usersStatus = qs('#users-status');
const usersList = qs('#users-list');
const userSearchInput = qs('#user-search-input');

const reportsStatus = qs('#reports-status');
const reportsList = qs('#reports-list');

const forumMgmtStatus = qs('#forum-mgmt-status');
const forumMgmtList = qs('#forum-mgmt-list');

const auditStatus = qs('#audit-status');
const auditList = qs('#audit-list');

const siteSettingsForm = qs('#site-settings-form');
const maxFileSizeInput = qs('#max-file-size-input');
const maxFilesInput = qs('#max-files-input');
const siteSettingsStatus = qs('#site-settings-status');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    panels.forEach((p) => (p.hidden = p.id !== tab.dataset.panel));
  });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function loadUsers(search = '') {
  setState(usersStatus, 'loading');
  let query = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_path, role, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (search) {
    const safeSearch = sanitizeIlikeTerm(search);
    query = query.or(`username.ilike.%${safeSearch}%,display_name.ilike.%${safeSearch}%`);
  }
  const { data, error } = await query;
  if (error) {
    setState(usersStatus, 'error', friendlyError(error));
    return;
  }
  if (data.length === 0) {
    setState(usersStatus, 'empty', 'No users found.');
    usersList.innerHTML = '';
    return;
  }
  setState(usersStatus, null);
  usersList.innerHTML = data.map(renderUserRow).join('');
  attachUserRowHandlers();
}

function renderUserRow(user) {
  const owner = isOwner();
  const me = getProfile();
  const isSelf = me && me.id === user.id;
  const actions = [];

  if (user.role === 'OWNER') {
    // No actions available against the Owner, by design.
  } else if (!isSelf) {
    if (user.role === 'MEMBER') {
      actions.push(`<button type="button" class="btn btn-secondary btn-small" data-action="promote-mod" data-id="${user.id}">Make Moderator</button>`);
    }
    if (owner && user.role !== 'ADMIN') {
      actions.push(`<button type="button" class="btn btn-secondary btn-small" data-action="promote-admin" data-id="${user.id}">Make Admin</button>`);
    }
    if (user.role === 'MODERATOR' || (owner && user.role === 'ADMIN')) {
      actions.push(`<button type="button" class="btn btn-secondary btn-small" data-action="demote" data-id="${user.id}">Demote</button>`);
    }
    if (user.status === 'BANNED') {
      actions.push(`<button type="button" class="btn btn-secondary btn-small" data-action="unban" data-id="${user.id}">Unban</button>`);
    } else {
      actions.push(`<button type="button" class="btn btn-danger btn-small" data-action="ban" data-id="${user.id}">Ban</button>`);
    }
  }

  return `
    <li class="admin-list-item" id="user-row-${user.id}">
      <div class="admin-list-item-row">
        ${avatarImg(user, 32)}
        <div>
          <strong>${escapeHtml(user.display_name)}</strong>
          <span class="muted-text">@${escapeHtml(user.username)}</span>
          ${roleBadge(user.role)} ${statusTag(user.status)}
        </div>
      </div>
      ${actions.length ? `<div class="admin-list-item-actions">${actions.join('')}</div>` : ''}
    </li>
  `;
}

function attachUserRowHandlers() {
  qsa('[data-action="promote-mod"]', usersList).forEach((btn) =>
    btn.addEventListener('click', () => runUserAction(btn, () => promoteToModerator(btn.dataset.id)))
  );
  qsa('[data-action="promote-admin"]', usersList).forEach((btn) =>
    btn.addEventListener('click', () => runUserAction(btn, () => promoteToAdmin(btn.dataset.id)))
  );
  qsa('[data-action="demote"]', usersList).forEach((btn) =>
    btn.addEventListener('click', () => runUserAction(btn, () => demoteStaff(btn.dataset.id)))
  );
  qsa('[data-action="ban"]', usersList).forEach((btn) =>
    btn.addEventListener('click', () => {
      const reason = window.prompt('Reason for ban (optional):') || null;
      runUserAction(btn, () => banUser(btn.dataset.id, reason));
    })
  );
  qsa('[data-action="unban"]', usersList).forEach((btn) =>
    btn.addEventListener('click', () => runUserAction(btn, () => unbanUser(btn.dataset.id)))
  );
}

async function runUserAction(button, action) {
  button.disabled = true;
  try {
    await action();
    showToast('Done.', 'success');
    loadUsers(userSearchInput.value.trim());
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    button.disabled = false;
  }
}

userSearchInput?.addEventListener(
  'input',
  debounce(() => loadUsers(userSearchInput.value.trim()), 300)
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
async function loadReports() {
  setState(reportsStatus, 'loading');
  const { data, error } = await supabase
    .from('reports')
    .select(`
      id, target_type, target_id, reason, status, created_at,
      reporter:reporter_id ( id, username, display_name )
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    setState(reportsStatus, 'error', friendlyError(error));
    return;
  }
  if (data.length === 0) {
    setState(reportsStatus, 'empty', 'No reports.');
    reportsList.innerHTML = '';
    return;
  }
  setState(reportsStatus, null);
  reportsList.innerHTML = data.map(renderReportRow).join('');
  attachReportHandlers();
}

function renderReportRow(report) {
  const reporter = report.reporter || {};
  const targetLink = reportTargetLink(report);
  const actions =
    report.status === 'RESOLVED' || report.status === 'DISMISSED'
      ? ''
      : `
      <button type="button" class="btn btn-secondary btn-small" data-action="review" data-id="${report.id}">Reviewing</button>
      <button type="button" class="btn btn-secondary btn-small" data-action="resolve" data-id="${report.id}">Resolve</button>
      <button type="button" class="btn btn-danger btn-small" data-action="dismiss" data-id="${report.id}">Dismiss</button>
    `;
  return `
    <li class="admin-list-item">
      <div class="admin-list-item-row">
        <div>
          <span class="admin-status-tag">${escapeHtml(report.status)}</span>
          <span class="muted-text">reported by @${escapeHtml(reporter.username || 'unknown')} · ${formatDate(report.created_at)}</span>
        </div>
      </div>
      <p>${escapeHtml(report.reason)}</p>
      ${targetLink}
      <div class="admin-list-item-actions">${actions}</div>
    </li>
  `;
}

function reportTargetLink(report) {
  if (report.target_type === 'post') {
    return `<a href="post.html?id=${encodeURIComponent(report.target_id)}">View post</a>`;
  }
  if (report.target_type === 'forum_thread') {
    return `<a href="forum.html?id=${encodeURIComponent(report.target_id)}">View thread</a>`;
  }
  return '';
}

function attachReportHandlers() {
  qsa('[data-action="review"]', reportsList).forEach((btn) =>
    btn.addEventListener('click', () => runReportAction(btn, () => markReportReviewing(btn.dataset.id)))
  );
  qsa('[data-action="resolve"]', reportsList).forEach((btn) =>
    btn.addEventListener('click', () => runReportAction(btn, () => resolveReport(btn.dataset.id, 'RESOLVED')))
  );
  qsa('[data-action="dismiss"]', reportsList).forEach((btn) =>
    btn.addEventListener('click', () => runReportAction(btn, () => resolveReport(btn.dataset.id, 'DISMISSED')))
  );
}

async function runReportAction(button, action) {
  button.disabled = true;
  try {
    await action();
    loadReports();
  } catch (error) {
    showToast(friendlyError(error), 'error');
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Forum management
// ---------------------------------------------------------------------------
async function loadForumManagement() {
  setState(forumMgmtStatus, 'loading');
  const { data, error } = await supabase
    .from('forum_threads')
    .select('id, title, is_locked, is_pinned, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    setState(forumMgmtStatus, 'error', friendlyError(error));
    return;
  }
  if (data.length === 0) {
    setState(forumMgmtStatus, 'empty', 'No threads.');
    forumMgmtList.innerHTML = '';
    return;
  }
  setState(forumMgmtStatus, null);
  forumMgmtList.innerHTML = data
    .map(
      (thread) => `
      <li class="admin-list-item">
        <div class="admin-list-item-row">
          <a href="forum.html?id=${encodeURIComponent(thread.id)}">${escapeHtml(thread.title)}</a>
          ${thread.is_locked ? '<span class="pill">Locked</span>' : ''}
        </div>
        <div class="admin-list-item-actions">
          <button type="button" class="btn btn-secondary btn-small" data-action="toggle-lock" data-id="${thread.id}" data-locked="${thread.is_locked}">
            ${thread.is_locked ? 'Unlock' : 'Lock'}
          </button>
        </div>
      </li>`
    )
    .join('');

  qsa('[data-action="toggle-lock"]', forumMgmtList).forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const locked = btn.dataset.locked === 'true';
        await moderateContent('forum_thread', btn.dataset.id, locked ? 'unlock' : 'lock');
        loadForumManagement();
      } catch (error) {
        showToast(friendlyError(error), 'error');
      } finally {
        btn.disabled = false;
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
async function loadAuditLog() {
  setState(auditStatus, 'loading');
  const { data, error } = await supabase
    .from('moderation_actions')
    .select(`
      id, action_type, reason, created_at,
      actor:actor_id ( username ),
      target_user:target_user_id ( username )
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    setState(auditStatus, 'error', friendlyError(error));
    return;
  }
  if (data.length === 0) {
    setState(auditStatus, 'empty', 'No moderation actions yet.');
    auditList.innerHTML = '';
    return;
  }
  setState(auditStatus, null);
  auditList.innerHTML = data
    .map(
      (entry) => `
      <li class="admin-list-item audit-entry">
        <span class="actor">@${escapeHtml(entry.actor?.username || 'system')}</span>
        <span class="action-type">${escapeHtml(entry.action_type)}</span>
        ${entry.target_user ? `on @${escapeHtml(entry.target_user.username)}` : ''}
        ${entry.reason ? `— ${escapeHtml(entry.reason)}` : ''}
        <div class="timestamp muted-text">${formatDate(entry.created_at)}</div>
      </li>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------
async function loadSiteSettings() {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'upload_limits').maybeSingle();
  if (data) {
    maxFileSizeInput.value = data.value.max_file_size_mb ?? 25;
    maxFilesInput.value = data.value.max_files_per_post ?? 10;
  }
}

siteSettingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setState(siteSettingsStatus, 'loading', 'Saving…');
  try {
    const { error } = await supabase
      .from('site_settings')
      .update({
        value: {
          max_file_size_mb: Number(maxFileSizeInput.value),
          max_files_per_post: Number(maxFilesInput.value),
        },
      })
      .eq('key', 'upload_limits');
    if (error) throw error;
    setState(siteSettingsStatus, null);
    showToast('Settings saved.', 'success');
  } catch (error) {
    setState(siteSettingsStatus, 'error', friendlyError(error));
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
whenReady().then(() => {
  if (requireAuth()) return;
  if (!isStaff()) {
    setState(guardStatus, 'error', "You don't have permission to view this page.");
    return;
  }
  setState(guardStatus, null);
  contentEl.hidden = false;
  loadUsers();
  loadReports();
  loadForumManagement();
  loadAuditLog();
  loadSiteSettings();
});
