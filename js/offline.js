// Page-side offline/install/update API.
//
// Everything here is additive and failure-tolerant: if service workers are
// unavailable, blocked, or the registration throws, the game keeps running
// exactly as it did before. Nothing in this module touches gameplay state, and
// nothing here reads or writes player saves — those stay in js/platform.js.
//
// UI wiring: the offline download row is wired in js/main.js, and preparation
// also runs on its own via prepareOfflineInBackground(). The install button is
// still a connection point only. Updates need no UI — the worker activates a
// new release itself; see docs/PWA_OFFLINE.md.

const SW_URL = "./sw.js";
const isSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator;

const listeners = new Set();
const state = {
  supported: false,
  registered: false,
  update_ready: false,
  installable: false,
  standalone: false,
  persisted: false,
  status: null,
  progress: null,
};

let registration = null;
let installPrompt = null;

function emit() {
  const snapshot = getOfflineState();
  for (const listener of [...listeners]) {
    try {
      listener(snapshot);
    } catch {
      // A broken subscriber must never break the game loop.
    }
  }
}

function patch(changes) {
  let changed = false;
  for (const [key, value] of Object.entries(changes)) {
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (changed) emit();
}

export function getOfflineState() {
  return { ...state, status: state.status ? { ...state.status } : null, progress: state.progress ? { ...state.progress } : null };
}

/** Subscribe to offline/install/update changes. Returns an unsubscribe function. */
export function onOfflineStateChange(listener) {
  listeners.add(listener);
  listener(getOfflineState());
  return () => listeners.delete(listener);
}

export function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  // iOS Safari predates display-mode, so navigator.standalone is still needed.
  return Boolean(window.matchMedia?.("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)")?.matches)
    || navigator.standalone === true;
}

function ask(type, payload = {}) {
  const worker = registration?.active ?? navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 30 * 60 * 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data ?? null);
    };
    worker.postMessage({ type, ...payload }, [channel.port2]);
  });
}

/** Current cache state: how much art is stored and whether offline play is ready. */
export async function refreshOfflineStatus() {
  const status = await ask("offline-status");
  if (status && !status.error) patch({ status });
  return status;
}

/**
 * Asks the browser to keep this origin's storage. Best effort and advisory:
 * Safari and Chrome grant it under different rules, and a refusal only means
 * the cache may be evicted after a long idle period, not that anything fails.
 */
async function requestPersistentStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

/**
 * Downloads every asset a full offline run needs (~10 MB) and verifies the
 * result against the cache. Safe to call repeatedly; already-cached files are
 * skipped.
 */
export async function downloadForOfflinePlay({ persist = true } = {}) {
  if (!isSupported()) return { ok: false, error: "unsupported" };
  await ready();
  if (persist) patch({ persisted: await requestPersistentStorage() });
  patch({ progress: { done: 0, total: state.status?.art_total ?? 0 } });
  const result = await ask("offline-download");
  patch({ progress: null, status: result && !result.error ? result : state.status });
  return result ?? { ok: false, error: "no-worker" };
}

// Long enough that someone who opens the page and leaves never pays for it.
const BACKGROUND_PREPARE_DELAY_MS = 45_000;

/**
 * Prepares offline play on its own, so the usual case needs no button at all.
 *
 * Deliberately unhurried and easy to opt out of: it waits until the player has
 * actually stayed, does nothing on a metered connection or once the art is
 * already stored, and skips the persistent-storage request because that is a
 * prompt on some browsers and this path is meant to be silent. The menu row
 * still shows progress, and still works as a manual trigger for anyone who
 * wants to prepare right now.
 */
export async function prepareOfflineInBackground({ delayMs = BACKGROUND_PREPARE_DELAY_MS } = {}) {
  if (!isSupported() || navigator.connection?.saveData) return null;
  if (!(await ready())) return null;
  await new Promise((done) => setTimeout(done, delayMs));
  if (!navigator.onLine) return null;
  const status = await refreshOfflineStatus();
  if (!status || status.error || status.offline_ready) return status;
  return downloadForOfflinePlay({ persist: false });
}

