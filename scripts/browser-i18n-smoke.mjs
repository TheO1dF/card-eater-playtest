import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const debugPort = Number(process.argv[2] ?? 9229);
const gameUrl = process.argv[3] ?? "http://127.0.0.1:8765";
const outputDir = resolve(process.argv[4] ?? ".artifacts/smoke-i18n-runtime");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const viewports = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
];

await mkdir(outputDir, { recursive: true });
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
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveMessage, reject) => pending.set(id, { resolve: resolveMessage, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await wait(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDir, `${name}.png`), Buffer.from(result.data, "base64"));
}

const results = [];
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

for (const viewport of viewports) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await send("Page.navigate", { url: `${gameUrl}?i18n-smoke=${viewport.name}-${Date.now()}` });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  await evaluate(`(() => {
    const settings = JSON.parse(localStorage.getItem("cardeater.settings.v1") || "{}");
    localStorage.setItem("cardeater.settings.v1", JSON.stringify({ ...settings, language: "en", summary_skip: true }));
    localStorage.setItem("cardeater.story-tutorial.v1", "complete");
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && document.documentElement.dataset.language === "en"');
  await evaluate(`(async () => {
    const [{ createUI }, { createInitialPlayerState, GAME_PHASES }, { GAME_MODES }, { createCardPool }, { getItemById }, { RULE_LIBRARY }] = await Promise.all([
      import("./js/ui.js"), import("./js/state.js"), import("./js/config.js"), import("./js/data.js"), import("./js/items.js"), import("./js/rules.js"),
    ]);
    const ui = createUI(document);
    const makeState = (mode = GAME_MODES.NORMAL) => createInitialPlayerState({
      mode,
      create_id: (card, index) => "i18n-" + card.id + "-" + index,
      mutation_id: mode === GAME_MODES.MUTATION ? "eat_feast" : null,
    });
    const callbacks = {
      onChoose() {}, onSkip() {}, onReroll() { return { success: false }; }, onRemove() { return { success: false }; },
      onPrepStore() { return { success: false }; }, onPrepRetrieve() { return { success: false }; }, onPrepRemove() { return { success: false }; },
    };
    const overlays = [...document.querySelectorAll(".overlay")];
    const closeAll = () => overlays.forEach((node) => node.classList.remove("show"));
    const scan = (name, selector) => new Promise((resolveScan) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = document.querySelector(selector);
      const text = root?.innerText || "";
      const localizedText = text.replaceAll("中文", "");
      const attributes = [...(root?.querySelectorAll("[title], [aria-label], [placeholder]") || [])]
        .flatMap((node) => [node.title, node.getAttribute("aria-label"), node.getAttribute("placeholder")]).filter(Boolean);
      window.__i18nPanels.push({
        name,
        selector,
        text,
        chinese_lines: localizedText.split("\\n").map((line) => line.trim()).filter((line) => /[\\u3400-\\u9fff]/u.test(line)),
        chinese_attributes: attributes.filter((value) => /[\\u3400-\\u9fff]/u.test(value)),
        horizontal_overflow: Boolean(root && root.scrollWidth > root.clientWidth + 1),
      });
      resolveScan();
    })));
    window.__i18nPanels = [];

    const standard = makeState();
    standard.phase = GAME_PHASES.PLAYING;
    standard.round.action_budget = 7;
    standard.round.reserve_count = 0;
    standard.round.draw_pile = standard.deck.slice();
    ui.renderHud(standard);
    document.querySelector("#deckInfoButton").click();
    await scan("permanent-deck", "#deckStatus");
    closeAll();
    document.querySelector("#itemInfoButton").click();
    await scan("empty-items", "#itemStatus");
    closeAll();

    standard.phase = GAME_PHASES.CARD_DRAFT;
    standard.items = [getItemById("B3"), getItemById("C10")];
    ui.openCardDraft(standard, createCardPool().slice(8, 11), callbacks);
    await scan("card-draft", "#cardDraft");
    document.querySelector("#draftViewItems").click();
    await scan("owned-items-from-draft", "#itemStatus");
    closeAll();

    ui.openItemDraft(standard, [getItemById("B3"), getItemById("C10"), getItemById("C18")], () => {}, () => {});
    await scan("item-draft", "#itemDraft");
    closeAll();
    ui.openItemCardChoice(getItemById("A1"), createCardPool().slice(0, 3), () => {});
    await scan("consumable-card-choice", "#itemCardChoice");
    closeAll();
    ui.openItemCategoryChoice(getItemById("C19"), ["水果", "动物", "星体"], () => {});
    await scan("consumable-category-choice", "#itemCategoryChoice");
    closeAll();

    const mutation = makeState(GAME_MODES.MUTATION);
    mutation.phase = GAME_PHASES.PLAYING;
    mutation.round.action_budget = 7;
    mutation.round.draw_pile = mutation.deck.slice();
    ui.renderHud(mutation);
    document.querySelector("#ruleInfoButton").click();
    await scan("mutation-status", "#ruleStatus");
    closeAll();

    const contracts = makeState(GAME_MODES.CONTRACT_SHOP);
    contracts.phase = GAME_PHASES.PLAYING;
    contracts.gold = 12;
    contracts.round.action_budget = 7;
    contracts.round.draw_pile = contracts.deck.slice();
    contracts.active_rules = RULE_LIBRARY.slice(0, 2).map((rule, index) => ({ ...rule, selected_round: index + 1, attempts: index + 2 }));
    ui.renderHud(contracts);
    document.querySelector("#ruleInfoButton").click();
    await scan("active-contracts", "#ruleStatus");
    closeAll();
    ui.openRuleDraft(RULE_LIBRARY.slice(0, 3), contracts, () => {});
    await scan("contract-draft", "#ruleDraft");
    closeAll();

    const shop = makeState(GAME_MODES.SHOP);
    shop.phase = GAME_PHASES.SHOP;
    shop.gold = 12;
    shop.items = [getItemById("B3")];
    const shopCards = createCardPool({ economy: true }).slice(0, 6).map((card, index) => ({
      ...card,
      shop_base_price: 5 + index,
      shop_discount: 1,
      shop_price: 4 + index,
    }));
    const shopItems = [getItemById("B3"), getItemById("C10")].map((item, index) => ({ ...item, shop_price: 7 + index }));
    ui.openShop(shop, shopCards.slice(0, 3), shopCards.slice(3), "水果", shopItems, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, { cost: 2, discount: 1, reason: null });
    await scan("shop", "#shopPanel");
    closeAll();

    const summaryCards = standard.deck.slice(0, 3).map((card, index) => ({
      card_id: card.id, name: card.name, type: card.type, rarity: card.rarity, edibility: card.edibility,
      action: index === 0 ? "eat" : "discard", points: index + 2, effect_bonus: index === 2 ? 1 : 0,
    }));
    ui.showRoundSummary({
      round_score: 13,
      starting_total_score: 0,
      presentation_cards: summaryCards,
      breakdown: [
        { label: "牌面与效果", text: "13 分", value: 13, number_style: "score-unit", kind: "base" },
        { label: "↳ 动物", text: "3 分", value: 3, number_style: "score-unit", kind: "detail" },
      ],
      plate_upgrade: false,
      reroll_grant: false,
    }, { ...standard, phase: GAME_PHASES.SCORING, total_score: 13 }, null, () => {}, { settings: { summary_skip: true } });
    await scan("round-results", "#roundSummary");
    closeAll();
    ui.openMenu(null, {
      music: true, effects: true, font_size: "standard", language: "en",
      summary_pause: false, summary_speed: "normal", summary_skip: false,
    }, { runs_played: 2, victories: 1, shop_victories: 0, normal_difficulty_max_unlocked: 1 }, {
      random_start: true, prep: true, shop: true, contract_shop: false, endless: true, mutation: true, normal_difficulty_max: 1, god: false,
    });
    await scan("title-menu", "#gameMenu");
    return window.__i18nPanels;
  })()`);
  const panels = await evaluate("window.__i18nPanels");
  await capture(`${viewport.name}-english-runtime-panels`);
  results.push({ viewport, panels });
}

const report = { generated_at: new Date().toISOString(), url: gameUrl, results, browser_errors: browserErrors };
await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
socket.close();
const failures = [
  ...browserErrors,
  ...results.flatMap(({ viewport, panels }) => panels.flatMap((panel) => [
    panel.chinese_lines.length > 0 ? `${viewport.name}/${panel.name}: untranslated text: ${panel.chinese_lines.join(" | ")}` : null,
    panel.chinese_attributes.length > 0 ? `${viewport.name}/${panel.name}: untranslated attributes: ${panel.chinese_attributes.join(" | ")}` : null,
    panel.horizontal_overflow ? `${viewport.name}/${panel.name}: horizontal overflow` : null,
  ].filter(Boolean))),
];
if (failures.length > 0) throw new Error(`English runtime smoke failures:\n${failures.join("\n")}`);
console.log(JSON.stringify(report, null, 2));
