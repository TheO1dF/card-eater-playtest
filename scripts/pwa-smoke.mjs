// Drives headless Edge over CDP to verify the PWA tests from docs/PWA_OFFLINE.md:
// A (normal visit), B (shell-only offline interaction), C (installed-app
// automatic preparation and offline launch), D (reconnect), E (update).
//
//   node scripts/pwa-smoke.mjs [debugPort] [url] [outputDir]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debugPort = Number(process.argv[2] ?? 9223);
const gameUrl = (process.argv[3] ?? "http://127.0.0.1:8765").replace(/\/+$/u, "");
const outputDir = resolve(process.argv[4] ?? ".artifacts/smoke-pwa");
// "prepare" runs A/C/D and leaves the art cache and a save key in place.
// "update" runs E and must be called after a genuinely rebuilt dist/.
const phase = process.argv[5] ?? "prepare";
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, mobile: true, scale: 3 },
  { name: "desktop", width: 1440, height: 900, mobile: false, scale: 1 },
];

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const pages = targets.filter((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
// Edge also exposes its own dialogs as page targets, and attaching to one of
// those fails later with InvalidStateError on the first caches access. Prefer
// a page already on the game's origin.
const origin = new URL(gameUrl).host;
const target = pages.find((entry) => entry.url.includes(origin)) ?? pages.find((entry) => !entry.url.startsWith("edge://"));
if (!target) throw new Error(`No debuggable Edge page found on ${origin}.`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  socket.addEventListener("open", ok, { once: true });
  socket.addEventListener("error", fail, { once: true });
});

let messageId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id === undefined) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
  const timer = setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`${method} timed out`))), 180_000);
  // Completed CDP calls leave these defensive timers behind. They must not keep
  // the smoke-test Node process alive for three minutes after its report is
  // already written.
  timer.unref?.();
});

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// The version the built dist/ actually contains. Every check is asserted
// against this so a stale worker can never let the run pass by accident.
const expectedVersion = (await (await fetch(`${gameUrl}/asset-manifest.json`)).json()).version;

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlackboxing: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await mkdir(outputDir, { recursive: true });

async function capture(name) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(resolve(outputDir, `${name}.png`), Buffer.from(shot.data, "base64"));
}

async function reload() {
  await send("Page.navigate", { url: gameUrl });
  await wait(2500);
}

const setOffline = (offline) => send("Network.emulateNetworkConditions", {
  offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});

const status = () => evaluate(`(async () => {
  const { refreshOfflineStatus } = await import("./js/offline.js");
  return await refreshOfflineStatus();
})()`);

const swState = () => evaluate(`(async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  const names = await caches.keys();
  const shell = names.find((name) => name.startsWith("cardeater-shell-"));
  const shellKeys = shell ? (await (await caches.open(shell)).keys()).length : 0;
  const artKeys = names.includes("cardeater-art") ? (await (await caches.open("cardeater-art")).keys()).length : 0;
  return {
    controlled: Boolean(navigator.serviceWorker.controller),
    active: registration?.active?.state ?? null,
    caches: names, shell_cache: shell ?? null, shell_entries: shellKeys, art_entries: artKeys,
    saves: Object.keys(localStorage).filter((key) => key.startsWith("cardeater.")).length,
    boot: Boolean(document.querySelector("#app")),
    card_art_ok: [...document.images].every((image) => !image.currentSrc || image.complete),
  };
})()`);

const report = { url: gameUrl, phase, version: expectedVersion, viewports: [] };
// Per-phase filename: the phases run as separate invocations against the same
// output directory, so a shared report.json would lose the earlier results.
const reportFile = `report-${phase}.json`;

// The update phase exercises the worker lifecycle, which is not viewport
// dependent, and it can only be observed once per deployed release.
const phaseViewports = phase === "update" ? VIEWPORTS.slice(0, 1) : VIEWPORTS;

