// CardEater service worker.
//
// Design rules, in priority order:
//  1. The site stays a normal web game. Installation is never required, and a
//     failed or absent worker must never stop a page from loading.
//  2. A load is served wholly from one version-scoped cache, so a client can
//     never mix index.html from release B with js/engine.js from release A.
//  3. A new release installs, precaches, and takes over on its own, so a
//     deployment always reaches players without asking them to do anything.
//  4. Player saves live in localStorage and are untouched by everything here.
//     Cache cleanup only ever deletes caches, never storage.

const BUILD = "__CARDEATER_BUILD__";
const VERSION = BUILD.startsWith("__CARDEATER") ? "dev" : BUILD;
const SHELL_CACHE = `cardeater-shell-${VERSION}`;
// Art URLs already carry their own `?v=` revision, so they survive releases and
// are pruned by URL instead of being re-downloaded on every deployment.
const ART_CACHE = "cardeater-art";
const MANIFEST_URL = new URL("./asset-manifest.json", self.location);
const INDEX_URL = new URL("./index.html", self.location);

// The unstamped source worker is development mode and stays network-first.
// A stamped dist/ build keeps release behaviour even on localhost, which lets
// the real cache-first/offline path be tested without DNS, proxies or TLS.
const isDev = VERSION === "dev";

let manifestPromise = null;

function loadManifest() {
  manifestPromise ??= (async () => {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`asset-manifest.json: ${response.status}`);
    const manifest = await response.json();
    const cache = await caches.open(SHELL_CACHE);
    // Storing it is best effort: a full cache must not stop the worker from
    // knowing what to serve for the rest of this session.
    await cache.put(MANIFEST_URL.href, new Response(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })).catch(() => {});
    return manifest;
  })().catch(async (error) => {
    manifestPromise = null;
    const cached = await caches.match(MANIFEST_URL.href, { cacheName: SHELL_CACHE });
    if (cached) return cached.json();
    throw error;
  });
  return manifestPromise;
}

const absolute = (url) => new URL(url, self.location).href;

/**
 * Stores a response without blocking or failing the request that produced it.
 *
 * This is the difference between a full cache meaning "not cached" and a full
 * cache meaning a broken image: a rejected `respondWith` is a network error, and
 * the browser does not retry it. Awaiting the write also puts a disk round-trip
 * in front of every image decode, which is invisible on a desktop and very
 * visible on a phone.
 */
function cacheInBackground(event, cache, key, response) {
  const copy = response.clone();
  event.waitUntil(cache.put(key, copy).catch(() => {
    // Out of quota, or storage denied in private browsing. Play continues.
  }));
}

/**
 * Fetches one URL into a cache, reporting failure instead of throwing so a
 * single bad asset can never abort a whole precache.
 *
 * `cache: "reload"` is what guarantees a genuinely fresh copy rather than one
 * the HTTP cache already had. It is retried without that option because some
 * browsers reject the request init outright.
 */
async function storeOne(cache, url) {
  for (const init of [{ cache: "reload", credentials: "same-origin" }, { credentials: "same-origin" }]) {
    try {
      const response = await fetch(new Request(url, init));
      if (!response.ok) continue;
      await cache.put(url, response);
      return true;
    } catch {
      // Try the simpler request, then give up on this URL.
    }
  }
  return false;
}

/** Returns the URLs that could not be stored. Six at a time so a 10 MB
 *  precache does not saturate a phone connection. */
async function addAllChunked(cache, urls, onProgress) {
  const pending = [...urls];
  const total = pending.length;
  const failed = [];
  let done = 0;
  const workers = Array.from({ length: Math.min(6, total) }, async () => {
    for (let url = pending.shift(); url !== undefined; url = pending.shift()) {
      if (!(await storeOne(cache, url))) failed.push(url);
      done += 1;
      onProgress?.(done, total, failed.length);
    }
  });
  await Promise.all(workers);
  return failed;
}

