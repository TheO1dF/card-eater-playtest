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

- **Navigations** — this release's cached `index.html`, network only when there
  is none (first visit) or in dev. Markup and modules therefore always come
  from the same version-scoped cache. See [Updates](#updates) for why that
  matters and how a new release still arrives promptly.
- **App shell** (`index.html`, `styles.css`, all 33 JS modules, icons,
  `card-sprites.webp`, `meta-atlas.webp`) — cache first with a background
  revalidate. Precached on install, ~1.1 MB across 43 entries.
- **Card and item art** (122 files, ~10 MB) — cache first, never precached. A
  miss goes to the network exactly as it always did, and the response is kept on
  the way past, so a normal online visitor stores only the cards they actually
  saw and pays no extra request for it.

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

Preparation is automatic. `prepareOfflineInBackground()` runs on every load and,
45 seconds in, downloads whatever art is still missing. The delay means someone
who opens the page and leaves never pays for it; `navigator.connection.saveData`
and a missing network are both respected, and it does nothing once the art is
stored. It skips the persistent-storage request, because that prompts on some
browsers and this path is meant to be silent. So offline play prepares itself
for a player who stays a while and never finds the menu row.

`downloadForOfflinePlay()` is the same job on demand, from the menu row. It asks
for persistent storage (`navigator.storage.persist()`), fetches the art list in
batches of 6, reports progress, and **verifies against the cache** rather than
trusting the fetch results — it re-reads `cache.keys()` and only reports
`ok: true` when every file is present. Re-running it skips what is already
stored. The persistence request is advisory: Safari and Chrome grant it under
different rules, and a refusal only means the cache may be evicted after a long
idle period.

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

Since preparation is automatic, the row is mostly a progress readout; tapping it
just starts the download now instead of waiting.

`hidden` needs a stylesheet rule to work here. `.menu-wide-button` sets
`display: flex`, and an author `display` outranks the UA stylesheet's
`[hidden] { display: none }` — so the row shipped permanently visible, showing
its static markup label, whatever the JavaScript did with the attribute.
[styles.css](../styles.css) now carries an explicit
`.menu-wide-button[hidden] { display: none }`. Any new hidden-by-default control
in this menu needs the same treatment, and a test enforces it.

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

`state.update_ready` and `applyUpdate()` still exist, but nothing needs them:
releases activate on their own. Do not gate updates behind a notice unless you
wire the notice in the same change.

All strings must be added to `js/i18n-content.js` to stay translated.


## Updates

Each build hashes `index.html`, `styles.css`, `sw.js`, every JS module, and the
asset list into a 12-character version, which names the shell cache
(`cardeater-shell-<version>`).

**A release is served whole.** Everything a load needs comes out of one
version-scoped cache, which is immutable for that release — nothing refreshes
entries in place. Writing newer markup into an older release's cache would
recreate the exact defect this rule exists to prevent.

That defect is worth stating plainly, because it shipped. Navigations were
network-first while modules were cache-first, so after a deployment the player
received release B's `index.html` and release A's JavaScript: the worker still
in charge could only answer from its own cache. The page looked new and behaved
old — new markup rendered, none of the new code ran. It presented as a deploy
that changed nothing at all.

**A new release takes over by itself.** `install` precaches and then calls
`skipWaiting()`. The browser re-fetches `sw.js` on navigation
(`updateViaCache: "none"`), so the sequence is: visit → new worker installs and
activates → the next load comes wholly from the new cache. A player is at most
one load behind, never stranded.

The worker used to wait for the page to send `apply-update` instead. Nothing in
the UI ever sent it, so every deployment sat in `waiting` indefinitely. If you
are tempted to reintroduce a staged-update gate, wire the notice that applies it
in the same change — a gate nobody can open is indistinguishable from a broken
deploy. `skipWaiting()` swaps which worker answers the *next* request; it does
not reload the page, so an active run is never interrupted.

Activation deletes `cardeater-*` caches that are not current. A page-triggered
prune deliberately spares *other releases'* shell caches: sweeping those from a
live worker deleted the incoming release's precache while it was still
installing, which would have left that release to activate with nothing stored.
Only an activation knows it is the current release, so only an activation
retires the others. The art cache (`cardeater-art`) is unversioned and kept
across updates so a 10 MB download is never repeated for a code change.

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

**Dev mode also fires on `localhost` and `127.0.0.1`, whatever the build stamp
says** (`DEV_HOSTS` in [sw.js](../sw.js)). That is deliberate, and it is a trap
for verification: network-first serving means a caching bug simply cannot
reproduce there. The release-mixing defect above survived a full smoke run for
exactly this reason. **Verify caching and update behaviour on `127.0.0.2`** —
still a loopback secure context, so service workers work, but not a dev host:

```sh
npm run build
node scripts/serve.mjs 8771 dist 127.0.0.2
node scripts/pwa-smoke.mjs 9231 http://127.0.0.2:8771 .artifacts/smoke-x prepare
```

Check `dev_mode: false` in the reported status before believing any result.

To reset by hand:

```js
// DevTools console on the page
const { resetOfflineSupport } = await import("./js/offline.js");
await resetOfflineSupport();  // unregisters the worker, drops cardeater-* caches, keeps saves
```

Or: DevTools → Application → Service Workers → Unregister, then Storage → Clear
site data with **Local and session storage unchecked** to keep saves.

## Manual test procedure

Run `npm run check`, then `npm run build` and serve `dist/` over HTTPS,
`localhost`, or `127.0.0.2` (service workers require a secure context). Use
`127.0.0.2` for anything touching caching or updates — see Development.

**A. Normal player, no install** — open the site, play a round, refresh
mid-game. Expect no install prompt, no offline UI, and unchanged behavior.
DevTools → Application → Cache Storage should show only `cardeater-shell-*`
(~1.1 MB), plus at most the handful of art files the cards you saw pulled in.

**B. Installed, online** — Android Chrome: menu → Install app (or the
`installable` state via `promptInstall()`). Launch from the home screen; expect
no browser chrome and a normal game. iOS Safari: Share → Add to Home Screen.

**C. Installed, offline** — stay on the page for a minute and the art downloads
by itself; to prepare immediately, open the menu and tap **离线下载 / Offline
Download**. Either way wait for the label to reach `已就绪 / Ready`. On iOS this
must happen **from inside the installed app**, not from Safari (see platform
limitations). Close the app, enable airplane mode, relaunch from the home
screen. Start a new run and exercise several systems (draft, shop, items,
contracts, round summary). All card and item art must render, localization must
work, audio is procedural so it needs no network. Finish a round, close the app,
relaunch still offline, and confirm the save resumed.

**D. Reconnect** — from state C, disable airplane mode and relaunch. Expect
normal online behavior, network-fetched navigations, and every save intact.

**E. Deployment update** — with release A installed and saves present, change a
source file and rebuild (the version hash changes). Open the app online and do
nothing else: release B must install, activate, and be serving its own
JavaScript **without any prompt or tap**. Confirm `dist/asset-manifest.json`'s
version matches the active shell cache, that release A's shell cache is gone,
that `cardeater-art` survived, and that saves are unchanged. Then confirm the
page is running B's code and not just B's markup — a mixed release is the
failure this test exists to catch, and it looks like a deploy that did nothing:

```js
(await (await fetch("./js/main.js")).text()).includes("<a symbol only B has>")
```

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