/** Frees the downloaded art cache. Never touches saves or the app shell. */
export async function clearOfflineDownload() {
  const status = await ask("offline-clear");
  if (status) patch({ status });
  return status;
}

function watchUpdates(current) {
  const track = (worker) => {
    if (!worker) return;
    const check = () => {
      // A waiting worker with an existing controller means release B is staged
      // while the player is still running release A.
      if (worker.state === "installed" && navigator.serviceWorker.controller) patch({ update_ready: true });
    };
    worker.addEventListener("statechange", check);
    check();
  };
  track(current.waiting);
  current.addEventListener("updatefound", () => track(current.installing));
}

/**
 * Applies a staged update by activating the new worker and reloading once.
 * Nothing needs this any more — a new release activates itself — but it stays
 * for a caller that wants to force the swap without a navigation.
 */
export async function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
    setTimeout(finish, 4000);
    waiting.postMessage({ type: "apply-update" });
  });
  window.location.reload();
  return true;
}

let readyPromise = null;
const ready = () => readyPromise ?? Promise.resolve(null);

/**
 * Registers the worker. Called after the game boots so it never competes with
 * first paint, and it resolves even when registration fails.
 */
export function startOfflineSupport({ scriptUrl = SW_URL } = {}) {
  patch({ standalone: isStandaloneDisplay(), supported: isSupported() });
  watchInstallPrompt();
  if (!isSupported() || window.location.protocol === "file:") return Promise.resolve(null);

  readyPromise ??= navigator.serviceWorker.register(scriptUrl, { scope: "./", updateViaCache: "none" })
    .then(async (current) => {
      registration = current;
      patch({ registered: true });
      watchUpdates(current);
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "offline-progress") {
          patch({ progress: { done: event.data.done, total: event.data.total } });
        }
      });
      // On a first visit there is no active worker and no controller yet, so
      // this first query answers null and the UI has no status to show. Ask
      // again once the worker is really there, or the download control stays
      // hidden for the whole session — the visit where it matters most.
      await refreshOfflineStatus();
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        void refreshOfflineStatus();
      }, { once: true });
      void navigator.serviceWorker.ready.then(() => refreshOfflineStatus()).catch(() => {
        // Never resolves without an activation. Nothing to report if so.
      });
      return current;
    })
    .catch((error) => {
      // Private browsing, disabled workers, or a blocked scope all land here.
      patch({ registered: false });
      console.info("CardEater: offline support unavailable —", error?.message ?? error);
      return null;
    });
  return readyPromise;
}

function watchInstallPrompt() {
  if (typeof window === "undefined") return;
  // Chromium only. Its absence is normal (iOS uses Share > Add to Home Screen)
  // and never blocks play, so no prompt is ever shown unprompted.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    patch({ installable: true });
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    patch({ installable: false });
  });
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => {
    patch({ standalone: isStandaloneDisplay() });
  });
}

/**
 * Shows the browser install prompt, if this platform has one. Only ever call
 * this from an explicit user action such as an "Install App" button.
 */
export async function promptInstall() {
  if (!installPrompt) return { ok: false, reason: "unavailable" };
  const prompt = installPrompt;
  installPrompt = null;
  patch({ installable: false });
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  return { ok: choice?.outcome === "accepted", reason: choice?.outcome ?? "dismissed" };
}

/** Unregisters the worker and drops every CardEater cache. Saves are untouched. */
export async function resetOfflineSupport() {
  if (!isSupported()) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((entry) => entry.unregister()));
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith("cardeater-")).map((name) => caches.delete(name)));
  registration = null;
  readyPromise = null;
  patch({ registered: false, update_ready: false, status: null });
  return true;
}
