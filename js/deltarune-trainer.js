// deltarune-trainer.js: powers deltarune-trainer.html.
// A per account practice tracker for the boss fights. Each account has one
// JSON document in public.deltarune_progress (row level security keeps it
// private), loaded once and saved a moment after every change.
//
// Document shape:
//   { v: 1, bosses: { [bossId]: { attempts, clears, hitless,
//       attacks: { [attackId]: 0|1|2 }, phases: { [phaseId]: 0|1|2 } } } }
// Mastery states: 0 new, 1 learning, 2 mastered.

import { supabase } from './supabase.js';
import { qs, escapeHtml } from './utils.js';
import { whenReady, getSession } from './session.js';
import { FIGHTS } from './deltarune-data.js';
import { TEXT } from './deltarune-text.js';

const TABLE = 'deltarune_progress';
const SAVE_DELAY_MS = 1200;
const STATE_CLASSES = ['is-new', 'is-learning', 'is-mastered'];
const STATE_LABELS = [TEXT.stateNew, TEXT.stateLearning, TEXT.stateMastered];

const listEl = qs('#dt-list');
const overallEl = qs('#dt-overall');
const overallBarEl = qs('#dt-overall-bar');
const saveEl = qs('#dt-save');
const statusEl = qs('#dt-status');

let userId = null;
let doc = { v: 1, bosses: {} };
let saveTimer = null;
let dirty = false;
let saving = false;
const openBosses = new Set();

function boss(id) {
  return (doc.bosses[id] ??= { attempts: 0, clears: 0, hitless: false, attacks: {}, phases: {} });
}

function clampCount(n) {
  return Math.max(0, Math.min(99999, n));
}

