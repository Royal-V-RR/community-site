// utils.js · small shared helpers used across every page module.

/** Escape text before inserting into innerHTML. Always use this for any
 * user-supplied string (usernames, bios, post/comment content, etc.). */
export function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

/** Turn plain-text content into safe HTML with line breaks preserved. */
export function textToSafeHtml(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function debounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Render a loading / empty / error / (cleared) state into a status region.
 * kind: 'loading' | 'empty' | 'error' | null (clears the region). */
export function setState(region, kind, message) {
  if (!region) return;
  if (!kind) {
    region.textContent = '';
    region.removeAttribute('data-state');
    return;
  }
  region.setAttribute('data-state', kind);
  region.textContent = message || defaultStateMessage(kind);
}

function defaultStateMessage(kind) {
  switch (kind) {
    case 'loading': return 'Loading…';
    case 'empty': return 'Nothing here yet.';
    case 'error': return 'Something went wrong. Please try again.';
    default: return '';
  }
}

/** Map common Supabase/Postgres error messages to friendly, non-technical text. */
export function friendlyError(error) {
  if (!error) return 'Something went wrong. Please try again.';
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'Incorrect email/username or password.';
  if (msg.includes('user already registered') || msg.includes('duplicate') && msg.includes('email')) {
    return 'An account with that email already exists.';
  }
  if (msg.includes('duplicate') && msg.includes('username')) return 'That username is already taken.';
  if (msg.includes('rate limit')) {
    return "Too many emails sent recently — please wait a bit before trying again, or ask the site owner to turn off email confirmation.";
  }
  if (msg.includes('not authorized')) return "You don't have permission to do that.";
  if (msg.includes('cannot modify the owner') || msg.includes('cannot ban the owner')) {
    return 'The Owner account cannot be modified.';
  }
  if (msg.includes('network')) return 'Network error. Check your connection and try again.';
  if (msg.includes('row-level security') || msg.includes('permission denied')) {
    return "You don't have permission to do that.";
  }
  return error.message || 'Something went wrong. Please try again.';
}

let toastStack = null;
export function showToast(message, kind = 'info') {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('role', 'status');
    toastStack.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastStack);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.kind = kind;
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/** Basic client-side validation helpers (server/RLS is the real boundary). */
export const validators = {
  isNonEmpty: (value) => typeof value === 'string' && value.trim().length > 0,
  isValidUsername: (value) => /^[a-zA-Z0-9_-]{3,24}$/.test(value || ''),
  isValidEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || ''),
  minLength: (value, len) => (value || '').length >= len,
};

export function isSafeUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** PostgREST parses commas/parentheses as filter syntax even inside a
 * `.or()` string, so raw user input can break out of the intended condition.
 * Strip those, plus the ilike wildcard characters, before interpolating any
 * search term into a filter string. */
export function sanitizeIlikeTerm(value) {
  return (value || '')
    .replace(/[,()]/g, '')
    .replace(/[%_]/g, '')
    .trim();
}
