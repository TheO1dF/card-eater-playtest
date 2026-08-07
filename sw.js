// CardEater service worker.
//
// Design rules, in priority order:
//  1. The site stays a normal web game. Installation is never required, and a
//     failed or absent worker must never stop a page from loading.
//  2. Navigations are network-first, so a new deployment is always discovered
//     and nobody gets stranded on a stale index.html.
//  3. Shell responses come from one version-scoped cache, so a client never
//     mixes index.html from release B with js/engine.js from release A.
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

// On localhost the code under test changes constantly, so shell requests go to
// the network first. Stale worker state must never make a code change look
// like it did not take effect.
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const isDev = VERSION === "dev" || DEV_HOSTS.has(self.location.hostname);

let manifestPromise = null;

function loadManifest() {
  manifestPromise ??= (async () => {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`asset-manifest.json: ${response.status}`);
    const manifest = await response.json();
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(MANIFEST_URL, new Response(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
    return manifest;
  })().catch(async (error) => {
    manifestPromise = null;
    const cached = await caches.match(MANIFEST_URL, { cacheName: SHELL_CACHE });
    if (cached) return cached.json();
    throw error;
  });
  return manifestPromise;
}

const absolute = (url) => new URL(url, self.location).href;

async function addAllChunked(cache, urls, onProgress) {
  const pending = [...urls];
  let done = 0;
  let failed = 0;
  // Six at a time keeps a 10 MB precache from saturating a phone connection.
  const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
    for (let url = pending.shift(); url !== undefined; url = pending.shift()) {
      try {
        const request = new Request(url, { cache: "reload", credentials: "same-origin" });
        const response = await fetch(request);
        if (!response.ok) throw new Error(String(response.status));
        await cache.put(url, response);
      } catch {
        failed += 1;
      }
      done += 1;
      onProgress?.(done, pending.length + done, failed);
    }
  });
  await Promise.all(workers);
  return failed;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const manifest = await loadManifest();
    const cache = await caches.open(SHELL_CACHE);
    // The shell is small (under 1 MB) and is what makes an offline launch
    // possible at all, so it is the only thing precached automatically.
    const failed = await addAllChunked(cache, manifest.shell.map(absolute));
    if (failed) throw new Error(`shell precache incomplete: ${failed} failed`);
  })());
});

/**
 * Deletes caches this release does not use. Only ever touches `cardeater-*`
 * cache entries, so player saves in localStorage cannot be affected.
 *
 * Also runs on status requests, not just activation: a cache orphaned by an
 * interrupted activation would otherwise survive until some later release
 * happened to activate cleanly.
 */
async function pruneCaches() {
  const names = await caches.keys();
  const obsolete = names
    .filter((name) => name.startsWith("cardeater-") && name !== SHELL_CACHE && name !== ART_CACHE);
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
    await pruneCaches();
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

/** Navigations: network first, cached shell second, offline notice last. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(INDEX_URL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(INDEX_URL, { cacheName: SHELL_CACHE })
      ?? await caches.match(request, { cacheName: SHELL_CACHE, ignoreSearch: true });
    return cached ?? offlineResponse();
  }
}

/** Shell code and styles: served from this release's cache, so never mixed. */
async function handleShell(request, cache, cached) {
  if (!isDev) {
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

/**
 * Art: cache first, and a miss is filled quietly in the background so a normal
 * online visitor pays only for the cards they actually see.
 */
async function handleArt(request) {
  const cache = await caches.open(ART_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
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

async function handleAsset(request) {
  const paths = await shellPaths();
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached || paths?.has(withoutQuery(request.url))) return handleShell(request, cache, cached);
  return handleArt(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (withoutQuery(url.href) === MANIFEST_URL.href) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  event.respondWith(handleAsset(request));
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
    shell_ready: Boolean(await caches.match(INDEX_URL, { cacheName: SHELL_CACHE })),
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
  return { ...status, failed, ok: failed === 0 && status.offline_ready };
}

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  const reply = (payload) => {
    event.ports?.[0]?.postMessage(payload);
    if (!event.ports?.length) event.source?.postMessage({ type: `${type}-result`, ...payload });
  };
  if (type === "offline-status") {
    event.waitUntil(pruneCaches()
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
  // Applying an update is the page's call, never the worker's: the page decides
  // it is safe to reload so an active run is not interrupted.
  if (type === "apply-update") event.waitUntil(self.skipWaiting());
});
