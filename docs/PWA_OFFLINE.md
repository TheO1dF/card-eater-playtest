# PWA and offline play

CardEater stays a normal web game. Installing is optional, offline play is
opt-in, and none of it is required to play online. Nothing on this page changes
gameplay.

## What ships

| File | Role |
| --- | --- |
| `manifest.webmanifest` | Install metadata. Relative `start_url`/`scope` so it survives any deploy path. |
| `sw.js` | Service worker. `__CARDEATER_BUILD__` is stamped with a content hash at build time. |
| `js/offline.js` | Page-side API: registration, offline download, install prompt, update state. |
| `js/asset-urls.js` | Single source of truth for asset URLs, shared by `js/ui.js` and the build. |
| `scripts/asset-manifest.mjs` | Generates the offline file list from the real data modules. |
| `scripts/generate-icons.mjs` | Dependency-free PNG icon generator. |
| `dist/asset-manifest.json` | Build output. The worker fetches this to learn what to cache. |

## Caching strategy

Three request classes, three strategies. The `asset-manifest.json` `shell` list
decides which one a request gets, so no URL-path guessing is involved.

- **Navigations** — network first, cache fallback. This is what keeps players off
  stale HTML: a fresh `index.html` is always preferred while online, and the
  cached copy only appears when the network genuinely fails.
- **App shell** (`index.html`, `styles.css`, all 33 JS modules, icons,
  `card-sprites.webp`, `meta-atlas.webp`) — cache first with a background
  revalidate. Precached on install, ~1.1 MB across 43 entries.
- **Card and item art** (122 files, ~10 MB) — cache first, never precached. A
  miss goes to the network exactly as it always did, and the response is kept on
  the way past, so a normal online visitor stores only the cards they actually
  saw and pays no extra request for it. The *full* set is downloaded only when
  the player asks for it.

Cache lookups pass `ignoreSearch: true` because every asset URL carries a
hand-maintained `?v=N` revision.

### Writes on the response path are never awaited

Every strategy above stores its response through `cacheInBackground()`, which
clones the response and hands `cache.put()` to `event.waitUntil()` with a
`.catch()`. Nothing on the response path ever awaits a cache write.

This is not a micro-optimisation. A rejected `respondWith()` promise is a
**network error the browser does not retry**, so awaiting a write turns a full
cache — routine on iOS — into a permanently broken asset rather than an uncached
one. Because the app shell goes through the same path, an awaited write could
kill a JS module outright, and `js/main.js` never evaluating means no input
listeners, no audio unlock, and a title screen whose buttons do nothing while
still looking correct. Awaiting also puts a disk round-trip in front of every
image decode, which is invisible on a desktop and very visible on a phone.

If you add a strategy, store through `cacheInBackground()`. Never
`await cache.put(...)` before returning a response. A test enforces this against
the source of `handleNavigation`, `handleShell` and `handleArt`.

## Offline preparation

`downloadForOfflinePlay()` first asks for persistent storage
(`navigator.storage.persist()`), then fetches the art list in batches of 6,
reports progress, and **verifies against the cache** rather than trusting the
fetch results — it re-reads `cache.keys()` and only reports `ok: true` when every
file is present. Re-running it skips what is already stored. The persistence
request is advisory: Safari and Chrome grant it under different rules, and a
refusal only means the cache may be evicted after a long idle period.

Install precaching is deliberately forgiving. `addAllChunked()` returns the URLs
it could not store, install retries that list once, and only js/css/`index.html`
count as fatal (`isCritical`). One unreachable icon on a flaky phone connection
must not cost the player offline support entirely.