function countMastered(fight) {
  const b = doc.bosses[fight.id];
  if (!b) return 0;
  return fight.attacks.filter((a) => b.attacks[a.id] === 2).length;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function chip(kind, fightId, item, state) {
  return `<button type="button" class="dt-chip ${STATE_CLASSES[state]}" data-kind="${kind}" data-fight="${fightId}" data-id="${item.id}" aria-label="${escapeHtml(item.name)}, ${escapeHtml(STATE_LABELS[state])}">${escapeHtml(item.name)}</button>`;
}

function counter(fightId, field, label, value) {
  return `<div class="dt-counter">
    <span class="dt-counter-label">${escapeHtml(label)}</span>
    <div class="dt-counter-row">
      <button type="button" class="dt-step" data-act="dec" data-field="${field}" data-fight="${fightId}" aria-label="${escapeHtml(label)} minus">&minus;</button>
      <span class="dt-counter-value" data-value="${field}-${fightId}">${value}</span>
      <button type="button" class="dt-step" data-act="inc" data-field="${field}" data-fight="${fightId}" aria-label="${escapeHtml(label)} plus">+</button>
    </div>
  </div>`;
}

function bossCard(fight) {
  const b = doc.bosses[fight.id] ?? { attempts: 0, clears: 0, hitless: false, attacks: {}, phases: {} };
  const mastered = countMastered(fight);
  const total = fight.attacks.length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;
  const open = openBosses.has(fight.id);
  const phases = fight.phases.length
    ? `<h3 class="dt-sub">${escapeHtml(TEXT.phases)}</h3>
       <div class="dt-chips">${fight.phases.map((p) => chip('phases', fight.id, p, b.phases[p.id] ?? 0)).join('')}</div>`
    : '';
  return `<article class="dt-card" data-card="${fight.id}">
    <button type="button" class="dt-card-head" data-toggle="${fight.id}" aria-expanded="${open}">
      <span class="dt-card-name">${escapeHtml(fight.name)}</span>
      <span class="dt-card-count" data-count="${fight.id}">${mastered} ${escapeHtml(TEXT.of)} ${total}</span>
      <span class="dt-bar" aria-hidden="true"><span class="dt-bar-fill" data-bar="${fight.id}" style="width:${pct}%"></span></span>
    </button>
    <div class="dt-card-body" ${open ? '' : 'hidden'}>
      <div class="dt-counters">
        ${counter(fight.id, 'attempts', TEXT.attempts, b.attempts)}
        ${counter(fight.id, 'clears', TEXT.clears, b.clears)}
        <button type="button" class="dt-hitless ${b.hitless ? 'is-on' : ''}" data-act="hitless" data-fight="${fight.id}" aria-pressed="${b.hitless}">${escapeHtml(TEXT.hitless)}</button>
      </div>
      ${phases}
      <h3 class="dt-sub">${escapeHtml(TEXT.attacks)}</h3>
      <div class="dt-chips">${fight.attacks.map((a) => chip('attacks', fight.id, a, b.attacks[a.id] ?? 0)).join('')}</div>
    </div>
  </article>`;
}

function render() {
  const chapters = [...new Set(FIGHTS.map((f) => f.chapter))];
  listEl.innerHTML = chapters
    .map((ch) => `<section class="dt-chapter">
      <h2 class="dt-chapter-title">${escapeHtml(TEXT.chapter)} ${ch}</h2>
      ${FIGHTS.filter((f) => f.chapter === ch).map(bossCard).join('')}
    </section>`)
    .join('');
  updateOverall();
}

function updateOverall() {
  const total = FIGHTS.reduce((n, f) => n + f.attacks.length, 0);
  const mastered = FIGHTS.reduce((n, f) => n + countMastered(f), 0);
  overallEl.textContent = `${TEXT.overall}: ${mastered} ${TEXT.of} ${total}`;
  overallBarEl.style.width = `${total ? Math.round((mastered / total) * 100) : 0}%`;
}

function updateCard(fightId) {
  const fight = FIGHTS.find((f) => f.id === fightId);
  const mastered = countMastered(fight);
  const total = fight.attacks.length;
  qs(`[data-count="${fightId}"]`).textContent = `${mastered} ${TEXT.of} ${total}`;
  qs(`[data-bar="${fightId}"]`).style.width = `${total ? Math.round((mastered / total) * 100) : 0}%`;
  updateOverall();
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------
function setSaveLabel(kind) {
  const label = kind === 'saving' ? TEXT.saving : kind === 'failed' ? TEXT.saveFailed : TEXT.saved;
  saveEl.textContent = label;
  saveEl.dataset.state = kind;
}

function queueSave() {
  dirty = true;
  setSaveLabel('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  clearTimeout(saveTimer);
  if (saving || !dirty || !userId) return;
  saving = true;
  dirty = false;
  const { error } = await supabase
    .from(TABLE)
    .upsert({ user_id: userId, data: doc, updated_at: new Date().toISOString() });
  saving = false;
  if (error) {
    console.error('Progress save failed', error);
    dirty = true;
    setSaveLabel('failed');
    return;
  }
  // More changes may have arrived while that request was in flight.
  if (dirty) queueSave();
  else setSaveLabel('saved');
}

addEventListener('pagehide', () => { if (dirty) void save(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) void save();
});

// ---------------------------------------------------------------------------
// Interaction (one delegated listener)
// ---------------------------------------------------------------------------
listEl.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;

  if (target.dataset.toggle) {
    const id = target.dataset.toggle;
    const body = target.nextElementSibling;
    const open = body.hidden;
    body.hidden = !open;
    target.setAttribute('aria-expanded', String(open));
    if (open) openBosses.add(id); else openBosses.delete(id);
    return;
  }

  const fightId = target.dataset.fight;
  if (!fightId) return;
  const b = boss(fightId);

  if (target.dataset.kind) {
    const kind = target.dataset.kind;
    const id = target.dataset.id;
    const next = ((b[kind][id] ?? 0) + 1) % 3;
    if (next === 0) delete b[kind][id]; else b[kind][id] = next;
    target.className = `dt-chip ${STATE_CLASSES[next]}`;
    const name = target.textContent;
    target.setAttribute('aria-label', `${name}, ${STATE_LABELS[next]}`);
    if (kind === 'attacks') updateCard(fightId);
    queueSave();
    return;
  }

  if (target.dataset.act === 'hitless') {
    b.hitless = !b.hitless;
    target.classList.toggle('is-on', b.hitless);
    target.setAttribute('aria-pressed', String(b.hitless));
    queueSave();
    return;
  }

  if (target.dataset.act === 'inc' || target.dataset.act === 'dec') {
    const field = target.dataset.field;
    b[field] = clampCount(b[field] + (target.dataset.act === 'inc' ? 1 : -1));
    qs(`[data-value="${field}-${fightId}"]`).textContent = b[field];
    queueSave();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  await whenReady();
  const session = getSession();
  if (!session) return; // navigation.js sends signed out visitors to the login page
  userId = session.user.id;

  const { data, error } = await supabase.from(TABLE).select('data').eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('Progress load failed', error);
    statusEl.dataset.state = 'error';
    statusEl.textContent = TEXT.loadFailed;
    return; // never render an empty tracker that could overwrite saved progress
  }
  if (data?.data && typeof data.data === 'object' && data.data.bosses) doc = data.data;
  render();
  setSaveLabel('saved');
  saveEl.hidden = false;
}

init();