// Code and markup decide whether the game can boot at all. Images do not, so a
// missing icon must not cost the player offline support entirely.
const isCritical = (url) => /\.(?:js|css)(?:\?|$)/u.test(url)
  || url === INDEX_URL.href
  || url === absolute("./");

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const manifest = await loadManifest();
    const cache = await caches.open(SHELL_CACHE);
    // The shell is small (~1.1 MB) and is what makes an offline launch possible
    // at all, so it is the only thing precached automatically.
    let failed = await addAllChunked(cache, manifest.shell.map(absolute));
    // One retry: a single dropped request on a phone connection should not cost
    // the player offline support.
    if (failed.length) failed = await addAllChunked(cache, failed);
    const fatal = failed.filter(isCritical);
    if (fatal.length) throw new Error(`shell precache incomplete: ${fatal.join(", ")}`);
    // Activate as soon as the new release is fully cached, instead of waiting
    // for a page to ask. Nothing in the UI ever sent `apply-update`, so a
    // deployed release used to sit in `waiting` forever while the previous
    // worker kept serving its own cached JavaScript — players received the new
    // index.html over the network and the old modules from cache, which looks
    // exactly like a deploy that changed nothing. This does not reload anyone:
    // it only decides which worker answers the *next* load.
    await self.skipWaiting();
  })());
});

/**
 * Deletes caches this release does not use. Only ever touches `cardeater-*`
 * cache entries, so player saves in localStorage cannot be affected.
 *
 * `releases` is false for anything triggered by a page. A running worker that
 * swept other releases' shell caches would delete the *incoming* release's
 * precache while it was still installing, leaving that release to activate with
 * an empty cache and no offline support at all. Only an activation knows it is
 * the current release, so only an activation may retire the others.
 */
async function pruneCaches({ releases = false } = {}) {
  const names = await caches.keys();
  const obsolete = names.filter((name) => name.startsWith("cardeater-")
    && name !== SHELL_CACHE && name !== ART_CACHE
    && (releases || !name.startsWith("cardeater-shell-")));
  await Promise.all(obsolete.map((name) => caches.delete(name)));

  // Drop art this release no longer references. Art the player already
  // downloaded that is still current stays put, so an update never costs a
  // second 10 MB download.
  const manifest = await loadManifest().catch(() => null);
  let pruned = 0;
  if (manifest) {
    const wanted = new Set(manifest.art.map(absolute));
    const cache = await caches.open(ART_CACHE);
    for (const request of await cache.keys()) {
      if (wanted.has(request.url)) continue;
      await cache.delete(request);
      pruned += 1;
    }
  }
  return { deleted: obsolete, pruned_art: pruned };
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await pruneCaches({ releases: true });
    await self.clients.claim();
  })());
});

