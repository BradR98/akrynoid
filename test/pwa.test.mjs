import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createTester } from '../lib/anchor-headless.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const t = createTester();

// ---- manifest
const m = JSON.parse(read('manifest.json'));
t.ok(m.name === 'Akrynoid' && m.short_name === 'Akrynoid', 'manifest: name + short_name');
t.ok(m.display === 'fullscreen' && m.orientation === 'portrait', 'manifest: fullscreen, portrait');
t.ok(/^#0[0-9a-f]{5}$/i.test(m.background_color) && /^#0[0-9a-f]{5}$/i.test(m.theme_color), 'manifest: dark background_color + theme_color');
t.ok(m.start_url && m.scope, 'manifest: start_url + scope are relative (works under /akrynoid/)');
for (const size of [192, 512]) {
  const ic = m.icons.find((i) => i.sizes === `${size}x${size}`);
  const ok = ic && existsSync(join(root, ic.src));
  let dims = '';
  if (ok) { const b = readFileSync(join(root, ic.src)); dims = `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; t.ok(b.subarray(1, 4).toString() === 'PNG', `icon ${size}: is a PNG`); }
  t.ok(ok && dims === `${size}x${size}`, `icon ${size}: listed in manifest, exists, real size ${dims}`);
}

// ---- index.html
const html = read('index.html');
t.ok(/<link rel="manifest" href="manifest.json">/.test(html), 'index: links manifest.json');
t.ok(/name="theme-color"/.test(html) && /name="apple-mobile-web-app-capable" content="yes"/.test(html) && /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(html), 'index: theme-color + apple PWA meta tags');
t.ok(/serviceWorker\.register\('\.\/sw\.js'\)/.test(html) && /addEventListener\('load'/.test(html), 'index: registers sw.js on load');

// ---- service worker (run in a sandbox with fake caches / fetch)
const swSrc = read('sw.js');
const listeners = {}, store = new Map();
const mkCache = (name) => { if (!store.has(name)) store.set(name, new Map()); const c = store.get(name);
  return { addAll: async (urls) => urls.forEach((u) => c.set(new URL(u, 'https://x.test/akrynoid/sw.js').href, 'cached:' + u)),
           put: async (r, res) => { c.set(r.url, res); }, c }; };
let online = true, fetched = [];
const sandbox = {
  self: { location: { origin: 'https://x.test' }, addEventListener: (e, f) => { listeners[e] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
  caches: { open: async (n) => mkCache(n), keys: async () => [...store.keys()], delete: async (k) => store.delete(k),
            match: async (req, o = {}) => { let url = typeof req === 'string' ? new URL(req, 'https://x.test/akrynoid/').href : req.url; if (o.ignoreSearch) url = url.split('?')[0]; for (const c of store.values()) if (c.has(url)) return c.get(url); return undefined; } },
  fetch: async (req) => { fetched.push(req.url); if (!online) throw new Error('offline'); return { ok: true, url: req.url, clone() { return this; } }; },
  URL, Response: { error: () => 'error-response' }, Promise,
};
vm.runInNewContext(swSrc, sandbox);
const run = async (type, ev) => { let p; listeners[type]({ ...ev, waitUntil: (x) => { p = x; }, respondWith: (x) => { p = x; } }); return p; };

const lib = readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js'));
const listed = [...swSrc.matchAll(/'([^']+\.(?:js|json|png|html))'/g)].map((x) => x[1]);
for (const f of ['index.html', 'game.js', 'manifest.json', ...m.icons.map((i) => i.src), 'icons/icon-180.png']) t.ok(listed.includes(f), `sw precache lists ${f}`);
const imported = [...read('game.js').matchAll(/from '\.\/([^']+\.js)'/g)].map((x) => x[1]).filter((f) => !f.startsWith('lib/'));
t.ok(imported.includes('levels.js') && imported.includes('version.js') && imported.every((f) => listed.includes(f)), `sw precache lists every local module game.js imports (${imported.join(', ')})`);
t.ok(/const CACHE = 'akrynoid-v12'/.test(swSrc), 'cache version bumped to v12');
t.ok(lib.length >= 3 && lib.every((f) => listed.includes('lib/' + f)), `sw precache lists every file in lib/ (${lib.join(', ')})`);
t.ok(listed.every((f) => existsSync(join(root, f))), 'every precached path exists on disk');

await run('install', {});
const cacheName = [...store.keys()][0];
t.ok(store.size === 1 && store.get(cacheName).size >= listed.length, `install: precaches the whole app (${store.get(cacheName).size} entries)`);
store.set('akrynoid-old', new Map()); await run('activate', {});
t.ok(!store.has('akrynoid-old') && store.has(cacheName), 'activate: old caches are deleted');
online = false; fetched = [];
const hit = await run('fetch', { request: { method: 'GET', url: 'https://x.test/akrynoid/game.js', mode: 'no-cors' } });
t.ok(hit === 'cached:game.js' && fetched.length === 0, 'fetch: cache-first, served offline without touching the network');
const hit2 = await run('fetch', { request: { method: 'GET', url: 'https://x.test/akrynoid/lib/anchor-loop.js?v=1', mode: 'no-cors' } });
t.ok(hit2 === 'cached:lib/anchor-loop.js', 'fetch: query strings are ignored when matching the cache');
const nav = await run('fetch', { request: { method: 'GET', url: 'https://x.test/akrynoid/nowhere', mode: 'navigate' } });
t.ok(nav === 'cached:index.html', 'fetch: offline navigation to an unknown URL falls back to index.html');
online = true; fetched = [];
const miss = await run('fetch', { request: { method: 'GET', url: 'https://x.test/akrynoid/extra.txt', mode: 'no-cors' } });
t.ok(fetched.length === 1 && miss.ok, 'fetch: uncached same-origin asset goes to the network');
let handled = false; listeners.fetch({ request: { method: 'POST', url: 'https://x.test/a' }, respondWith: () => { handled = true; } });
listeners.fetch({ request: { method: 'GET', url: 'https://other.test/a' }, respondWith: () => { handled = true; } });
t.ok(!handled, 'fetch: ignores non-GET and cross-origin requests');

process.exit(t.summary());
