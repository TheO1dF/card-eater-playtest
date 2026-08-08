import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAssetManifest, VERSION_ONLY_FILES } from "../scripts/asset-manifest.mjs";
import { ICON_TARGETS, encodePng } from "../scripts/generate-icons.mjs";
import { collectCardArtUrls, collectMetaIconUrls } from "../js/asset-urls.js";
import { CARD_LIBRARY } from "../js/data.js";
import { ITEM_LIBRARY } from "../js/items.js";
import { QUEST_LIBRARY } from "../js/quests.js";
import { createFusionCard } from "../js/mutations.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (file) => readFile(resolve(root, file), "utf8");

test("the web app manifest declares everything an install needs", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  assert.equal(manifest.name, "CardEater");
  assert.equal(manifest.short_name, "CardEater");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  // Relative start_url and scope keep the install working under any sub-path.
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/u);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/u);

  const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
  assert.ok(sizes.includes("192x192:any"), "needs a 192x192 icon");
  assert.ok(sizes.includes("512x512:any"), "needs a 512x512 icon");
  assert.ok(sizes.includes("512x512:maskable"), "needs a maskable icon");
  for (const icon of manifest.icons) assert.match(icon.src, /^\.\//u, icon.src);
});

test("index.html links the manifest and keeps the iOS install metadata", async () => {
  const html = await read("index.html");
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/u);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/assets\/icon-192\.png" \/>/u);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/u);
  assert.match(html, /name="mobile-web-app-capable" content="yes"/u);
  // The existing safe-area CSS only resolves with viewport-fit=cover.
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/u);
  assert.equal(html.match(/name="viewport"/gu).length, 1);
  // Registration must begin in <head>, before the large game module graph. A
  // late registration lets a phone create a home-screen shortcut before the
  // offline shell has even started caching.
  const boot = html.indexOf("./js/pwa-boot.js?v=1");
  const main = html.indexOf("./js/main.js?v=55");
  assert.ok(boot > 0 && boot < main, "PWA boot must load before the game entry module");
});

