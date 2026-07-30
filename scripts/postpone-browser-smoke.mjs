import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debugPort = Number(process.argv[2] ?? 9237);
const gameUrl = process.argv[3] ?? "http://127.0.0.1:8769";
const outputDir = resolve(process.argv[4] ?? ".artifacts/smoke-postpone");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const viewports = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];

await mkdir(outputDir, { recursive: true });
const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No debuggable Edge page found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

let nextId = 1;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.text);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveMessage, reject) => pending.set(id, { resolve: resolveMessage, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await wait(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function clickElement(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const rect = element?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (!point) throw new Error(`Element not found: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDir, `${name}.png`), Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
const reports = [];

for (const viewport of viewports) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await send("Page.navigate", { url: `${gameUrl}?postpone-smoke=${viewport.name}-${Date.now()}` });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#continueGameButton")?.onclick === "function"');
  await evaluate(`(async () => {
    const { createInitialPlayerState, resetRoundState } = await import("./js/state.js");
    const { getCardById } = await import("./js/data.js");
    const state = createInitialPlayerState({ create_id: (card) => card.id + "-postpone-smoke" });
    state.deck = ["F001", "A001", "C004"].map((id) => {
      const card = getCardById(id);
      return {
        ...card,
        synergy_tags: [...card.synergy_tags],
        effect: card.effect ? { ...card.effect, keywords: [...card.effect.keywords] } : null,
        uuid: id + "-postpone-smoke",
      };
    });
    resetRoundState(state);
    state.phase = "Playing";
    state.round.draw_pile = state.deck.map((card) => ({ ...card, effect: card.effect ? { ...card.effect } : null }));
    state.round.action_budget = state.round.draw_pile.length;
    localStorage.removeItem("cardeater.settings.v1");
    localStorage.setItem("cardeater.story-tutorial.v1", "complete");
    localStorage.setItem("cardeater.active-run.v2", JSON.stringify(state));
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && !document.querySelector("#continueGameButton")?.disabled');
  await clickElement("#continueGameButton");
  await waitFor('document.querySelector(".game-card.is-active")?.getAttribute("aria-label")?.startsWith("彗星")');
  await clickElement("#postponeButton");
  await waitFor('document.querySelector(".game-card.is-active")?.getAttribute("aria-label")?.startsWith("橘猫")');
  await wait(160);
  await capture(`${viewport.name}-postpone-marking`);
  const result = await evaluate(`(() => {
    const save = JSON.parse(localStorage.getItem("cardeater.active-run.v2") || "{}");
    const targetUuids = ["F001-postpone-smoke", "A001-postpone-smoke"];
    return {
      target_marks: targetUuids.filter((uuid) => document.querySelector('[data-card-uuid="' + uuid + '"]')?.classList.contains("is-postponed")).length,
      target_badges: targetUuids.filter((uuid) => document.querySelector('[data-card-uuid="' + uuid + '"] .card-postpone-mark')).length,
      target_counts: targetUuids.map((uuid) => save.round?.postpone_counts?.[uuid] ?? 0),
      target_uuids_recorded: targetUuids.every((uuid) => save.round?.postponed_uuids?.includes(uuid)),
      active_postpone_disabled: Boolean(document.querySelector("#postponeButton")?.disabled),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  reports.push({ viewport, ...result });
}

const report = { generated_at: new Date().toISOString(), url: gameUrl, reports, browser_errors: browserErrors };
await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();

const failures = [
  ...browserErrors,
  ...reports.flatMap((entry) => [
    entry.target_marks === 2 ? null : `${entry.viewport.name}: remaining cards lack postponed class`,
    entry.target_badges === 2 ? null : `${entry.viewport.name}: remaining cards lack postponed badge`,
    JSON.stringify(entry.target_counts) === JSON.stringify([1, 1]) ? null : `${entry.viewport.name}: postponed counts are not [1,1]`,
    entry.target_uuids_recorded ? null : `${entry.viewport.name}: postponed UUIDs are incomplete`,
    entry.active_postpone_disabled ? null : `${entry.viewport.name}: marked active card can still be postponed`,
    entry.horizontal_overflow ? `${entry.viewport.name}: horizontal overflow` : null,
  ]).filter(Boolean),
];
if (failures.length > 0) throw new Error(`Postpone browser smoke failures:\n${failures.join("\n")}`);
console.log(JSON.stringify(report, null, 2));
