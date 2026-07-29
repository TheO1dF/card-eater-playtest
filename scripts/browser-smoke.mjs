import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debugPort = Number(process.argv[2] ?? 9223);
const gameUrl = process.argv[3] ?? "http://127.0.0.1:8765";
const outputDir = resolve(process.argv[4] ?? ".artifacts/smoke-v21-juice");
const viewportFilter = process.argv[5] ?? "all";
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];
const selectedViewports = viewportFilter === "all" ? VIEWPORTS : VIEWPORTS.filter((viewport) => viewport.name === viewportFilter);
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

async function waitFor(expression, timeout = 12000) {
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
  for (let index = 0; index < 80; index += 1) {
    if (await evaluate('document.querySelector("#roundSummary")?.classList.contains("show")')) return;
    if (await evaluate('Boolean(document.querySelector(".game-card.is-active"))')) await clickElement("#discardButton");
    await wait(105);
  }
  throw new Error("Plate did not finish within the action safety bound.");
}

async function chooseCardAndWaitForRound(roundLabel) {
  await clickElement(".draft-card");
  await waitFor(`document.querySelector("#phaseValue")?.textContent === "出牌中" && document.querySelector("#roundValue")?.textContent === ${JSON.stringify(roundLabel)}`, 12000);
}

async function completeToDraft() {
  await finishCurrentPlate();
  await waitFor('document.querySelector("#roundSummary")?.classList.contains("show")');
  await clickElement("#summaryContinueBtn");
  await waitFor('document.querySelector("#cardDraft")?.classList.contains("show") && document.querySelectorAll(".draft-card").length === 3');
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
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  await evaluate(`(() => {
    localStorage.removeItem("cardeater.run-history.v1");
    localStorage.removeItem("cardeater.active-run.v2");
    localStorage.setItem("cardeater.story-tutorial.v1", "complete");
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  await wait(180);

  await capture(`${viewport.name}-home`);
  const home = await evaluate(`(() => {
    const panel = document.querySelector(".home-panel")?.getBoundingClientRect();
    const actions = [...document.querySelectorAll(".home-actions > button")];
    return {
      title: document.querySelector("#welcomeTitle")?.textContent,
      action_labels: actions.map((button) => button.querySelector("b")?.textContent),
      continue_disabled: document.querySelector("#continueGameButton")?.disabled,
      rain_count: document.querySelectorAll(".home-rain-card").length,
      logo_lines: document.querySelectorAll(".home-logo span").length,
      logo_has_annotation: Boolean(document.querySelector(".home-hero p")),
      panel_border: parseFloat(getComputedStyle(document.querySelector(".home-panel")).borderTopWidth),
      shell_border: parseFloat(getComputedStyle(document.querySelector(".game-shell")).borderTopWidth),
      modes_locked: ["#endlessModeButton", "#hardModeButton"].every((selector) => document.querySelector(selector)?.disabled),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);

  await evaluate(`localStorage.setItem("cardeater.run-history.v1", JSON.stringify([{ outcome: "victory", score: 500 }]))`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  const unlock = await evaluate(`(() => ({
    endless_enabled: !document.querySelector("#endlessModeButton")?.disabled,
    hard_enabled: !document.querySelector("#hardModeButton")?.disabled,
  }))()`);
  await evaluate('localStorage.removeItem("cardeater.run-history.v1")');
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');

  await clickElement("#newGameButton");
  await waitFor('!document.querySelector("#modeChooser")?.hidden');
  await capture(`${viewport.name}-mode-select`);
  await clickElement("#normalModeButton");
  await waitFor('Boolean(document.querySelector(".deal-layer"))');
  await wait(260);
  await capture(`${viewport.name}-deal`);
  const dealing = await evaluate(`(() => {
    const layer = document.querySelector(".deal-layer");
    const firstCard = document.querySelector(".deal-card-trail i");
    const shell = document.querySelector(".game-shell");
    const table = document.querySelector(".playfield");
    return {
      card_backs: document.querySelectorAll(".deal-card-trail i").length,
      visible_card_backs: [...document.querySelectorAll(".deal-card-trail i")].filter((card) => parseFloat(getComputedStyle(card).opacity) > .05).length,
      message: layer?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      shell_transform: shell ? getComputedStyle(shell).transform : "missing",
      animation_name: firstCard ? getComputedStyle(firstCard).animationName : "missing",
      covers_table: Boolean(layer && table && layer.getBoundingClientRect().width >= table.getBoundingClientRect().width - 1),
    };
  })()`);
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中"', 12000);
  await capture(`${viewport.name}-round-1`);
  const playing = await evaluate(`(() => ({
    phase: document.querySelector("#phaseValue")?.textContent,
    round: document.querySelector("#roundValue")?.textContent,
    active_cards: document.querySelectorAll(".game-card.is-active").length,
    plate: document.querySelector("#remainingValue")?.textContent,
    item_tray: Boolean(document.querySelector("#itemTray")),
    has_gold: Boolean(document.querySelector("#goldValue")),
    has_timer: Boolean(document.querySelector("#timerValue")),
    card_copy_size: parseFloat(getComputedStyle(document.querySelector(".card-effect")).fontSize),
    hud_label_size: parseFloat(getComputedStyle(document.querySelector(".hud-cell span")).fontSize),
    horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }))()`);

  await clickElement("#menuButton");
  await waitFor('document.querySelector("#gameMenu")?.classList.contains("show")');
  await evaluate('document.querySelector("#menuRules").open = true');
  await capture(`${viewport.name}-menu`);
  const menu = await evaluate(`(() => {
    const text = document.querySelector("#menuRules")?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
    return {
      rule_count: document.querySelectorAll("#menuRules li").length,
      has_home: Boolean(document.querySelector("#menuHomeButton")?.getBoundingClientRect().height),
      has_autosave_rule: text.includes("自动保存"),
      forbidden_terms: ["金币", "商店", "限时经济", "任务选择"].filter((term) => text.includes(term)),
    };
  })()`);
  await clickElement("#gameMenuClose");

  await finishCurrentPlate();
  await capture(`${viewport.name}-summary-1`);
  await clickElement("#summaryContinueBtn");
  await waitFor('document.querySelector("#cardDraft")?.classList.contains("show") && document.querySelectorAll(".draft-card").length === 3');
  const offerNamesBefore = await evaluate('[...document.querySelectorAll(".draft-card .shop-card-copy strong")].map((node) => node.textContent)');
  await clickElement("#draftReroll");
  await waitFor('document.querySelector("#draftRerollValue")?.textContent === "0"');
  await wait(180);
  await capture(`${viewport.name}-draft-rerolled`);
  const draft = await evaluate(`(() => {
    const panel = document.querySelector(".draft-reward-panel")?.getBoundingClientRect();
    const widths = [...document.querySelectorAll(".draft-actions > button")].map((button) => button.getBoundingClientRect().width);
    return {
      offer_count: document.querySelectorAll(".draft-card").length,
      offer_names: [...document.querySelectorAll(".draft-card .shop-card-copy strong")].map((node) => node.textContent),
      reroll_value: document.querySelector("#draftRerollValue")?.textContent,
      action_widths: widths,
      equal_actions: Math.max(...widths) - Math.min(...widths) <= 1,
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
    };
  })()`);
  draft.offers_changed = JSON.stringify(offerNamesBefore) !== JSON.stringify(draft.offer_names);

  await evaluate('document.querySelector("#deleteConfirm").classList.add("show")');
  const deleteLayout = await evaluate(`(() => {
    const widths = [...document.querySelectorAll(".delete-confirm-actions > button")].map((button) => button.getBoundingClientRect().width);
    return { widths, equal_actions: Math.max(...widths) - Math.min(...widths) <= 1 };
  })()`);
  await capture(`${viewport.name}-delete-layout`);
  await evaluate('document.querySelector("#deleteConfirm").classList.remove("show")');

  await chooseCardAndWaitForRound("2/15");
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#continueGameButton")?.onclick === "function"');
  const saveHome = await evaluate(`(() => ({
    continue_enabled: !document.querySelector("#continueGameButton")?.disabled,
    save_exists: Boolean(localStorage.getItem("cardeater.active-run.v2")),
  }))()`);
  await clickElement("#continueGameButton");
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中" && document.querySelector("#roundValue")?.textContent === "2/15"');
  await clickElement("#menuButton");
  await waitFor('document.querySelector("#gameMenu")?.classList.contains("show")');
  await clickElement("#menuHomeButton");
  await waitFor('document.readyState === "complete" && document.querySelector("#welcomeOverlay")?.classList.contains("show") && !document.querySelector("#continueGameButton")?.disabled', 12000);
  await wait(200);
  await capture(`${viewport.name}-home-return`);
  await clickElement("#continueGameButton");
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中" && document.querySelector("#roundValue")?.textContent === "2/15"');

  await completeToDraft();
  await chooseCardAndWaitForRound("3/15");
  await completeToDraft();
  await clickElement(".draft-card");
  await waitFor('document.querySelector("#itemDraft")?.classList.contains("show") && document.querySelectorAll(".item-draft-card").length === 3');
  await wait(180);
  await capture(`${viewport.name}-item-draft`);
  const itemDraft = await evaluate(`(() => {
    const panel = document.querySelector(".item-draft-panel")?.getBoundingClientRect();
    const widths = [...document.querySelectorAll(".item-draft-card")].map((card) => card.getBoundingClientRect().width);
    return {
      count: widths.length,
      item_ids: [...document.querySelectorAll(".item-draft-card")].map((card) => card.dataset.itemId),
      item_slots: [...document.querySelectorAll(".item-draft-card")].map((card) => card.dataset.itemSlot),
      equal_cards: Math.max(...widths) - Math.min(...widths) <= 1,
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      reroll_tokens: document.querySelector("#draftRerollValue")?.textContent,
    };
  })()`);
  await clickElement(".item-draft-card:not(.is-consumable)");
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中" && document.querySelector("#roundValue")?.textContent === "4/15"', 12000);
  const nextRound = await evaluate(`(() => ({
    round: document.querySelector("#roundValue")?.textContent,
    owned_items: document.querySelectorAll("#itemTray .item-chip").length,
    save_exists: Boolean(localStorage.getItem("cardeater.active-run.v2")),
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

  reports.push({ viewport, home, unlock, dealing, playing, menu, draft, delete_layout: deleteLayout, save_home: saveHome, item_draft: itemDraft, next_round: nextRound, card_art: cardArt });
}

const report = { generated_at: new Date().toISOString(), url: gameUrl, reports, browser_errors: browserErrors };
await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();

const failures = [
  ...browserErrors,
  ...reports.flatMap((entry) => [
    entry.home.title === "CardEater" ? null : `${entry.viewport.name}: wrong home title`,
    JSON.stringify(entry.home.action_labels) === JSON.stringify(["新游戏", "继续", "菜单"]) ? null : `${entry.viewport.name}: wrong home actions`,
    entry.home.continue_disabled ? null : `${entry.viewport.name}: continue should start disabled`,
    entry.home.rain_count >= 24 && entry.home.logo_lines === 2 ? null : `${entry.viewport.name}: home card rain missing`,
    !entry.home.logo_has_annotation && entry.home.panel_border === 0 && entry.home.shell_border === 0 ? null : `${entry.viewport.name}: home logo still has annotation or frame`,
    entry.home.modes_locked ? null : `${entry.viewport.name}: advanced modes should start locked`,
    entry.unlock.endless_enabled && entry.unlock.hard_enabled ? null : `${entry.viewport.name}: advanced modes did not unlock after victory`,
    entry.home.inside_viewport ? null : `${entry.viewport.name}: home outside viewport`,
    entry.home.horizontal_overflow ? `${entry.viewport.name}: home horizontal overflow` : null,
    entry.dealing.card_backs > 0 && entry.dealing.visible_card_backs > 0 && entry.dealing.message.includes("餐盘上菜") ? null : `${entry.viewport.name}: dealing animation missing`,
    entry.dealing.shell_transform === "none" ? null : `${entry.viewport.name}: dealing animation moves the game shell`,
    entry.dealing.animation_name === "dealToPlate" && entry.dealing.covers_table ? null : `${entry.viewport.name}: dealing animation is not table-wide`,
    entry.playing.phase === "出牌中" && entry.playing.active_cards === 1 ? null : `${entry.viewport.name}: did not enter play`,
    entry.playing.card_copy_size >= 12 && entry.playing.hud_label_size >= 11 ? null : `${entry.viewport.name}: gameplay text remains too small`,
    entry.playing.has_gold || entry.playing.has_timer ? `${entry.viewport.name}: legacy HUD exists` : null,
    entry.playing.horizontal_overflow ? `${entry.viewport.name}: gameplay horizontal overflow` : null,
    entry.menu.rule_count >= 8 && entry.menu.has_home && entry.menu.has_autosave_rule ? null : `${entry.viewport.name}: menu rules incomplete`,
    entry.menu.forbidden_terms.length ? `${entry.viewport.name}: legacy terms ${entry.menu.forbidden_terms.join(",")}` : null,
    entry.draft.offer_count === 3 && entry.draft.reroll_value === "0" && entry.draft.offers_changed ? null : `${entry.viewport.name}: draft reroll failed`,
    entry.draft.equal_actions ? null : `${entry.viewport.name}: draft action buttons are unequal`,
    entry.draft.inside_viewport ? null : `${entry.viewport.name}: draft outside viewport`,
    entry.delete_layout.equal_actions ? null : `${entry.viewport.name}: delete buttons are unequal`,
    entry.save_home.continue_enabled && entry.save_home.save_exists ? null : `${entry.viewport.name}: autosave/continue failed`,
    entry.item_draft.count === 3 && entry.item_draft.equal_cards && entry.item_draft.item_ids.every((id) => id.startsWith("BI")) ? null : `${entry.viewport.name}: item draft invalid`,
    JSON.stringify(entry.item_draft.item_slots) === JSON.stringify(["relevant", "bridge", "wild"]) ? null : `${entry.viewport.name}: item draft slots are not relevant/bridge/wild`,
    entry.item_draft.inside_viewport ? null : `${entry.viewport.name}: item draft outside viewport`,
    entry.next_round.round === "4/15" && entry.next_round.save_exists && entry.next_round.owned_items >= 1 ? null : `${entry.viewport.name}: failed to reach saved round four with an item`,
    entry.card_art.failed_ids.length ? `${entry.viewport.name}: card art failed ${entry.card_art.failed_ids.join(",")}` : null,
  ]).filter(Boolean),
];
if (failures.length > 0) throw new Error(`Smoke failures:\n${failures.join("\n")}`);
console.log(JSON.stringify(report, null, 2));