test("the early PWA boot and installed-app preparation remove the first-launch race", async () => {
  const boot = await read("js/pwa-boot.js");
  const offline = await read("js/offline.js");
  assert.match(boot, /navigator\.serviceWorker\.register\("\.\/sw\.js"/u);
  assert.match(boot, /__cardEaterServiceWorkerRegistration/u);
  assert.match(offline, /const STANDALONE_PREPARE_DELAY_MS = 0/u);
  assert.match(offline, /standalone \? STANDALONE_PREPARE_DELAY_MS : BACKGROUND_PREPARE_DELAY_MS/u);
  assert.match(offline, /globalThis\[EARLY_REGISTRATION_KEY\]/u,
    "the full offline API must reuse the worker registration started in head");
});

test("generated PWA icons are valid PNGs at the declared sizes", async () => {
  for (const target of ICON_TARGETS) {
    const onDisk = await readFile(resolve(root, target.file));
    assert.deepEqual(
      onDisk,
      encodePng(target.size, target.coverage),
      `${target.file} is stale — re-run node scripts/generate-icons.mjs`,
    );
    assert.deepEqual([...onDisk.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(onDisk.readUInt32BE(16), target.size);
    assert.equal(onDisk.readUInt32BE(20), target.size);
  }
});

test("the offline manifest covers every asset a full run requests", async () => {
  const manifest = await buildAssetManifest();
  const cards = Object.values(CARD_LIBRARY);

  // Every card, item and quest icon the renderer can ask for.
  const runtime = new Set([
    ...collectCardArtUrls(cards),
    ...collectMetaIconUrls([...ITEM_LIBRARY, ...QUEST_LIBRARY]),
  ]);
  // Mutation fusion cards reuse their component art, so nothing new is needed —
  // but assert it rather than trusting it.
  const [first, second] = cards.filter((card) => card.art_file).slice(0, 2);
  for (const url of collectCardArtUrls([createFusionCard(first, second, 1)])) runtime.add(url);

  const cached = new Set([...manifest.shell, ...manifest.art]);
  const missing = [...runtime].filter((url) => !cached.has(url));
  assert.deepEqual(missing, [], "these URLs would 404 during an offline run");

  assert.ok(manifest.art.length >= 100, `expected the full art set, got ${manifest.art.length}`);
  assert.match(manifest.version, /^[0-9a-f]{12}$/u);
});

test("the version hash moves when only the service worker changes", async () => {
  // sw.js is not a precached shell asset, so without this it would be invisible
  // to the version and a worker-only fix would reuse the old shell cache.
  assert.ok(VERSION_ONLY_FILES.includes("sw.js"));
  const manifest = await buildAssetManifest();
  assert.ok(!manifest.shell.some((url) => url.includes("sw.js")), "the worker must not precache itself");
});

test("the offline manifest includes the whole shell and excludes unused art", async () => {
  const manifest = await buildAssetManifest();
  const shell = new Set(manifest.shell);
  for (const required of ["./", "./index.html", "./manifest.webmanifest", "./js/pwa-boot.js?v=1", "./js/offline.js", "./js/asset-urls.js"]) {
    assert.ok(shell.has(required), `shell is missing ${required}`);
  }
  // Query strings must match what the browser actually requests.
  assert.ok(shell.has("./js/main.js?v=55"), "entry module must keep its ?v= string");
  assert.ok(shell.has("./styles.css?v=55"), "stylesheet must keep its ?v= string");

  const modules = (await read("js/main.js")).match(/from "\.\/([a-z0-9-]+\.js)"/gu) ?? [];
  for (const match of modules) {
    const name = match.replace(/from "\.\//u, "").replace(/"$/u, "");
    assert.ok(
      shell.has(`./js/${name}`) || shell.has(`./js/${name}?v=55`),
      `js/${name} is imported by main.js but is not in the shell`,
    );
  }

  // ~17 MB of legacy sheets ship to the CDN but are never requested, so
  // precaching them would triple a player's offline download.
  const everything = [...manifest.shell, ...manifest.art].join("\n");
  for (const unused of ["cards-atlas.webp", "card-sprites-set-", "-source.png", "legacy-v016"]) {
    assert.ok(!everything.includes(unused), `${unused} must stay out of the offline bundle`);
  }
});

test("the service worker keeps updates reachable and saves untouched", async () => {
  const worker = await read("sw.js");
  // The build stamps this, which is what gives each release its own cache.
  assert.match(worker, /const BUILD = "__CARDEATER_BUILD__";/u);
  assert.match(worker, /const SHELL_CACHE = `cardeater-shell-\$\{VERSION\}`/u);
  assert.match(worker, /const isDev = VERSION === "dev";/u,
    "a stamped dist build must keep release caching on localhost for verification");

  // A release must be served whole. Navigations used to be network-first while
  // modules stayed cache-first, so a deployment handed the player new markup
  // and the previous release's JavaScript — a deploy that visibly changed
  // nothing, because the worker in charge could only answer from its own cache.
  const navigation = worker.slice(worker.indexOf("async function handleNavigation"));
  const body = navigation.slice(0, navigation.indexOf("\n}"));
  assert.ok(body.indexOf("cache.match(INDEX_URL.href)") < body.indexOf("await fetch(request)"),
    "handleNavigation must prefer this release's cached index.html");
  assert.match(body, /if \(cached && !isDev\) return cached;/u);

  // ...and the new release has to take over by itself. Nothing in the UI ever
  // sent `apply-update`, so relying on it left every deployment in `waiting`.
  const install = worker.slice(worker.indexOf('addEventListener("install"'));
  assert.match(install.slice(0, install.indexOf("\n});")), /await self\.skipWaiting\(\)/u,
    "install must activate the new release without waiting to be asked");

  // Cleanup may only ever delete caches, never storage. Comments are stripped
  // so the rule about save data does not trip the check for save data.
  const code = worker.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  assert.ok(!/localStorage|indexedDB|sessionStorage/u.test(code),
    "the worker must never touch player save storage");
  assert.match(worker, /caches\.delete\(name\)/u);

  // Cache lookups must tolerate the ?v= revisions every asset URL carries.
  assert.ok(worker.includes("ignoreSearch: true"), "asset URLs carry ?v= query strings");
});

test("a running worker cannot delete the incoming release's precache", async () => {
  const worker = await read("sw.js");
  const start = worker.indexOf("async function pruneCaches");
  const body = worker.slice(start, worker.indexOf("\n}", start));
  // Observed on a real upgrade: the old worker's status-request prune deleted
  // the shell cache the new release had just filled, so that release would have
  // activated with nothing stored and no offline support.
  assert.match(body, /releases \|\| !name\.startsWith\("cardeater-shell-"\)/u,
    "only an activation may retire other releases' shell caches");
  assert.match(worker, /pruneCaches\(\{ releases: true \}\)/u, "activate prunes releases");
  assert.match(worker, /pruneCaches\(\{ releases: false \}\)/u, "a page request must not");
});

test("hidden menu rows are actually hidden", async () => {
  const css = await read("styles.css");
  // `.menu-wide-button { display: flex }` outranks the UA stylesheet's
  // `[hidden] { display: none }`, so the offline row shipped visible and inert
  // to every player, whatever the JavaScript did with the attribute.
  const shown = css.indexOf(".setting-toggle, .menu-wide-button {");
  const hiddenRule = css.search(/\.menu-wide-button\[hidden\][^{]*\{[^}]*display:\s*none/u);
  assert.ok(shown > 0, "the shared wide-button rule is missing");
  assert.ok(hiddenRule > shown, "a [hidden] rule must follow and override the display rule");
});


test("build and dev-server plumbing ship the offline files", async () => {
  const build = await read("scripts/build.mjs");
  assert.match(build, /manifest\.webmanifest/u);
  assert.match(build, /asset-manifest\.json/u);
  assert.match(build, /__CARDEATER_BUILD__/u);

  const headers = await read("_headers");
  // A long-cached worker or manifest is how a release becomes undiscoverable.
  for (const path of ["/sw.js", "/asset-manifest.json", "/manifest.webmanifest", "/index.html"]) {
    const block = headers.slice(headers.indexOf(`${path}\n`));
    assert.match(block.slice(0, 120), /Cache-Control: no-cache/u, `${path} must not be long-cached`);
  }
  assert.match(await read("scripts/serve.mjs"), /"\.webmanifest"/u);
});

test("a failing cache write can never break the response it came from", async () => {
  const worker = await read("sw.js");
  // The defect this guards against: `await cache.put(...)` on the response path
  // turns a full cache — routine on iOS — into a broken image or a dead module,
  // because a rejected respondWith is a network error the browser never retries.
  // It also puts a disk round-trip in front of every image decode.
  for (const name of ["handleNavigation", "handleShell", "handleArt"]) {
    const start = worker.indexOf(`async function ${name}`);
    assert.ok(start > 0, `${name} is missing`);
    const body = worker.slice(start, worker.indexOf("\n}", start));
    assert.ok(!body.includes("await cache.put"), `${name} must not await a cache write`);
  }
  // Writes go through one helper that clones, defers and swallows failures.
  const helper = worker.slice(worker.indexOf("function cacheInBackground"));
  assert.match(helper.slice(0, 400), /event\.waitUntil\(cache\.put\(key, copy\)\.catch\(/u);
});

test("one unreachable image does not cost the player offline support", async () => {
  const worker = await read("sw.js");
  const install = worker.slice(worker.indexOf('addEventListener("install"'));
  const body = install.slice(0, install.indexOf("\n});"));
  // A single dropped request on a phone connection used to reject the whole
  // install, which left the player with no offline support at all.
  assert.match(body, /if \(failed\.length\) failed = await addAllChunked/u, "must retry failures once");
  assert.match(body, /failed\.filter\(isCritical\)/u, "only code and markup may be fatal");
  assert.match(worker, /const isCritical = .*\\.\(\?:js\|css\)/u);
  // The art download reports a count, so the array return must be converted.
  assert.match(worker, /failed: failed\.length, ok: failed\.length === 0/u);
});

test("the offline download row ships hidden and fully translated", async () => {
  const html = await read("index.html");
  const button = html.match(/<button[^>]*id="offlineDownloadButton"[^>]*>/u)?.[0] ?? "";
  // Hidden until the worker reports in, so a browser that cannot support
  // offline play never shows a control that would not work.
  assert.match(button, /\shidden/u, "must ship hidden");
  assert.match(html, /id="offlineDownloadButton"[\s\S]{0,120}data-offline-state/u);

  const content = await read("js/i18n-content.js");
  for (const source of ["离线下载", "未下载", "已就绪", "下载失败"]) {
    assert.ok(content.includes(`"${source}":`), `${source} needs an English translation`);
  }
});
