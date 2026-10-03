// Gives the page cross origin isolation on hosts that cannot set headers
// (GitHub Pages). The game needs it for SharedArrayBuffer. Where the real
// headers already exist (Cloudflare Pages, the dev server) this does nothing.
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const r = e.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    e.respondWith(
      fetch(r).then((res) => {
        if (res.status === 0) return res;
        const h = new Headers(res.headers);
        h.set('Cross-Origin-Embedder-Policy', 'require-corp');
        h.set('Cross-Origin-Opener-Policy', 'same-origin');
        h.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
      }).catch((err) => { console.error(err); return Response.error(); })
    );
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator) {
  const src = document.currentScript.src;
  navigator.serviceWorker.register(src).then((reg) => {
    const reload = () => {
      if (sessionStorage.getItem('drweb:coi')) return; // never loop
      sessionStorage.setItem('drweb:coi', '1');
      location.reload();
    };
    if (reg.active && !navigator.serviceWorker.controller) reload();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'activated') reload(); });
    });
  }).catch((e) => console.error('coi service worker failed', e));
}
