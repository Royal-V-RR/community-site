// general-processing.js — powers general-processing.html: "The Waiting Room".
//
// Three moving parts:
//  1. A personal ticket/timer, simulated entirely client-side and saved to
//     localStorage per user — never shared with anyone else (per spec:
//     "Timers are not shared").
//  2. Supabase Realtime Presence on a single shared channel, so everyone
//     currently in the room can see who else is waiting. Presence is
//     connection-based: closing the tab (or an explicit Leave) removes you
//     from everyone else's list automatically, no server code needed.
//  3. Supabase Realtime Broadcast on that same channel for the live chat,
//     and for an Owner-only "broadcast" that drops a line into every
//     currently-present person's own Activity log.
//
// Note on trust: broadcast/presence payloads are asserted by the client
// (there's no RLS on a realtime channel the way there is on a table), so a
// technically-savvy person could in principle spoof a display name in chat.
// The Owner-only broadcast button is hidden from non-Owners in the UI and
// gated by isOwner() before sending, but that's a client-side check, same
// trust model as the rest of this app's optimistic UI. Nothing here is
// persisted server-side, so the blast radius of any spoofing is limited to
// "annoying," not "damaging."

import { supabase } from './supabase.js';
import { qs, escapeHtml, showToast } from './utils.js';
import { whenReady, getSession, getProfile, isOwner } from './session.js';
import { avatarImg } from './components.js';

const STORAGE_PREFIX = 'community-site:waiting-room:';
const CHANNEL_NAME = 'general-processing-room';
const MIN_WAIT = 14400; // 4h
const MAX_WAIT = 32400; // 9h

