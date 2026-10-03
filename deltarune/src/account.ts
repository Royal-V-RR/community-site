// Account sync: uses the community site's login session (same origin, same
// browser storage) and keeps one saved document per account in Supabase.
// When the community site config is not reachable (local dev, standalone
// deploy) connect() returns null and the site keeps using browser storage.

const CONFIG_URL = new URL('../js/config.js', document.baseURI).href;
const LOGIN_URL = new URL('../login.html', document.baseURI).href;
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const TABLE = 'deltarune_progress';
const SAVE_DELAY_MS = 1500;

export interface Account {
  load(): Promise<unknown | null>;
  save(data: unknown): void;
}

export async function connect(): Promise<Account | null> {
  let cfg: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };
  try {
    cfg = await import(/* @vite-ignore */ CONFIG_URL);
  } catch {
    return null;
  }
  const { createClient } = await import(/* @vite-ignore */ SUPABASE_ESM);
  const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const { data: sess } = await client.auth.getSession();
  const userId: string | undefined = sess.session?.user.id;
  if (!userId) {
    location.replace(`${LOGIN_URL}?redirect=${encodeURIComponent(location.pathname)}`);
    return new Promise<never>(() => {});
  }

  let pending: unknown = null;
  let timer: number | undefined;

  const push = async (): Promise<void> => {
    if (pending === null) return;
    const data = pending;
    pending = null;
    const { error } = await client.from(TABLE).upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
    if (error) {
      // Keep the data queued so the next change retries it.
      pending ??= data;
      console.error('Progress save failed', error);
    }
  };

  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    void push();
  };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  return {
    async load() {
      const { data, error } = await client.from(TABLE).select('data').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.data ?? null;
    },
    save(data) {
      pending = data;
      clearTimeout(timer);
      timer = window.setTimeout(flush, SAVE_DELAY_MS);
    },
  };
}
