import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debugPort = Number(process.argv[2] ?? 9223);
const gameUrl = process.argv[3] ?? "http://127.0.0.1:8765";
const outputDir = resolve(process.argv[4] ?? ".artifacts/smoke-modes");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const viewports = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];

const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page");
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
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails.text);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    const entry = message.params.entry;
    browserErrors.push([entry.text, entry.url, entry.source].filter(Boolean).join(" · "));
  }
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

async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(selector) {
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
  const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDir, `${name}.png`), Buffer.from(screenshot.data, "base64"));
}

async function inspectShuffle() {
  await waitFor('Boolean(document.querySelector(".deal-layer"))');
  await wait(720);
  return evaluate(`(() => {
    const stack = document.querySelector("#cardStack");
    const cards = [...document.querySelectorAll("#cardStack .game-card[data-deal-instance='true']")];
    return {
      card_count: cards.length,
      visible_cards: cards.filter((card) => getComputedStyle(card).visibility !== "hidden" && parseFloat(getComputedStyle(card).opacity) > .05).length,
      animation_name: getComputedStyle(stack).animationName,
      card_animations: [...new Set(cards.map((card) => getComputedStyle(card).animationName))],
      split_directions: new Set(cards.map((card) => card.style.getPropertyValue("--shuffle-x"))).size,
      stack_above_layer: Number(getComputedStyle(stack).zIndex) > Number(getComputedStyle(document.querySelector(".deal-layer")).zIndex),
    };
  })()`);
}

async function finishPlate(actionSelector = "#eatButton") {
  for (let index = 0; index < 80; index += 1) {
    if (await evaluate('document.querySelector("#roundSummary")?.classList.contains("show")')) return;
    if (await evaluate('Boolean(document.querySelector(".game-card.is-active"))')) await click(actionSelector);
    await wait(120);
  }
  throw new Error("Plate did not finish within the action safety bound.");
}

async function accelerateRoundSummary() {
  await waitFor('document.querySelector("#roundSummary")?.classList.contains("show")');
  for (let index = 0; index < 120; index += 1) {
    if (await evaluate('document.querySelector("#roundSummary")?.dataset.presentationState === "ready" && !document.querySelector("#summaryContinueBtn")?.disabled')) return;
    await click("#roundSummary");
    await wait(28);
  }
  throw new Error("Round summary presentation did not reach its ready state.");
}

function devUrl(viewport) {
  const url = new URL(gameUrl);
  url.searchParams.set("dev", "1");
  url.searchParams.set("mode_smoke", `${viewport.name}-${Date.now()}`);
  return url.href;
}

