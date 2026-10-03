import { connect } from './account.ts';
import { store } from './store.ts';
import { App } from './ui/app.ts';

const root = document.getElementById('root')!;

async function start(): Promise<void> {
  // Signed in accounts keep their own progress; without one the site uses browser storage.
  const account = await connect();
  if (account) store.attachAccount(await account.load(), (data) => account.save(data));
  const app = new App(root);
  await app.boot();
}

start().catch((e: unknown) => {
  const el = document.getElementById('fatal')!;
  el.textContent = String((e as Error)?.message ?? e);
  el.hidden = false;
});