const MESSAGES = [
  'Your request has been received.',
  'Your request has been assigned to Department 4.',
  'Department 4 has acknowledged your request.',
  'Your request is currently being reviewed.',
  'Your request has been placed on hold.',
  'Your request has been removed from hold.',
  'Your request has been reviewed.',
  'Your request has been sent back to Department 4.',
  'Your request has been reassigned to Department 7.',
  'Department 7 has requested additional information.',
  'Your file has been misplaced.',
  'Your file has been located.',
  'Your request has been escalated.',
  'Your request has been returned to normal priority.',
  'A supervisor has been notified.',
  'The supervisor is currently unavailable.',
  'Your position in queue has been recalculated.',
  'Your request remains in queue.',
  'Your request has been forwarded for signature.',
  'The signature could not be verified.',
  'Your request has been resubmitted.',
  'Your request has been logged for internal review.',
  'Your request has been noted.',
  'Your request has been transferred to a different desk.',
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTicketNumber() {
  return String(randInt(100000, 999999));
}

function formatWait(totalSeconds) {
  totalSeconds = Math.max(0, totalSeconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h} hours, ${m} minutes, ${s} seconds`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const gateEl = qs('#wr-gate');
const roomEl = qs('#wr-room');
const ticketNameInput = qs('#wr-ticket-name');
const enterBtn = qs('#wr-enter-btn');
const leaveBtn = qs('#wr-leave-btn');
const bannerEl = qs('#wr-banner');
const ticketNumberEl = qs('#wr-ticket-number');
const ticketNameDisplayEl = qs('#wr-ticket-name-display');
const waitEl = qs('#wr-wait-time');
const logEl = qs('#wr-log');
const broadcastBtn = qs('#wr-broadcast-btn');

const pillEl = qs('#wr-pill');
const pillAvatarsEl = qs('#wr-pill-avatars');
const pillDotEl = qs('#wr-pill-dot');

const sheetBackdrop = qs('#wr-sheet-backdrop');
const sheetEl = qs('#wr-sheet');
const sheetDrag = qs('#wr-sheet-drag');
const tabPeople = qs('#wr-tab-people');
const tabChat = qs('#wr-tab-chat');
const tabIndicator = qs('#wr-tab-indicator');
const tabDot = qs('#wr-tab-dot');
const panelPeople = qs('#wr-panel-people');
const panelChat = qs('#wr-panel-chat');
const peopleListEl = qs('#wr-people-list');
const chatLogEl = qs('#wr-chat-log');
const chatForm = qs('#wr-chat-form');
const chatInput = qs('#wr-chat-input');

// ---------------------------------------------------------------------------
// Per-user local ticket state
// ---------------------------------------------------------------------------
let userId = null;
let profile = null;
let data = null; // { ticketNumber, ticketName, waitSeconds, log, createdAt, lastTick }
let currentWait = 0;
let tickTimer = null;
let messageTimer = null;
let saveTimer = null;
let lastMessage = null;
let channel = null;

function storageKey() {
  return `${STORAGE_PREFIX}${userId}`;
}

function loadData() {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data));
  } catch {
    // storage unavailable — the queue continues for this tab regardless
  }
}

function clearData() {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Ticket / timer rendering
// ---------------------------------------------------------------------------
function renderLogEntry(entry, animate) {
  const row = document.createElement('div');
  row.className = `wr-log-entry${entry.admin ? ' wr-log-entry--admin' : ''}${animate ? '' : ' show'}`;
  const time = document.createElement('span');
  time.className = 'wr-log-time';
  time.textContent = formatTime(entry.t);
  row.appendChild(time);
  row.appendChild(document.createTextNode(entry.msg));
  logEl.appendChild(row);
  if (animate) {
    requestAnimationFrame(() => requestAnimationFrame(() => row.classList.add('show')));
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function renderInitialLog() {
  logEl.innerHTML = '';
  data.log.forEach((entry) => renderLogEntry(entry, false));
}

function pushMessage(text, { admin = false } = {}) {
  const entry = { msg: text, t: Date.now(), admin };
  data.log.push(entry);
  if (data.log.length > 60) data.log = data.log.slice(data.log.length - 60);
  persist();
  renderLogEntry(entry, true);
}

function pickMessage() {
  const pool = MESSAGES.filter((m) => m !== lastMessage);
  const choice = pool[randInt(0, pool.length - 1)];
  lastMessage = choice;
  return choice;
}

function scheduleNextMessage() {
  clearTimeout(messageTimer);
  const delay = randInt(14000, 32000);
  messageTimer = setTimeout(() => {
    pushMessage(pickMessage());
    if (Math.random() < 0.35) {
      const nudge = randInt(-900, 1500);
      currentWait += nudge;
      if (currentWait < 0) currentWait = randInt(1800, 7200);
    }
    scheduleNextMessage();
  }, delay);
}

function startTicking() {
  clearInterval(tickTimer);
  waitEl.textContent = formatWait(currentWait);
  tickTimer = setInterval(() => {
    currentWait -= 1;
    if (currentWait <= 0) {
      currentWait = randInt(MIN_WAIT, MAX_WAIT);
      pushMessage('Your request has been reopened.');
    }
    waitEl.textContent = formatWait(currentWait);
  }, 1000);

  clearInterval(saveTimer);
  saveTimer = setInterval(saveNow, 6000);
}

function saveNow() {
  if (!data) return;
  data.waitSeconds = currentWait;
  data.lastTick = Date.now();
  persist();
}

// ---------------------------------------------------------------------------
// Entering / resuming / leaving the room
// ---------------------------------------------------------------------------
function showGate() {
  gateEl.hidden = false;
  roomEl.hidden = true;
  pillEl.hidden = true;
  closeSheet();
  ticketNameInput.value = '';
  ticketNameInput.focus();
}

function showRoom() {
  gateEl.hidden = true;
  roomEl.hidden = false;
  pillEl.hidden = false;
}

function beginFreshTicket(ticketName) {
  data = {
    ticketNumber: generateTicketNumber(),
    ticketName: ticketName || '',
    waitSeconds: randInt(MIN_WAIT, MAX_WAIT),
    log: [{ msg: MESSAGES[0], t: Date.now() }],
    createdAt: Date.now(),
    lastTick: Date.now(),
  };
  persist();
  enterRoom({ showWelcomeBack: false });
}

function resumeTicket() {
  const now = Date.now();
  const elapsedSec = Math.floor((now - data.lastTick) / 1000);
  if (elapsedSec > 0) data.waitSeconds -= elapsedSec;

  const jitter = randInt(-1800, 2700);
  data.waitSeconds += jitter;

  let reopened = false;
  if (data.waitSeconds <= 0) {
    data.waitSeconds = randInt(MIN_WAIT, MAX_WAIT);
    reopened = true;
  }
  data.lastTick = now;
  persist();
  enterRoom({ showWelcomeBack: true, reopened });
}

function enterRoom({ showWelcomeBack, reopened }) {
  lastMessage = data.log.length ? data.log[data.log.length - 1].msg : null;
  currentWait = data.waitSeconds;

  ticketNumberEl.textContent = data.ticketNumber;
  if (data.ticketName) {
    ticketNameDisplayEl.textContent = `"${data.ticketName}"`;
    ticketNameDisplayEl.hidden = false;
  } else {
    ticketNameDisplayEl.hidden = true;
  }

  renderInitialLog();
  if (reopened) pushMessage('Your request has been reopened.');

  showRoom();

  if (showWelcomeBack) {
    bannerEl.hidden = false;
    bannerEl.textContent = 'Welcome back. Your ticket is still being processed. Maybe the wait has gone down. Maybe it hasn\u2019t.';
    bannerEl.classList.remove('show');
    requestAnimationFrame(() => requestAnimationFrame(() => bannerEl.classList.add('show')));
  } else {
    bannerEl.hidden = true;
  }

  startTicking();
  scheduleNextMessage();
  connectChannel();
}

function leaveQueue() {
  disconnectChannel();
  clearInterval(tickTimer);
  clearInterval(saveTimer);
  clearTimeout(messageTimer);
  clearData();
  data = null;
  showGate();
}

// ---------------------------------------------------------------------------
// Realtime: presence (who's waiting) + broadcast (chat / admin messages)
// ---------------------------------------------------------------------------
const people = new Map(); // id -> { el, info }

function personLabel(info) {
  return info.display_name || info.username || 'Someone';
}

function renderPersonEl(info) {
  const li = document.createElement('li');
  li.className = 'wr-people-item';
  li.dataset.id = info.id;
  const isSelf = info.id === userId;
  li.innerHTML = `
    ${avatarImg({ display_name: info.display_name, username: info.username, avatar_path: info.avatar_path }, 36)}
    <div class="wr-people-info">
      <span class="wr-people-name">${escapeHtml(personLabel(info))}${isSelf ? ' <span class="wr-people-you">(you)</span>' : ''}</span>
      ${info.ticket_name ? `<span class="wr-people-ticket">"${escapeHtml(info.ticket_name)}"</span>` : '<span class="wr-people-ticket wr-people-ticket--muted">No ticket name given</span>'}
    </div>
  `;
  return li;
}

function updatePeopleUI() {
  const count = people.size;
  const others = Math.max(0, count - (people.has(userId) ? 1 : 0));
  const pillTextEl = qs('.wr-pill-text', pillEl);
  pillTextEl.innerHTML = others > 0
    ? `<span id="wr-pill-count">${others}</span> also waiting`
    : 'You\u2019re the only one here';

  const avatarInfos = Array.from(people.values())
    .map((v) => v.info)
    .filter((info) => info.id !== userId)
    .slice(0, 3);
  pillAvatarsEl.innerHTML = avatarInfos
    .map((info) => avatarImg({ display_name: info.display_name, username: info.username, avatar_path: info.avatar_path }, 22))
    .join('');
}

function syncPresence(state) {
  const seen = new Set();

  Object.entries(state).forEach(([id, metas]) => {
    const info = { id, ...metas[0] };
    seen.add(id);
    const existing = people.get(id);
    if (existing) {
      existing.info = info;
    } else {
      const el = renderPersonEl(info);
      people.set(id, { el, info });
      peopleListEl.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-visible')));
    }
  });

  Array.from(people.keys()).forEach((id) => {
    if (!seen.has(id)) {
      const { el } = people.get(id);
      people.delete(id);
      el.classList.add('is-leaving');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 500); // safety net if transitionend never fires
    }
  });

  updatePeopleUI();
}

function renderChatMessage({ user_id, username, display_name, avatar_path, text, t }) {
  const li = document.createElement('li');
  const isSelf = user_id === userId;
  li.className = `wr-chat-message${isSelf ? ' wr-chat-message--self' : ''}`;
  li.innerHTML = `
    ${avatarImg({ display_name, username, avatar_path }, 28)}
    <div class="wr-chat-bubble">
      <div class="wr-chat-meta"><span class="wr-chat-author">${escapeHtml(display_name || username || 'Someone')}</span><span class="wr-chat-time">${formatTime(t)}</span></div>
      <div class="wr-chat-text">${escapeHtml(text)}</div>
    </div>
  `;
  chatLogEl.appendChild(li);
  requestAnimationFrame(() => requestAnimationFrame(() => li.classList.add('is-visible')));
  chatLogEl.scrollTop = chatLogEl.scrollHeight;

  if (!isSelf && panelChat.hidden) {
    tabDot.hidden = false;
    pillDotEl.hidden = false;
  }
}

function connectChannel() {
  if (channel) return;
  people.clear();
  peopleListEl.innerHTML = '';
  chatLogEl.innerHTML = '';

  channel = supabase.channel(CHANNEL_NAME, {
    config: {
      presence: { key: userId },
      broadcast: { self: true },
    },
  });

  channel.on('presence', { event: 'sync' }, () => {
    syncPresence(channel.presenceState());
  });

  channel.on('broadcast', { event: 'chat' }, ({ payload }) => renderChatMessage(payload));

  channel.on('broadcast', { event: 'admin' }, ({ payload }) => {
    pushMessage(`\u{1F4E2} Department notice: ${payload.text}`, { admin: true });
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        id: userId,
        username: profile.username,
        display_name: profile.display_name,
        avatar_path: profile.avatar_path,
        ticket_name: data.ticketName || '',
        joined_at: Date.now(),
      });
    }
  });
}

function disconnectChannel() {
  if (!channel) return;
  channel.untrack();
  supabase.removeChannel(channel);
  channel = null;
  people.clear();
  peopleListEl.innerHTML = '';
  chatLogEl.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Sheet (who's waiting / live chat) — mobile bottom-sheet UI
// ---------------------------------------------------------------------------
let sheetOpen = false;

function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  sheetBackdrop.hidden = false;
  sheetEl.hidden = false;
  pillEl.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    sheetBackdrop.classList.add('is-open');
    sheetEl.classList.add('is-open');
  });
}

function closeSheet() {
  if (!sheetOpen) { sheetBackdrop.hidden = true; sheetEl.hidden = true; return; }
  sheetOpen = false;
  sheetBackdrop.classList.remove('is-open');
  sheetEl.classList.remove('is-open');
  pillEl.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    sheetBackdrop.hidden = true;
    sheetEl.hidden = true;
  }, 260);
}

function selectTab(name) {
  const toPeople = name === 'people';
  tabPeople.classList.toggle('is-active', toPeople);
  tabChat.classList.toggle('is-active', !toPeople);
  tabPeople.setAttribute('aria-selected', String(toPeople));
  tabChat.setAttribute('aria-selected', String(!toPeople));
  tabIndicator.style.transform = toPeople ? 'translateX(0%)' : 'translateX(100%)';
  panelPeople.hidden = !toPeople;
  panelChat.hidden = toPeople;
  if (!toPeople) {
    tabDot.hidden = true;
    pillDotEl.hidden = true;
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }
}

pillEl.addEventListener('click', () => openSheet());
sheetBackdrop.addEventListener('click', closeSheet);
sheetDrag.addEventListener('click', closeSheet);
tabPeople.addEventListener('click', () => selectTab('people'));
tabChat.addEventListener('click', () => selectTab('chat'));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sheetOpen) closeSheet();
});

chatForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !channel) return;
  channel.send({
    type: 'broadcast',
    event: 'chat',
    payload: {
      user_id: userId,
      username: profile.username,
      display_name: profile.display_name,
      avatar_path: profile.avatar_path,
      text,
      t: Date.now(),
    },
  });
  chatInput.value = '';
});

broadcastBtn?.addEventListener('click', () => {
  const text = window.prompt('Send a notice to everyone currently in the waiting room:');
  if (!text || !text.trim() || !channel) return;
  channel.send({ type: 'broadcast', event: 'admin', payload: { text: text.trim() } });
  showToast('Notice sent to the waiting room.', 'success');
});

// ---------------------------------------------------------------------------
// Gate / leave wiring
// ---------------------------------------------------------------------------
enterBtn?.addEventListener('click', () => {
  beginFreshTicket(ticketNameInput.value.trim());
});
ticketNameInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') enterBtn.click();
});
leaveBtn?.addEventListener('click', () => {
  if (window.confirm('Leave the queue? Your ticket will be discarded and you\u2019ll disappear from the waiting list.')) {
    leaveQueue();
  }
});

window.addEventListener('beforeunload', () => {
  if (data) saveNow();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && data) saveNow();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
whenReady().then(() => {
  const session = getSession();
  if (!session) return; // navigation.js redirects to login shortly
  profile = getProfile();
  userId = session.user.id;

  broadcastBtn.hidden = !isOwner();

  const existing = loadData();
  if (existing) {
    data = existing;
    resumeTicket();
  } else {
    showGate();
  }
});