for (const viewport of phaseViewports) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale,
    mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height,
  });
  const checks = {};

  if (phase === "update") {
    // Test E — release B is genuinely deployed by this point. Verify it takes
    // over on its own, without losing art or saves.
    //
    // Runs once, not per viewport: both viewports share one browser profile and
    // therefore one registration, so the first pass consumes the A -> B
    // transition and a second would find itself already on B.
    await setOffline(false);
    const before = await swState();
    await evaluate(`(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    })()`);
    // Deliberately no page action here. The old build waited to be sent
    // `apply-update`, which no UI ever sent, so every deployment stalled in
    // `waiting` while the previous worker kept serving its own JavaScript —
    // players got the new index.html and the old modules.
    let activeVersion = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      activeVersion = (await status())?.version;
      if (activeVersion === expectedVersion) break;
      await wait(500);
    }
    await reload();
    await wait(1500);
    const after = await swState();
    const tookOver = activeVersion === expectedVersion;
    checks.e_update = {
      before_cache: before.shell_cache, after,
      took_over_unassisted: tookOver,
      active_version: activeVersion,
      version_changed: after.shell_cache !== before.shell_cache,
      old_cache_cleaned: !after.caches.includes(before.shell_cache),
      art_cache_survived: after.art_entries === before.art_entries,
      save_intact: await evaluate(`localStorage.getItem("cardeater.pwa-smoke") === "offline-write"`),
      pass: tookOver && after.shell_cache !== before.shell_cache
        && !after.caches.includes(before.shell_cache) && after.art_entries === before.art_entries
        && after.boot,
    };
    await capture(`${viewport.name}-e-updated`);
    report.viewports.push({ viewport: viewport.name, checks });
    console.log(`${viewport.name}: E=${checks.e_update.pass}`);
    continue;
  }

  // Test A — a normal visit installs the shell and nothing else.
  await setOffline(false);
  await evaluate(`(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const n of await caches.keys()) if (n.startsWith("cardeater-")) await caches.delete(n);
  })()`);
  await reload();
  await wait(1500);
  await reload();
  // An unregister while the page is still controlled can leave the previous
  // worker in charge with the new one merely staged. Apply any staged update so
  // the checks below run against the build that is actually deployed.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const version = (await status())?.version;
    if (version === expectedVersion) break;
    await evaluate(`(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.waiting?.postMessage({ type: "apply-update" });
    })()`);
    await wait(1500);
    await reload();
  }
  const activeVersion = (await status())?.version;
  if (activeVersion !== expectedVersion) {
    throw new Error(`Worker under test is ${activeVersion}, expected ${expectedVersion}. Rebuild dist/ and retry.`);
  }
  const normal = await swState();
  const normalStatus = await status();
  // Art is cached opportunistically as cards render, which costs no extra
  // request. What must not happen is a bulk download nobody asked for, so the
  // check is "well short of the full set and not yet offline-ready".
  checks.a_normal_visit = {
    ...normal,
    art_total: normalStatus?.art_total ?? null,
    offline_ready: normalStatus?.offline_ready ?? null,
    manifest_linked: await evaluate(`!!document.querySelector('link[rel="manifest"]')`),
    no_bulk_download: normal.art_entries < (normalStatus?.art_total ?? 0) * 0.75,
    pass: normal.controlled && normal.boot && normal.shell_entries > 30
      && normalStatus?.offline_ready === false
      && normal.art_entries < (normalStatus?.art_total ?? 0) * 0.75,
  };
  await capture(`${viewport.name}-a-normal-visit`);

  // Test B — the shell alone must cold-launch offline and, crucially, have its
  // event listeners. A broken install can still paint cached HTML/CSS while the
  // main module is missing; that looks normal but every title button is dead.
  // This is the Android home-screen failure that a simple `#app` check misses.
  await setOffline(true);
  await reload();
  const shellOffline = await swState();
  const interactive = await evaluate(`(() => {
    const menuButton = document.querySelector("#homeMenuButton");
    const menu = document.querySelector("#gameMenu");
    if (!menuButton || !menu) return false;
    menuButton.click();
    return menu.classList.contains("show");
  })()`);
  checks.b_shell_offline = {
    launch: shellOffline,
    title_menu_interactive: interactive,
    pass: shellOffline.boot && shellOffline.controlled && shellOffline.shell_entries > 30 && interactive,
  };
  await capture(`${viewport.name}-b-shell-offline`);
  await setOffline(false);

  // Test C — emulate an iOS home-screen launch. Do not call the manual
  // download API: main.js must notice standalone mode and prepare everything
  // on its own. Safari and its installed app have separate storage containers,
  // so this exact path is the difference between "installed" and "offline".
  const standaloneScript = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });`,
  });
  await evaluate(`caches.delete("cardeater-art")`);
  await reload();
  let automaticStatus = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    automaticStatus = await status();
    if (automaticStatus?.offline_ready) break;
    await wait(500);
  }
  const download = {
    automatic: true,
    ok: automaticStatus?.offline_ready ?? false,
    cached: automaticStatus?.art_cached ?? 0,
    total: automaticStatus?.art_total ?? 0,
    failed: automaticStatus?.offline_ready ? 0 : null,
    ready: automaticStatus?.offline_ready ?? false,
  };
  await setOffline(true);
  await reload();
  const offlineLaunch = await swState();
  await evaluate(`localStorage.setItem("cardeater.pwa-smoke", "offline-write")`);
  await reload();
  const offlineAgain = await swState();
  checks.c_offline = {
    download, launch: offlineLaunch,
    save_survived_relaunch: await evaluate(`localStorage.getItem("cardeater.pwa-smoke") === "offline-write"`),
    pass: download.ok && download.ready && offlineLaunch.boot && offlineLaunch.controlled
      && offlineLaunch.card_art_ok && offlineAgain.boot,
  };
  await capture(`${viewport.name}-c-offline-launch`);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: standaloneScript.identifier });

  // Test D — reconnect returns to normal network behavior with saves intact.
  await setOffline(false);
  await reload();
  const reconnected = await swState();
  checks.d_reconnect = {
    ...reconnected,
    save_intact: await evaluate(`localStorage.getItem("cardeater.pwa-smoke") === "offline-write"`),
    pass: reconnected.boot && reconnected.controlled && reconnected.art_entries === download.total,
  };
  await capture(`${viewport.name}-d-reconnect`);

  // Cache cleanup has to cut both ways. A stray non-release cache must still be
  // swept on a page request, but another release's shell cache must survive one:
  // sweeping those from a live worker deleted the incoming release's precache
  // while it was still installing. Retiring those is an activation's job, and
  // test E asserts it.
  checks.orphan_cleanup = await evaluate(`(async () => {
    await caches.open("cardeater-legacy-orphan");
    await caches.open("cardeater-shell-orphan00000");
    const { refreshOfflineStatus } = await import("./js/offline.js");
    await refreshOfflineStatus();
    const names = await caches.keys();
    const swept = !names.includes("cardeater-legacy-orphan");
    const spared = names.includes("cardeater-shell-orphan00000");
    await caches.delete("cardeater-shell-orphan00000");
    return { names, swept_stray_cache: swept, spared_other_release: spared, pass: swept && spared };
  })()`);

  // Mobile layout regression guard: safe-area padding and no page scroll.
  // Recorded for comparison rather than asserted, hence no `pass` key: these are
  // pre-existing values, and a bare `layout` key reads like a failed assertion.
  checks.layout_diagnostics = await evaluate(`(() => {
    const app = document.querySelector("#app");
    const style = getComputedStyle(document.body);
    return {
      scrollable: document.documentElement.scrollHeight > innerHeight + 1,
      overscroll: style.overscrollBehavior,
      touch_action: getComputedStyle(app).touchAction,
      user_select: style.userSelect,
      inside_viewport: app.getBoundingClientRect().width <= innerWidth + 1,
    };
  })()`);

  report.viewports.push({ viewport: viewport.name, checks });
  console.log(`${viewport.name}: A=${checks.a_normal_visit.pass} B=${checks.b_shell_offline.pass} C=${checks.c_offline.pass} D=${checks.d_reconnect.pass} orphan=${checks.orphan_cleanup.pass}`);
}

await send("Emulation.clearDeviceMetricsOverride");
await writeFile(resolve(outputDir, reportFile), `${JSON.stringify(report, null, 2)}\n`);
socket.close();

const failed = report.viewports.flatMap(({ viewport, checks }) =>
  Object.entries(checks).filter(([, value]) => value.pass === false).map(([name]) => `${viewport}/${name}`));
console.log(failed.length ? `FAIL: ${failed.join(", ")}` : "All PWA checks passed");
console.log(`Report: ${resolve(outputDir, reportFile)}`);
if (failed.length) process.exitCode = 1;
