// Browser-local persistence: settings, records and last-used loadouts. Every access tolerates storage being unavailable.
import { DEFAULT_BINDINGS, type Bindings } from './engine/input.ts';

export interface Settings {
  volume: number; // 0..1 master for game audio
  sfxVolume: number; // menu sounds
  scale: 'fit' | 'integer';
  showHud: boolean;
  bindings: Bindings;
  seenIntro: Record<string, boolean>;
  lastFight?: string;
}

export interface Record_ {
  attempts: number;
  clears: number;
  bestTime: number | null; // seconds
  bestHits: number | null;
  hitless: boolean;
  endlessBest: number;
}

const KEY = 'drweb.v1';

interface Saved {
  settings: Settings;
  records: Record<string, Record_>;
  loadouts: Record<string, unknown>;
}

const DEFAULTS: Saved = {
  settings: { volume: 0.8, sfxVolume: 0.8, scale: 'fit', showHud: true, bindings: DEFAULT_BINDINGS, seenIntro: {} },
  records: {},
  loadouts: {},
};

function normalize(s: Partial<Saved>): Saved {
  return {
    settings: { ...DEFAULTS.settings, ...s.settings, bindings: { ...DEFAULTS.settings.bindings, ...s.settings?.bindings } },
    records: s.records ?? {},
    loadouts: s.loadouts ?? {},
  };
}

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return normalize(JSON.parse(raw) as Partial<Saved>);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

const state = read();

// When set, saves go to the signed in account instead of browser storage.
let sink: ((data: Saved) => void) | null = null;

function write(): void {
  if (sink) { sink(state); return; }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

export const store = {
  /** Switches persistence to an account: loads its saved data and routes every save to it. */
  attachAccount(saved: unknown, onSave: (data: unknown) => void): void {
    Object.assign(state, saved ? normalize(saved as Partial<Saved>) : structuredClone(DEFAULTS));
    sink = onSave;
  },
  get settings(): Settings { return state.settings; },
  saveSettings(): void { write(); },

  record(key: string): Record_ {
    return state.records[key] ?? { attempts: 0, clears: 0, bestTime: null, bestHits: null, hitless: false, endlessBest: 0 };
  },
  updateRecord(key: string, fn: (r: Record_) => void): Record_ {
    const r = this.record(key);
    fn(r);
    state.records[key] = r;
    write();
    return r;
  },

  loadout<T>(boss: string): T | null {
    return (state.loadouts[boss] as T) ?? null;
  },
  saveLoadout(boss: string, l: unknown): void {
    state.loadouts[boss] = l;
    write();
  },
};
