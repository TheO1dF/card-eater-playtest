import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debugPort = Number(process.argv[2] ?? 9223);
const gameUrl = process.argv[3] ?? "http://127.0.0.1:8765";
const outputDir = resolve(process.argv[4] ?? ".artifacts/smoke-v15-experiment");
const viewportFilter = process.argv[5] ?? "all";
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];
const selectedViewports = viewportFilter === "all"
  ? VIEWPORTS
  : VIEWPORTS.filter((viewport) => viewport.name === viewportFilter);
if (selectedViewports.length === 0) throw new Error(`Unknown viewport filter: ${viewportFilter}`);

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

async function waitFor(expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function clickElement(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView({ block: "center", inline: "center" });
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

async function finishCurrentPlate() {
  for (let index = 0; index < 40; index += 1) {
    const finished = await evaluate('document.querySelector("#roundSummary")?.classList.contains("show")');
    if (finished) return;
    const active = await evaluate('Boolean(document.querySelector(".game-card.is-active"))');
    if (active) await clickElement("#discardButton");
    await wait(130);
  }
  throw new Error("Plate did not finish within the action safety bound.");
}

await mkdir(outputDir, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

const reports = [];
for (const viewport of selectedViewports) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await send("Page.navigate", { url: `${gameUrl}?smoke=${viewport.name}-${Date.now()}` });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#startGameButton")?.onclick === "function"');
  await evaluate('localStorage.removeItem("cardeater.tutorial-complete.v1")');
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#startGameButton")?.onclick === "function"');
  await wait(220);

  await capture(`${viewport.name}-welcome`);
  const welcome = await evaluate(`(() => {
    const panel = document.querySelector(".welcome-panel")?.getBoundingClientRect();
    return {
      title: document.querySelector("#welcomeTitle")?.textContent,
      loop_steps: document.querySelector(".welcome-loop")?.children.length,
      objective: document.querySelector(".welcome-objective")?.textContent?.replace(/\\s+/g, " ").trim(),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);

  await clickElement("#tutorialStartButton");
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中"', 10000);
  await capture(`${viewport.name}-round-1`);
  const playing = await evaluate(`(() => {
    const shell = document.querySelector(".game-shell")?.getBoundingClientRect();
    return {
      phase: document.querySelector("#phaseValue")?.textContent,
      round: document.querySelector("#roundValue")?.textContent,
      active_cards: document.querySelectorAll(".game-card.is-active").length,
      visible_cards: document.querySelectorAll(".game-card").length,
      plate: document.querySelector("#remainingValue")?.textContent,
      tokens: document.querySelector("#tokenValue")?.textContent,
      has_gold: Boolean(document.querySelector("#goldValue")),
      has_timer: Boolean(document.querySelector("#timerValue")),
      shell_inside_viewport: Boolean(shell && shell.left >= -1 && shell.right <= innerWidth + 1),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);

  await clickElement("#menuButton");
  await waitFor('document.querySelector("#gameMenu")?.classList.contains("show")');
  await evaluate('document.querySelector("#menuRules").open = true');
  await capture(`${viewport.name}-menu`);
  const menu = await evaluate(`(() => {
    const panel = document.querySelector(".game-menu-panel")?.getBoundingClientRect();
    const text = document.querySelector("#menuRules")?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
    return {
      rule_count: document.querySelectorAll("#menuRules li").length,
      text,
      forbidden_terms: ["金币", "商店", "限时经济", "任务选择"].filter((term) => text.includes(term)),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
    };
  })()`);
  await clickElement("#gameMenuClose");

  await finishCurrentPlate();
  await waitFor('document.querySelector("#roundSummary")?.classList.contains("show")');
  await wait(220);
  await capture(`${viewport.name}-summary`);
  const summary = await evaluate(`(() => ({
    title: document.querySelector("#summaryTitle")?.textContent,
    continue_label: document.querySelector("#summaryContinueBtn")?.textContent,
    text: document.querySelector("#roundSummary")?.textContent?.replace(/\\s+/g, " ").trim(),
  }))()`);

  await clickElement("#summaryContinueBtn");
  await waitFor('document.querySelector("#cardDraft")?.classList.contains("show") && document.querySelectorAll(".draft-card").length === 3');
  await wait(220);
  await capture(`${viewport.name}-draft`);
  const draft = await evaluate(`(() => {
    const panel = document.querySelector(".draft-reward-panel")?.getBoundingClientRect();
    return {
      offer_count: document.querySelectorAll(".draft-card").length,
      token_value: document.querySelector("#draftTokenValue")?.textContent,
      skip_visible: Boolean(document.querySelector("#draftSkip")?.getBoundingClientRect().height),
      manage_visible: Boolean(document.querySelector("#draftManageDeck")?.getBoundingClientRect().height),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
    };
  })()`);

  await clickElement("#draftManageDeck");
  await waitFor('document.querySelector("#deckStatus")?.classList.contains("show")');
  const deck = await evaluate(`(() => ({
    card_groups: document.querySelectorAll("#deckStatusList .deck-status-card").length,
    removal_buttons: document.querySelectorAll(".deck-remove-token").length,
    hint: document.querySelector("#deckRemovalHint")?.textContent,
  }))()`);
  await clickElement("#deckStatusClose");
  await clickElement(".draft-card");
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中" && document.querySelector("#roundValue")?.textContent === "2/15"', 10000);
  await capture(`${viewport.name}-round-2`);
  const nextRound = await evaluate(`(() => ({
    round: document.querySelector("#roundValue")?.textContent,
    deck_summary: document.querySelector("#deckInfoButton")?.title,
    plate: document.querySelector("#remainingValue")?.textContent,
  }))()`);

  const cardArt = await evaluate(`(async () => {
    const { createCardPool } = await import("./js/data.js");
    const cards = createCardPool();
    const results = await Promise.all(cards.map((card) => new Promise((resolveImage) => {
      const image = new Image();
      image.onload = () => resolveImage({ id: card.id, ok: image.naturalWidth > 0 && image.naturalWidth === image.naturalHeight });
      image.onerror = () => resolveImage({ id: card.id, ok: false });
      image.src = new URL("./assets/" + card.art_file, location.href).href;
    })));
    return { total: cards.length, failed_ids: results.filter((result) => !result.ok).map((result) => result.id) };
  })()`);

  reports.push({ viewport, welcome, playing, menu, summary, draft, deck, next_round: nextRound, card_art: cardArt });
}

const report = {
  generated_at: new Date().toISOString(),
  url: gameUrl,
  reports,
  browser_errors: browserErrors,
};
await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();

const failures = [
  ...browserErrors,
  ...reports.flatMap((entry) => [
    entry.welcome.inside_viewport ? null : `${entry.viewport.name}: welcome outside viewport`,
    entry.welcome.horizontal_overflow ? `${entry.viewport.name}: welcome horizontal overflow` : null,
    entry.playing.phase === "出牌中" ? null : `${entry.viewport.name}: did not enter play`,
    entry.playing.active_cards === 1 ? null : `${entry.viewport.name}: active card count is not one`,
    entry.playing.has_gold ? `${entry.viewport.name}: gold HUD still exists` : null,
    entry.playing.has_timer ? `${entry.viewport.name}: timer HUD still exists` : null,
    entry.playing.horizontal_overflow ? `${entry.viewport.name}: gameplay horizontal overflow` : null,
    entry.menu.forbidden_terms.length ? `${entry.viewport.name}: legacy terms ${entry.menu.forbidden_terms.join(",")}` : null,
    entry.draft.offer_count === 3 ? null : `${entry.viewport.name}: draft does not have three cards`,
    entry.draft.skip_visible ? null : `${entry.viewport.name}: skip button missing`,
    entry.draft.inside_viewport ? null : `${entry.viewport.name}: draft outside viewport`,
    entry.deck.removal_buttons === 0 ? null : `${entry.viewport.name}: removal enabled without tokens`,
    entry.next_round.round === "2/15" ? null : `${entry.viewport.name}: failed to start round two`,
    entry.card_art.failed_ids.length ? `${entry.viewport.name}: card art failed ${entry.card_art.failed_ids.join(",")}` : null,
  ]).filter(Boolean),
];
if (failures.length > 0) throw new Error(`Smoke failures:\n${failures.join("\n")}`);
console.log(JSON.stringify(report, null, 2));