await mkdir(outputDir, { recursive: true });
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
  await send("Page.navigate", { url: devUrl(viewport) });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  await evaluate(`(() => {
    localStorage.removeItem("cardeater.active-run.v2");
    localStorage.removeItem("cardeater.progression.v1");
    localStorage.removeItem("cardeater.run-history.v1");
    localStorage.setItem("cardeater.story-tutorial.v1", "complete");
    localStorage.removeItem("cardeater.shop-tutorial.v1");
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');

  await click("#newGameButton");
  await waitFor('!document.querySelector("#modeChooser")?.hidden');
  const developer = await evaluate(`(() => ({
    enabled: document.documentElement.dataset.developerMode === "true",
    notice: !document.querySelector("#developerModeNotice")?.hidden,
    all_modes: ["#prepModeButton", "#shopModeButton", "#contractShopModeButton", "#endlessModeButton", "#hardModeButton"].every((selector) => !document.querySelector(selector)?.disabled),
    unlocked_sigils: document.querySelectorAll("#homeModeSigils .is-unlocked").length,
    cleared_sigils: document.querySelectorAll("#homeModeSigils .is-cleared").length,
    god_hidden: document.querySelector("#godBadge")?.hidden,
  }))()`);

  await click("#shopModeButton");
  await waitFor('document.querySelector("#shopTutorial")?.classList.contains("show")');
  const shopTutorial = await evaluate(`(() => {
    const panel = document.querySelector(".shop-tutorial-panel")?.getBoundingClientRect();
    const copy = document.querySelector("#shopTutorial")?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
    const details = [...document.querySelectorAll(".shop-tutorial-steps small")];
    return {
      steps: details.length,
      explains_base_gold: copy.includes("每张实体牌第一次被吃掉") && copy.includes("1 金币"),
      explains_no_duplicate: copy.includes("不会重复获得"),
      mentions_catalog_switch: copy.includes("卡牌图鉴") && copy.includes("商店效果"),
      minimum_copy_size: Math.min(...details.map((node) => parseFloat(getComputedStyle(node).fontSize))),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  await capture(`${viewport.name}-shop-tutorial`);
  await click("#shopTutorialContinue");
  const shopShuffle = await inspectShuffle();
  await capture(`${viewport.name}-shop-shuffle`);
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中"', 18000);
  const shopPlaying = await evaluate(`(() => {
    const inventory = document.querySelector(".inventory-bar")?.getBoundingClientRect();
    const hud = document.querySelector(".hud")?.getBoundingClientRect();
    const timer = document.querySelector("#timerCell");
    return {
      resource: document.querySelector("#resourceLabel")?.textContent,
      timer_hidden: Boolean(timer?.hidden || getComputedStyle(timer).display === "none"),
      inventory_below_hud: Boolean(inventory && hud && inventory.top >= hud.bottom),
    };
  })()`);
  await finishPlate("#eatButton");
  await accelerateRoundSummary();
  const shopSummary = await evaluate(`(() => {
    const lines = [...document.querySelectorAll("#summaryBreakdownList .receipt-line")];
    return {
      score_sources: lines.filter((line) => !line.classList.contains("gold-total") && !line.classList.contains("gold-detail")).map((line) => line.textContent.replace(/\\s+/g, " ").trim()),
      gold_totals: lines.filter((line) => line.classList.contains("gold-total")).map((line) => line.textContent.replace(/\\s+/g, " ").trim()),
      gold_details: lines.filter((line) => line.classList.contains("gold-detail")).length,
    };
  })()`);
  await wait(220);
  await capture(`${viewport.name}-shop-summary`);
  await click("#summaryContinueBtn");
  await waitFor('document.querySelector("#shopPanel")?.classList.contains("show")');
  await wait(240);
  const shop = await evaluate(`(() => ({
    gold: Number(document.querySelector("#shopGold")?.textContent),
    offers: document.querySelectorAll("#shopOfferList .shop-card").length,
    themed_offers: document.querySelectorAll("#shopThemeOfferList .shop-card").length,
    items: document.querySelectorAll("#shopItemOfferList .shop-item-card").length,
    deck_cards: document.querySelectorAll("#shopDeckList .deck-chip").length,
    offer_names: [...document.querySelectorAll("#shopOfferList .shop-card strong")].map((node) => node.textContent),
    horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }))()`);
  await capture(`${viewport.name}-shop`);

  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && !document.querySelector("#continueGameButton")?.disabled');
  await click("#continueGameButton");
  await waitFor('document.querySelector("#shopPanel")?.classList.contains("show")');
  const restoredOffers = await evaluate('[...document.querySelectorAll("#shopOfferList .shop-card strong")].map((node) => node.textContent)');

  await evaluate('localStorage.removeItem("cardeater.active-run.v2")');
  await send("Page.reload", { ignoreCache: true });
  await waitFor('typeof document.querySelector("#newGameButton")?.onclick === "function"');
  await click("#newGameButton");
  await click("#contractShopModeButton");
  await waitFor('document.querySelector("#ruleDraft")?.classList.contains("show") && document.querySelectorAll(".rule-card").length === 3');
  await click(".rule-card");
  const contractShuffle = await inspectShuffle();
  await capture(`${viewport.name}-contract-shuffle`);
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中"', 18000);
  await wait(180);
  const contract = await evaluate(`(() => {
    const timer = document.querySelector("#timerCell")?.getBoundingClientRect();
    const score = document.querySelector("#scoreValue")?.closest(".hud-cell")?.getBoundingClientRect();
    const inventory = document.querySelector(".inventory-bar")?.getBoundingClientRect();
    const hud = document.querySelector(".hud")?.getBoundingClientRect();
    return {
      timer_visible: Boolean(timer && !document.querySelector("#timerCell")?.hidden && timer.width > 0),
      timer_inside_score: Boolean(timer && score && timer.left >= score.left - 1 && timer.right <= score.right + 1),
      timer_value: document.querySelector("#timerValue")?.textContent,
      resource: document.querySelector("#resourceLabel")?.textContent,
      rule_button_visible: !document.querySelector("#ruleInfoButton")?.hidden,
      inventory_below_hud: Boolean(inventory && hud && inventory.top >= hud.bottom),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  await capture(`${viewport.name}-contract-playing`);
  await click("#ruleInfoButton");
  await waitFor('document.querySelector("#ruleStatus")?.classList.contains("show")');
  const contractStatus = await evaluate(`(() => {
    const panel = document.querySelector("#ruleStatus .modal-panel")?.getBoundingClientRect();
    return {
      title: document.querySelector("#ruleStatusTitle")?.textContent,
      summary: document.querySelector("#ruleStatusSummary")?.textContent?.replace(/\\s+/g, " ").trim(),
      active_cards: document.querySelectorAll("#ruleStatusList .rule-status-card").length,
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
    };
  })()`);
  await wait(120);
  await capture(`${viewport.name}-contract-status`);
  await click("#ruleStatusClose");
  await finishPlate("#eatButton");
  await accelerateRoundSummary();
  const contractSummary = await evaluate(`(() => {
    const lines = [...document.querySelectorAll("#summaryBreakdownList .receipt-line")];
    return {
      score_sources: lines.filter((line) => !line.classList.contains("gold-total") && !line.classList.contains("gold-detail") && !line.classList.contains("contract-pass") && !line.classList.contains("contract-fail") && !line.classList.contains("contract-pending")).map((line) => line.textContent.replace(/\\s+/g, " ").trim()),
      contract_status: lines.filter((line) => line.classList.contains("contract-pass") || line.classList.contains("contract-fail") || line.classList.contains("contract-pending")).map((line) => line.textContent.replace(/\\s+/g, " ").trim()),
      gold_details: lines.filter((line) => line.classList.contains("gold-detail")).map((line) => line.textContent.replace(/\\s+/g, " ").trim()),
      gold_totals: lines.filter((line) => line.classList.contains("gold-total")).map((line) => line.textContent.replace(/\\s+/g, " ").trim()),
    };
  })()`);
  await wait(220);
  await capture(`${viewport.name}-contract-summary`);
  reports.push({ viewport, developer, shop_tutorial: shopTutorial, shop_shuffle: shopShuffle, shop_playing: shopPlaying, shop_summary: shopSummary, shop, restored_offers: restoredOffers, contract_shuffle: contractShuffle, contract, contract_status: contractStatus, contract_summary: contractSummary });
}

const report = { generated_at: new Date().toISOString(), url: gameUrl, reports, browser_errors: browserErrors };
await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();

const failures = [
  ...browserErrors,
  ...reports.flatMap((entry) => [
    entry.developer.enabled && entry.developer.notice && entry.developer.all_modes && entry.developer.unlocked_sigils === 6 && entry.developer.cleared_sigils === 0 && entry.developer.god_hidden ? null : `${entry.viewport.name}: local developer mode did not distinguish unlocks from clears`,
    entry.shop_tutorial.steps === 4 && entry.shop_tutorial.explains_base_gold && entry.shop_tutorial.explains_no_duplicate && entry.shop_tutorial.mentions_catalog_switch && entry.shop_tutorial.minimum_copy_size >= 10 && entry.shop_tutorial.inside_viewport && !entry.shop_tutorial.horizontal_overflow ? null : `${entry.viewport.name}: shop tutorial is unclear, too small, or outside viewport`,
    entry.shop_shuffle.card_count >= 4 && entry.shop_shuffle.visible_cards === entry.shop_shuffle.card_count && entry.shop_shuffle.animation_name === "shuffleDeckSettle" && entry.shop_shuffle.card_animations.includes("riffleShuffleCard") && entry.shop_shuffle.split_directions === 2 && entry.shop_shuffle.stack_above_layer ? null : `${entry.viewport.name}: shop shuffle animation is missing`,
    entry.shop_playing.resource === "金币" && entry.shop_playing.timer_hidden ? null : `${entry.viewport.name}: shop HUD is invalid`,
    entry.shop_playing.inventory_below_hud ? null : `${entry.viewport.name}: shop item tray overlaps HUD`,
    entry.shop_summary.score_sources.some((line) => line.includes("牌面与效果")) && entry.shop_summary.score_sources.some((line) => line.includes("本轮得分")) && entry.shop_summary.gold_totals.length === 1 && entry.shop_summary.gold_details === 0 ? null : `${entry.viewport.name}: normal shop settlement lost score detail or expanded gold detail`,
    entry.shop.gold > 0 && entry.shop.offers === 3 && entry.shop.themed_offers === 3 && entry.shop.items === 2 && entry.shop.deck_cards === 7 ? null : `${entry.viewport.name}: shop inventory did not render`,
    entry.shop.horizontal_overflow ? `${entry.viewport.name}: shop has horizontal overflow` : null,
    JSON.stringify(entry.shop.offer_names) === JSON.stringify(entry.restored_offers) ? null : `${entry.viewport.name}: autosave changed shop offers`,
    entry.contract_shuffle.card_count >= 4 && entry.contract_shuffle.visible_cards === entry.contract_shuffle.card_count && entry.contract_shuffle.animation_name === "shuffleDeckSettle" && entry.contract_shuffle.card_animations.includes("riffleShuffleCard") && entry.contract_shuffle.split_directions === 2 && entry.contract_shuffle.stack_above_layer ? null : `${entry.viewport.name}: contract shuffle animation is missing`,
    entry.contract.timer_visible && entry.contract.timer_inside_score && entry.contract.resource === "金币" && entry.contract.rule_button_visible ? null : `${entry.viewport.name}: contract HUD or timer is invalid`,
    entry.contract.inventory_below_hud ? null : `${entry.viewport.name}: contract item tray overlaps HUD`,
    entry.contract_status.title === "并行条约" && entry.contract_status.summary.includes("1 条并行条约") && entry.contract_status.active_cards === 1 && entry.contract_status.inside_viewport ? null : `${entry.viewport.name}: parallel contract status is missing or outside viewport`,
    entry.contract_summary.score_sources.some((line) => line.includes("牌面与效果")) && entry.contract_summary.score_sources.some((line) => line.includes("本轮得分")) && entry.contract_summary.contract_status.length === 1 && entry.contract_summary.gold_details.length >= 1 && entry.contract_summary.gold_totals.length === 1 ? null : `${entry.viewport.name}: contract settlement is missing score, contract, or gold detail`,
    entry.contract.horizontal_overflow ? `${entry.viewport.name}: contract play has horizontal overflow` : null,
  ].filter(Boolean)),
];
if (failures.length > 0) throw new Error(`Mode smoke failures:\n${failures.join("\n")}`);
console.log(JSON.stringify(report, null, 2));