A launch with no network and no download shows the offline-not-ready state
(`shell_ready: true, offline_ready: false`) instead of failing: the shell boots
and the run stays playable. An art request that misses the cache while offline is
allowed to fail rather than being substituted with a placeholder, so a genuinely
missing asset stays visible instead of being masked; the card renders without its
art and the run continues, because `warmCardArt` swallows the decode error
([js/ui.js:93](../js/ui.js#L93)). That state is never surfaced during normal
online play.

## The UI

### Offline download — wired

One row in the existing menu overlay, using the same `menu-wide-button` styling
as the catalog rows, so no new CSS and no menu redesign:

- [index.html:151](../index.html#L151) — `#offlineDownloadButton`, ships `hidden`.
- [js/ui.js](../js/ui.js) — `renderOffline({ registered, status, progress, failed })`
  unhides it and drives the label: `未下载` → `done/total` → `已就绪`, or
  `下载失败`. Counts contain no Chinese, so they pass through runtime
  translation untouched.
- [js/main.js](../js/main.js) — `onOfflineDownload` calls
  `downloadForOfflinePlay()`, and `onOfflineStateChange` feeds progress back.

The row stays hidden until the worker has actually answered `offline-status`,
which needs an *active* worker. On a first visit there is none — the worker is
still installing and `navigator.serviceWorker.controller` is null — so
`startOfflineSupport()` re-queries on `controllerchange` and on
`navigator.serviceWorker.ready`. Without that the row never appeared until a
second visit, which on iOS may never come.

### Still connection points only

1. **Install App** — add a button to `.menu-catalog-buttons`, shown only when
   `state.installable` is true (Chromium). On iOS it stays hidden; the platform
   has no equivalent API and Add to Home Screen is a browser menu action.

   ```js
   import { promptInstall } from "./offline.js";
   ```

2. **Update notice** — when `state.update_ready` is true, show
   "A new version is available. Restart to update." and call `applyUpdate()`
   from the button. Gate it on `globalThis.cardEaterOffline.isRunInProgress()`
   so an active run is never interrupted; the update stays staged until the
   player is back on the home screen.

All strings must be added to `js/i18n-content.js` to stay translated.


## Updates

Each build hashes `index.html`, `styles.css`, `sw.js`, every JS module, and the
asset list into a 12-character version, which names the shell cache
(`cardeater-shell-<version>`). A new deployment therefore precaches into a fresh
cache while the old one keeps serving, so a player never mixes `index.html` from
release B with `main.js` from release A.

The worker never calls `skipWaiting()` on its own. It waits for the page to send
`apply-update`, which only happens when the player chooses to restart.

Activation deletes only `cardeater-*` caches whose version is not current. The
art cache (`cardeater-art`) is unversioned and deliberately kept across updates
so a 10 MB download is not repeated for a code change.

## Save data

Saves are `localStorage` under eight `cardeater.*` keys in
[js/platform.js](../js/platform.js). The worker never reads or writes
`localStorage`, `indexedDB`, or `sessionStorage` — a test asserts this against
the comment-stripped source. Cache cleanup is scoped to `caches.delete()` on
`cardeater-`-prefixed cache names, which cannot reach storage. No save format
changed, and no IndexedDB migration was needed.

## Development

`npm start` serves the repo root, where `sw.js` has no build stamp. The worker
detects the unreplaced placeholder and switches to dev mode: version `dev`,
network-first for everything, and `cache: "no-store"`, so a stale worker can
never make a code change look like it did not take effect. The dev server
generates `asset-manifest.json` on the fly and sends `Cache-Control: no-store`.

To reset by hand:

```js
// DevTools console on the page
const { resetOfflineSupport } = await import("./js/offline.js");
await resetOfflineSupport();  // unregisters the worker, drops cardeater-* caches, keeps saves
```

Or: DevTools → Application → Service Workers → Unregister, then Storage → Clear
site data with **Local and session storage unchecked** to keep saves.

## Manual test procedure

Run `npm run check`, then `npm run build` and serve `dist/` over HTTPS or
`localhost` (service workers require a secure context).

**A. Normal player, no install** — open the site, play a round, refresh
mid-game. Expect no install prompt, no offline UI, and unchanged behavior.
DevTools → Application → Cache Storage should show only `cardeater-shell-*`
(~1.1 MB), plus at most the handful of art files the cards you saw pulled in.

**B. Installed, online** — Android Chrome: menu → Install app (or the
`installable` state via `promptInstall()`). Launch from the home screen; expect
no browser chrome and a normal game. iOS Safari: Share → Add to Home Screen.

**C. Installed, offline** — open the menu and tap **离线下载 / Offline Download**,
then wait for the label to reach `已就绪 / Ready`. On iOS this must be done
**from inside the installed app**, not from Safari (see platform limitations).
Close the app, enable airplane mode, relaunch from the home screen. Start a new
run and exercise several systems (draft, shop, items, contracts, round summary).
All card and item art must render, localization must work, audio is procedural
so it needs no network. Finish a round, close the app, relaunch still offline,
and confirm the save resumed.

**D. Reconnect** — from state C, disable airplane mode and relaunch. Expect
normal online behavior, network-fetched navigations, and every save intact.

**E. Deployment update** — with release A installed and saves present, change a
source file and rebuild (the version hash changes). Open the app online: the
worker installs release B into a new cache and `update_ready` becomes true. Apply
it, then confirm `dist/asset-manifest.json`'s version matches the active shell
cache, that release A's shell cache is gone, that `cardeater-art` survived, and
that saves are unchanged.

## Platform limitations

- `beforeinstallprompt` is Chromium-only. iOS and Firefox have no install API;
  both still play and cache normally.
- **An iOS Home Screen web app has its own storage container, separate from
  Safari.** Preparing offline play in Safari does *not* prepare the installed
  app, and vice versa — each needs its own download. This is the most common
  reason an iOS player finds offline play "impossible after doing everything
  right". Verify by checking `art_cached` in both contexts.
- iOS caps total storage per site (roughly 50 MB in recent versions). The ~11 MB
  bundle fits, but iOS evicts data for apps unused for several weeks, so an
  offline download may need repeating. `downloadForOfflinePlay()` asks for
  persistent storage first, which reduces but does not eliminate this. Nothing
  breaks — the game re-downloads.
- iOS ignores `orientation` in the manifest.
- `viewport-fit=cover` was added so the `env(safe-area-inset-*)` rules already
  in `styles.css` resolve. On notched iPhones this makes browser-mode layout
  edge-to-edge. Verified in headless Edge at mobile and desktop viewports; not
  verified on physical iOS hardware.
- Service workers require HTTPS or `localhost`. `file://` is unsupported, and
  `startOfflineSupport()` returns early there.