// Shown only when the network is gone and the shell was never cached. It renders
// before any script runs, so js/i18n.js cannot reach it — hence both languages
// inline rather than the usual runtime translation.
const OFFLINE_FALLBACK = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>CardEater</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:24px;
background:#120f1c;color:#f8edcf;font-family:monospace;text-align:center;line-height:1.6}
b{color:#ffd166;display:block;margin-bottom:10px;font-size:15px}
p{margin:12px 0 0;color:#b6a9c9;font-size:13px}</style></head><body><div>
<b>离线 · Offline</b>游戏尚未完成离线下载。<br>请联网一次后重试。
<p>This game has not finished downloading for offline play.<br>
Connect to the Internet once and try again.</p></div></body></html>`;

const offlineResponse = () => new Response(OFFLINE_FALLBACK, {
  status: 503,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
});

/**
 * Navigations: this release's cached index.html, network only when there is
 * none (first visit) or in dev.
 *
 * Serving navigations from the network while serving modules from a
 * version-scoped cache is what produced the "deploy that changed nothing" bug:
 * the page got release B's markup and release A's JavaScript, because the
 * worker still in charge could only answer from its own cache. Reading both
 * from one immutable per-release cache is what makes a load internally
 * consistent.
 *
 * Nothing refreshes this entry in place, deliberately — writing newer markup
 * into an older release's cache would recreate exactly that mismatch. Updates
 * arrive the one way that keeps a release whole: the browser re-fetches sw.js
 * on navigation (`updateViaCache: "none"`), the new worker precaches itself and
 * calls `skipWaiting()`, and the next load comes wholly from the new cache. So
 * a player is at most one load behind, never stranded.
 */
async function handleNavigation(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(INDEX_URL.href);
  if (cached && !isDev) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cacheInBackground(event, cache, INDEX_URL.href, response);
    return response;
  } catch {
    return cached
      ?? await caches.match(request, { cacheName: SHELL_CACHE, ignoreSearch: true })
      ?? offlineResponse();
  }
}

/** Shell code and styles: served from this release's cache, so never mixed. */
async function handleShell(event, request, cache, cached) {
  // Offline, `cached` is the only possible answer. Online in dev the network
  // wins, so a code change can never be masked by stale worker state.
  if (cached && !isDev) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cacheInBackground(event, cache, request, response);
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/**
 * Art: cache first, and a miss is stored on the way past so a normal online
 * visitor pays only for the cards they actually see.
 */
async function handleArt(event, request) {
  const cache = await caches.open(ART_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cacheInBackground(event, cache, request, response);
  return response;
}

// The manifest decides which strategy a request gets, so there is no path
// guessing and the worker keeps working under any deployment sub-path.
let shellPathsPromise = null;
const withoutQuery = (href) => href.split("?")[0];

function shellPaths() {
  shellPathsPromise ??= loadManifest()
    .then((manifest) => new Set(manifest.shell.map((url) => withoutQuery(absolute(url)))))
    .catch(() => null);
  return shellPathsPromise;
}

async function handleAsset(event, request) {
  const paths = await shellPaths();
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached || paths?.has(withoutQuery(request.url))) return handleShell(event, request, cache, cached);
  return handleArt(event, request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (withoutQuery(url.href) === MANIFEST_URL.href) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request));
    return;
  }
  event.respondWith(handleAsset(event, request));
});

async function offlineStatus() {
  const manifest = await loadManifest().catch(() => null);
  const cache = await caches.open(ART_CACHE);
  const keys = new Set((await cache.keys()).map((request) => withoutQuery(request.url)));
  const art = manifest?.art.map((url) => withoutQuery(absolute(url))) ?? [];
  const cached = art.filter((url) => keys.has(url)).length;
  return {
    version: VERSION,
    dev_mode: isDev,
    art_total: art.length,
    art_cached: cached,
    // The shell alone is enough to launch; art still streams in when online.
    shell_ready: Boolean(await caches.match(INDEX_URL.href, { cacheName: SHELL_CACHE })),
    offline_ready: art.length > 0 && cached === art.length,
  };
}

async function downloadOffline(source) {
  const manifest = await loadManifest();
  const cache = await caches.open(ART_CACHE);
  const urls = manifest.art.map(absolute);
  const keys = new Set((await cache.keys()).map((request) => withoutQuery(request.url)));
  const missing = urls.filter((url) => !keys.has(withoutQuery(url)));
  const failed = await addAllChunked(cache, missing, (done, total) => {
    source?.postMessage({ type: "offline-progress", done: keys.size + done, total: urls.length });
  });
  // Verify against the cache rather than trusting the fetch results.
  const status = await offlineStatus();
  return { ...status, failed: failed.length, ok: failed.length === 0 && status.offline_ready };
}

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  const reply = (payload) => {
    event.ports?.[0]?.postMessage(payload);
    if (!event.ports?.length) event.source?.postMessage({ type: `${type}-result`, ...payload });
  };
  if (type === "offline-status") {
    event.waitUntil(pruneCaches({ releases: false })
      .catch(() => null)
      .then(offlineStatus)
      .then(reply, (error) => reply({ error: String(error) })));
    return;
  }
  if (type === "offline-download") {
    event.waitUntil(downloadOffline(event.source).then(reply, (error) => reply({ ok: false, error: String(error) })));
    return;
  }
  if (type === "offline-clear") {
    event.waitUntil(caches.delete(ART_CACHE).then(() => offlineStatus()).then(reply));
    return;
  }
  // Kept so a page that knows an update is staged can still hurry it along.
  // Installs now call skipWaiting() themselves, so nothing depends on this.
  if (type === "apply-update") event.waitUntil(self.skipWaiting());
});
