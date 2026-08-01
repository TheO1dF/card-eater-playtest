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
  if (message.method === "Log.entryAdded" && (
    message.params.entry.level === "error"
    || message.params.entry.text.includes("AudioContext was not allowed to start")
  )) {
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
    localStorage.removeItem("cardeater.settings.v1");
    localStorage.removeItem("cardeater.progression.v1");
    localStorage.setItem("cardeater.story-tutorial.v1", "complete");
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  await wait(180);

  await capture(`${viewport.name}-home`);
  const home = await evaluate(`(() => {
    const panel = document.querySelector(".home-panel")?.getBoundingClientRect();
    const actions = [...document.querySelectorAll(".home-actions > button")];
    const logo = document.querySelector("#homeLogo")?.getBoundingClientRect();
    const sigils = document.querySelector("#homeModeSigils")?.getBoundingClientRect();
    return {
      title: document.querySelector("#welcomeTitle")?.textContent,
      action_labels: actions.map((button) => button.querySelector("b")?.textContent),
      continue_disabled: document.querySelector("#continueGameButton")?.disabled,
      rain_count: document.querySelectorAll(".home-rain-card").length,
      rain_unique_cards: new Set([...document.querySelectorAll(".home-rain-card")].map((card) => card.dataset.cardId)).size,
      rain_card_ratio: (() => { const style = getComputedStyle(document.querySelector(".home-rain-card")); return parseFloat(style.width) / parseFloat(style.height); })(),
      rain_art_square: (() => { const rect = document.querySelector(".home-rain-art")?.getBoundingClientRect(); return Boolean(rect && Math.abs(rect.width - rect.height) <= 1); })(),
      rain_animation: getComputedStyle(document.querySelector(".home-rain-card")).animationName,
      logo_lines: document.querySelectorAll(".home-logo span").length,
      unlocked_sigils: document.querySelectorAll("#homeModeSigils .is-unlocked").length,
      cleared_sigils: document.querySelectorAll("#homeModeSigils .is-cleared").length,
      logo_has_annotation: Boolean(document.querySelector(".home-hero p")),
      logo_sigil_gap: logo && sigils ? sigils.top - logo.bottom : -1,
      sigil_actions_gap: sigils && actions[0] ? actions[0].getBoundingClientRect().top - sigils.bottom : -1,
      panel_border: parseFloat(getComputedStyle(document.querySelector(".home-panel")).borderTopWidth),
      shell_border: parseFloat(getComputedStyle(document.querySelector(".game-shell")).borderTopWidth),
      modes_locked: ["#endlessModeButton", "#hardModeButton"].every((selector) => document.querySelector(selector)?.disabled),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  const overlayLayering = await evaluate(`(() => {
    const topbarZ = Number.parseInt(getComputedStyle(document.querySelector(".topbar")).zIndex, 10);
    const overlays = [...document.querySelectorAll(".overlay")].map((overlay) => {
      const inlineDisplay = overlay.style.display;
      overlay.style.display = "grid";
      const style = getComputedStyle(overlay);
      const rect = overlay.getBoundingClientRect();
      const result = {
        id: overlay.id,
        position: style.position,
        z: Number.parseInt(style.zIndex, 10),
        covers: rect.left <= .5 && rect.top <= .5 && rect.right >= innerWidth - .5 && rect.bottom >= innerHeight - .5,
      };
      overlay.style.display = inlineDisplay;
      return result;
    });
    return {
      count: overlays.length,
      all_fixed: overlays.every((overlay) => overlay.position === "fixed"),
      all_cover_viewport: overlays.every((overlay) => overlay.covers),
      all_above_topbar: overlays.every((overlay) => overlay.z > topbarZ),
      failures: overlays.filter((overlay) => overlay.position !== "fixed" || !overlay.covers || overlay.z <= topbarZ),
    };
  })()`);
  await clickElement("#homeMenuButton");
  await waitFor('document.querySelector("#gameMenu")?.classList.contains("show")');
  await wait(220);
  await capture(`${viewport.name}-home-menu`);
  const homeMenu = await evaluate(`(() => {
    const overlay = document.querySelector("#gameMenu");
    const rect = overlay?.getBoundingClientRect();
    const panel = overlay?.querySelector(".modal-panel")?.getBoundingClientRect();
    return {
      viewport_cover: Boolean(rect && rect.left <= .5 && rect.top <= .5 && rect.right >= innerWidth - .5 && rect.bottom >= innerHeight - .5),
      top_edge_owned: overlay?.contains(document.elementFromPoint(innerWidth / 2, 1)) ?? false,
      panel_inside: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      welcome_remains_underneath: document.querySelector("#welcomeOverlay")?.classList.contains("show") ?? false,
    };
  })()`);
  await clickElement("#gameMenuClose");
  await waitFor('!document.querySelector("#gameMenu")?.classList.contains("show")');
  await clickElement("#homeThemeToggle");
  await waitFor('document.querySelector("#welcomeOverlay")?.dataset.homeTheme === "day"');
  await clickElement("#newGameButton");
  await waitFor('!document.querySelector("#modeChooser")?.hidden');
  await wait(260);
  const homeTheme = await evaluate(`(() => {
    const rgb = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (value) => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const contrast = (foreground, background) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + .05) / (dark + .05);
    };
    const button = document.querySelector("#normalModeButton");
    const background = getComputedStyle(button).backgroundColor;
    const welcome = document.querySelector("#welcomeOverlay");
    const rain = document.querySelector("#homeCardRain");
    const rainRect = rain?.getBoundingClientRect();
    const logoRect = document.querySelector("#homeLogo")?.getBoundingClientRect();
    const sigilRect = document.querySelector("#homeModeSigils")?.getBoundingClientRect();
    const actionRect = document.querySelector(".home-actions > button")?.getBoundingClientRect();
    const footerRect = document.querySelector(".home-footer")?.getBoundingClientRect();
    const chooser = document.querySelector("#modeChooser");
    return {
      selected: document.querySelector("#welcomeOverlay")?.dataset.homeTheme,
      saved: JSON.parse(localStorage.getItem("cardeater.settings.v1") || "{}").home_theme,
      toggle_label: document.querySelector("#homeThemeToggle")?.textContent?.trim(),
      title_contrast: contrast(getComputedStyle(button.querySelector("b")).color, background),
      copy_contrast: contrast(getComputedStyle(button.querySelector("small")).color, background),
      random_start_first: chooser?.firstElementChild?.classList.contains("random-start-toggle") ?? false,
      rain_anchored: ["absolute", "fixed"].includes(getComputedStyle(rain).position),
      rain_covers_viewport: Boolean(rainRect && rainRect.left <= .5 && rainRect.top <= .5 && rainRect.right >= innerWidth - .5 && rainRect.bottom >= innerHeight - .5),
      home_scroll_locked: welcome.scrollHeight <= welcome.clientHeight + 1,
      chooser_scroll_contained: chooser.scrollHeight <= chooser.clientHeight + 1 || getComputedStyle(chooser).overflowY === "auto",
      footer_inside: Boolean(footerRect && footerRect.top >= -1 && footerRect.bottom <= innerHeight + 1),
      logo_width_ratio: logoRect?.width / innerWidth || 0,
      logo_sigil_gap: logoRect && sigilRect ? sigilRect.top - logoRect.bottom : -1,
      sigil_actions_gap: sigilRect && actionRect ? actionRect.top - sigilRect.bottom : -1,
    };
  })()`);
  await capture(`${viewport.name}-home-day`);
  await waitFor('import("./js/audio.js").then(({ getAudioStatus }) => { const status = getAudioStatus(); return status.context_state === "running" && status.bgm_playing && status.theme === "day"; })');
  const dayThemeAudio = await evaluate(`import("./js/audio.js").then(({ getAudioStatus }) => getAudioStatus())`);
  await wait(220);
  await clickElement("#homeThemeToggle");
  await waitFor('document.querySelector("#welcomeOverlay")?.dataset.homeTheme === "night"');
  await waitFor('import("./js/audio.js").then(({ getAudioStatus }) => getAudioStatus().theme === "night")');
  const nightThemeAudio = await evaluate(`import("./js/audio.js").then(({ getAudioStatus }) => getAudioStatus())`);
  const homeThemeAudio = { day: dayThemeAudio, night: nightThemeAudio };

  await evaluate(`localStorage.setItem("cardeater.progression.v1", JSON.stringify({ runs_played: 8, victories: 6, shop_victories: 1, endless_victories: 1, god: true, mode_victories: { normal: 1, prep: 1, shop: 1, contract_shop: 1, hard: 1, endless: 1 } }))`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  const homeProgression = await evaluate(`(() => ({
    cleared_sigils: document.querySelectorAll("#homeModeSigils .is-cleared").length,
    clear_count: document.querySelector("#homeLogo")?.dataset.clearCount,
    god_visible: !document.querySelector("#godBadge")?.hidden,
    god_logo: document.querySelector("#homeLogo")?.classList.contains("is-god"),
  }))()`);
  await wait(360);
  await capture(`${viewport.name}-home-god`);
  await evaluate('localStorage.removeItem("cardeater.progression.v1")');
  await send("Page.reload", { ignoreCache: true });
  await waitFor('document.readyState === "complete" && typeof document.querySelector("#newGameButton")?.onclick === "function"');
  const homeAudio = await evaluate(`import("./js/audio.js").then(({ getAudioStatus }) => getAudioStatus())`);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait(80);
  const reducedMotion = await evaluate(`(() => {
    const cards = [...document.querySelectorAll(".home-rain-card")];
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      visible_cards: cards.filter((card) => getComputedStyle(card).animationDuration !== "0.001s").length,
      duration: cards[0] ? parseFloat(getComputedStyle(cards[0]).animationDuration) : 0,
    };
  })()`);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

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
  await wait(720);
  await capture(`${viewport.name}-deal`);
  const dealing = await evaluate(`(() => {
    const layer = document.querySelector(".deal-layer");
    const dealtCards = [...document.querySelectorAll("#cardStack .game-card[data-deal-instance='true']")];
    const stack = document.querySelector("#cardStack");
    const shell = document.querySelector(".game-shell");
    const table = document.querySelector(".playfield");
    return {
      real_stack_cards: dealtCards.length,
      visible_stack_cards: dealtCards.filter((card) => getComputedStyle(card).visibility !== "hidden" && parseFloat(getComputedStyle(card).opacity) > .05).length,
      dealt_uuids: dealtCards.map((card) => card.dataset.cardUuid),
      shuffle_directions: new Set(dealtCards.map((card) => card.style.getPropertyValue("--shuffle-x"))).size,
      card_animation_names: [...new Set(dealtCards.map((card) => getComputedStyle(card).animationName))],
      fake_card_backs: document.querySelectorAll(".deal-card-trail i").length,
      outer_rings: document.querySelectorAll(".deal-landing").length,
      message: layer?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      visible_prompt_count: document.querySelectorAll(".deal-copy").length,
      shell_transform: shell ? getComputedStyle(shell).transform : "missing",
      animation_name: stack ? getComputedStyle(stack).animationName : "missing",
      covers_table: Boolean(layer && table && layer.getBoundingClientRect().width >= table.getBoundingClientRect().width - 1),
      inventory_hidden: (() => { const inventory = document.querySelector(".inventory-bar"); const style = getComputedStyle(inventory); return style.visibility === "hidden" && parseFloat(style.opacity) === 0; })(),
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
    delete_markers: document.querySelector("#tokenValue")?.textContent,
    inventory_below_hud: (() => { const inventory = document.querySelector(".inventory-bar")?.getBoundingClientRect(); const hud = document.querySelector(".hud")?.getBoundingClientRect(); return Boolean(inventory && hud && inventory.top >= hud.bottom + 4); })(),
    has_gold: Boolean(document.querySelector("#goldValue")),
    timer_visible: (() => { const cell = document.querySelector("#timerCell"); return Boolean(cell && !cell.hidden && getComputedStyle(cell).display !== "none"); })(),
    card_copy_size: parseFloat(getComputedStyle(document.querySelector(".card-effect")).fontSize),
    hud_label_size: parseFloat(getComputedStyle(document.querySelector(".hud-cell span")).fontSize),
    text_size_adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
    card_within_viewport: (() => { const card = document.querySelector(".game-card.is-active")?.getBoundingClientRect(); return Boolean(card && card.left >= -1 && card.right <= innerWidth + 1); })(),
    card_head_inside: [...document.querySelectorAll(".game-card.is-active .card-head > *")].every((node) => { const head = node.parentElement.getBoundingClientRect(); const rect = node.getBoundingClientRect(); return rect.left >= head.left - 1 && rect.right <= head.right + 1; }),
    visible_stack_cards: [...document.querySelectorAll("#cardStack .game-card")].filter((card) => getComputedStyle(card).visibility !== "hidden" && parseFloat(getComputedStyle(card).opacity) > .05).length,
    point_values_inside: [...document.querySelectorAll(".game-card.is-active .card-point-value")].every((value) => {
      const cell = value.closest(".card-scores > span")?.getBoundingClientRect();
      const rect = value.getBoundingClientRect();
      return Boolean(cell && rect.top >= cell.top + 1 && rect.bottom <= cell.bottom - 1);
    }),
    point_line_height_safe: (() => { const value = document.querySelector(".game-card.is-active .card-point-value"); const style = getComputedStyle(value); return parseFloat(style.lineHeight) >= parseFloat(style.fontSize); })(),
    horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }))()`);
  playing.audio = await evaluate(`import("./js/audio.js").then(({ getAudioStatus }) => getAudioStatus())`);
  playing.dealt_instances_survive = await evaluate(`(${JSON.stringify(dealing.dealt_uuids)}).every((uuid) => Boolean(document.querySelector('[data-card-uuid="' + uuid + '"][data-deal-instance="true"]')))`);

  await clickElement("#menuButton");
  await waitFor('document.querySelector("#gameMenu")?.classList.contains("show")');
  await wait(220);
  await evaluate('document.querySelector(\'[data-font-size="large"]\')?.click()');
  await waitFor('document.documentElement.dataset.fontSize === "large"');
  await evaluate('document.querySelector("#menuRules").open = true');
  await capture(`${viewport.name}-menu`);
  const menu = await evaluate(`(() => {
    const text = document.querySelector("#menuRules")?.textContent?.replace(/\\s+/g, " ").trim() ?? "";
    const overlay = document.querySelector("#gameMenu");
    const overlayRect = overlay?.getBoundingClientRect();
    const panelRect = overlay?.querySelector(".modal-panel")?.getBoundingClientRect();
    return {
      rule_count: document.querySelectorAll("#menuRules li").length,
      has_home: Boolean(document.querySelector("#menuHomeButton")?.getBoundingClientRect().height),
      has_autosave_rule: text.includes("自动保存"),
      objective: document.querySelector("#menuObjective")?.textContent?.trim() ?? "",
      forbidden_terms: ["金币", "商店", "限时经济", "任务选择"].filter((term) => text.includes(term)),
      viewport_cover: Boolean(overlayRect && overlayRect.left <= .5 && overlayRect.top <= .5 && overlayRect.right >= innerWidth - .5 && overlayRect.bottom >= innerHeight - .5),
      top_edge_owned: overlay?.contains(document.elementFromPoint(innerWidth / 2, 1)) ?? false,
      panel_inside: Boolean(panelRect && panelRect.left >= -1 && panelRect.right <= innerWidth + 1 && panelRect.top >= -1 && panelRect.bottom <= innerHeight + 1),
      active_uuid: document.querySelector(".game-card.is-active")?.dataset.cardUuid,
    };
  })()`);
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))');
  await wait(120);
  menu.background_action_blocked = await evaluate(`document.querySelector("#gameMenu")?.classList.contains("show") && document.querySelector(".game-card.is-active")?.dataset.cardUuid === ${JSON.stringify(menu.active_uuid)}`);

  await clickElement("#cardCatalogButton");
  await waitFor('document.querySelector("#cardCatalog")?.classList.contains("show") && document.querySelectorAll("#catalogList .deck-status-card").length === 89');
  await wait(220);
  await capture(`${viewport.name}-catalog`);
  const catalog = await evaluate(`(() => {
    const cards = [...document.querySelectorAll("#catalogList .deck-status-card")];
    const checked = cards.slice(0, 12);
    const inside = (parent, child) => {
      const outer = parent.getBoundingClientRect();
      const inner = child.getBoundingClientRect();
      return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    };
    return {
      count: cards.length,
      effects_present: checked.every((card) => (card.querySelector(".deck-status-copy i")?.textContent?.trim()?.length ?? 0) > 0),
      effects_inside: checked.every((card) => inside(card, card.querySelector(".deck-status-copy i"))),
      inspectable: checked.every((card) => card.getAttribute("role") === "button" && card.tabIndex === 0),
      point_rows_horizontal: checked.every((card) => {
        const points = [...card.querySelectorAll(".deck-status-copy em .card-point-wrap")];
        return points.length === 2 && Math.abs(points[0].getBoundingClientRect().top - points[1].getBoundingClientRect().top) <= 2;
      }),
      standard_selected: document.querySelector('#cardCatalog [data-catalog-mode="standard"]')?.getAttribute("aria-pressed") === "true",
      viewport_cover: (() => { const rect = document.querySelector("#cardCatalog")?.getBoundingClientRect(); return Boolean(rect && rect.left <= .5 && rect.top <= .5 && rect.right >= innerWidth - .5 && rect.bottom >= innerHeight - .5); })(),
    };
  })()`);
  await clickElement('#cardCatalog [data-catalog-mode="shop"]');
  await waitFor('document.querySelector(\'#catalogList [data-card-id="F013"] .deck-status-copy i\')?.textContent.includes("金币")');
  const catalogModes = await evaluate(`(() => ({
    shop_selected: document.querySelector('#cardCatalog [data-catalog-mode="shop"]')?.getAttribute("aria-pressed") === "true",
    shop_summary: document.querySelector("#catalogSummary")?.textContent ?? "",
    shop_effect: document.querySelector('#catalogList [data-card-id="F013"] .deck-status-copy i')?.textContent ?? "",
    standard_effect_changed: !document.querySelector('#catalogList [data-card-id="F013"] .deck-status-copy i')?.textContent.includes("删牌标记"),
  }))()`);
  await capture(`${viewport.name}-catalog-shop-effects`);
  await clickElement('#catalogList [data-card-id="F013"]');
  await waitFor('document.querySelector("#catalogCardDetail")?.classList.contains("show") && Boolean(document.querySelector("#catalogCardPreview .game-card"))');
  await wait(220);
  await capture(`${viewport.name}-catalog-detail-shop`);
  const shopDetailEffect = await evaluate('document.querySelector("#catalogCardDetailCopy section p")?.textContent?.trim() ?? ""');
  await clickElement('#catalogCardDetail [data-catalog-mode="standard"]');
  await waitFor('document.querySelector("#catalogCardDetailCopy section p")?.textContent.includes("删牌标记")');
  await capture(`${viewport.name}-catalog-detail-standard`);
  const catalogDetail = await evaluate(`(() => {
    const panel = document.querySelector(".catalog-detail-panel")?.getBoundingClientRect();
    const effect = document.querySelector("#catalogCardDetailCopy section p")?.textContent?.trim() ?? "";
    const preview = document.querySelector("#catalogCardPreview .game-card")?.getBoundingClientRect();
    return {
      effect_visible: effect.length > 0,
      shop_effect_visible: ${JSON.stringify(shopDetailEffect)}.includes("金币"),
      standard_effect_visible: effect.includes("删牌标记"),
      standard_selected: document.querySelector('#catalogCardDetail [data-catalog-mode="standard"]')?.getAttribute("aria-pressed") === "true",
      preview_visible: Boolean(preview && preview.width > 200 && preview.height > 260),
      inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
      viewport_cover: (() => { const rect = document.querySelector("#catalogCardDetail")?.getBoundingClientRect(); return Boolean(rect && rect.left <= .5 && rect.top <= .5 && rect.right >= innerWidth - .5 && rect.bottom >= innerHeight - .5); })(),
    };
  })()`);
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await waitFor('document.querySelector("#cardCatalog")?.classList.contains("show") && !document.querySelector("#catalogCardDetail")?.classList.contains("show")');
  await clickElement("#cardCatalogClose");
  await waitFor('document.querySelector("#gameMenu")?.classList.contains("show")');
  await clickElement("#gameMenuClose");

  const scoreStress = await evaluate(`(() => {
    const card = document.querySelector(".game-card.is-active");
    const art = card?.querySelector(".card-art");
    if (!card || !art) return { score_inside: false, postpone_inside: false, card_inside: false };
    card.classList.add("is-postponed", "has-point-change");
    art.insertAdjacentHTML("beforeend", '<span class="card-postpone-mark"><b>↔</b> 12/12</span>');
    const wraps = [...card.querySelectorAll(".card-point-wrap")];
    const samples = [["-123", "▼99", "原 -24"], ["+987", "▲986", "原 +1"]];
    wraps.forEach((wrap, index) => {
      wrap.className = "card-point-wrap " + (index === 0 ? "point-decreased" : "point-increased") + " is-wide";
      wrap.innerHTML = '<b class="card-point-value">' + samples[index][0] + '</b><small class="card-point-delta"><span>' + samples[index][1] + '</span><span>' + samples[index][2] + '</span></small>';
    });
    const inside = (parent, child) => {
      const outer = parent.getBoundingClientRect();
      const inner = child.getBoundingClientRect();
      return inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    };
    const scoreInside = [...card.querySelectorAll(".card-scores > span")].every((cell) =>
      [...cell.querySelectorAll(".card-point-value, .card-point-delta")].every((child) => inside(cell, child))
    );
    const postpone = card.querySelector(".card-postpone-mark");
    return {
      score_inside: scoreInside,
      postpone_inside: Boolean(postpone && inside(art, postpone)),
      card_inside: card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1,
      point_label_size: parseFloat(getComputedStyle(card.querySelector(".card-point-delta")).fontSize),
      font_mode: document.documentElement.dataset.fontSize,
    };
  })()`);
  await capture(`${viewport.name}-large-score-stress`);

  await finishCurrentPlate();
  await capture(`${viewport.name}-summary-1`);
  const summaryTarget = await evaluate('document.querySelector("#summaryMilestoneScore")?.textContent?.trim() ?? ""');
  await clickElement("#summaryContinueBtn");
  await waitFor('document.querySelector("#cardDraft")?.classList.contains("show") && document.querySelectorAll(".draft-card").length === 3');
  const offerNamesBefore = await evaluate('[...document.querySelectorAll(".draft-card .shop-card-copy strong")].map((node) => node.textContent)');
  await clickElement("#draftReroll");
  await waitFor('document.querySelector("#draftRerollValue")?.textContent === "0"');
  await wait(180);
  await capture(`${viewport.name}-draft-rerolled`);
  const draft = await evaluate(`(() => {
    const panel = document.querySelector(".draft-reward-panel")?.getBoundingClientRect();
    const panelElement = document.querySelector(".draft-reward-panel");
    const grid = document.querySelector("#cardDraftList");
    const title = document.querySelector("#cardDraftTitle");
    const widths = [...document.querySelectorAll(".draft-actions > button")].map((button) => button.getBoundingClientRect().width);
    const actionRects = [...document.querySelectorAll(".draft-actions > button")].map((button) => button.getBoundingClientRect());
    const walletLabels = [...document.querySelectorAll(".draft-wallets .shop-wallet span")];
    const walletValues = [...document.querySelectorAll(".draft-wallets .shop-wallet strong")];
    const cards = [...document.querySelectorAll("#cardDraftList .draft-card")];
    return {
      offer_count: document.querySelectorAll(".draft-card").length,
      offer_names: [...document.querySelectorAll(".draft-card .shop-card-copy strong")].map((node) => node.textContent),
      reroll_value: document.querySelector("#draftRerollValue")?.textContent,
      action_widths: widths,
      equal_actions: Math.max(...widths) - Math.min(...widths) <= 1,
      actions_single_row: actionRects.every((rect) => Math.abs(rect.top - actionRects[0].top) <= 2),
      point_rows_horizontal: [...document.querySelectorAll(".draft-card-points")].every((row) => {
        const eat = row.querySelector(".draft-eat-point")?.getBoundingClientRect();
        const discard = row.querySelector(".draft-discard-point")?.getBoundingClientRect();
        return Boolean(eat && discard && Math.abs(eat.top - discard.top) <= 2 && row.scrollWidth <= row.clientWidth + 1);
      }),
      wallet_labels: walletLabels.map((label) => label.textContent),
      wallet_labels_fit: walletLabels.every((label) => label.scrollWidth <= label.clientWidth + 1),
      wallet_values_fit: walletValues.every((value) => value.scrollWidth <= value.clientWidth + 1 && value.scrollHeight <= value.clientHeight + 1),
      wallet_label_max_size: Math.max(...walletLabels.map((label) => parseFloat(getComputedStyle(label).fontSize))),
      title_single_line: Boolean(title && title.scrollWidth <= title.clientWidth + 1 && title.scrollHeight <= title.clientHeight + 1),
      panel_scroll_free: Boolean(panelElement && panelElement.scrollHeight <= panelElement.clientHeight + 1),
      grid_scroll_free: Boolean(grid && grid.scrollHeight <= grid.clientHeight + 1),
      card_content_fits: cards.every((card) => card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1),
      compact_height: Boolean(panel && panel.height <= innerHeight * .86),
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
      card_choice_id: [...document.querySelectorAll(".item-draft-card")].find((card) => /^A[1-8]$/.test(card.dataset.itemId))?.dataset.itemId ?? null,
      has_category_choice: Boolean(document.querySelector('.item-draft-card[data-item-id="C19"]')),
      has_persistent: Boolean(document.querySelector(".item-draft-card:not(.is-consumable)")),
    };
  })()`);
  let itemChoice = { shown: false };
  if (itemDraft.card_choice_id) {
    await clickElement(`.item-draft-card[data-item-id="${itemDraft.card_choice_id}"]`);
    await waitFor('document.querySelector("#itemCardChoice")?.classList.contains("show") && document.querySelectorAll("#itemCardChoice .draft-card").length === 3');
    await wait(180);
    await capture(`${viewport.name}-item-card-choice`);
    itemChoice = await evaluate(`(() => {
      const panel = document.querySelector(".item-choice-panel")?.getBoundingClientRect();
      const cards = [...document.querySelectorAll("#itemCardChoice .draft-card")];
      const widths = cards.map((card) => card.getBoundingClientRect().width);
      return {
        shown: true,
        count: cards.length,
        equal_cards: Math.max(...widths) - Math.min(...widths) <= 1,
        inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
        point_rows_horizontal: cards.every((card) => {
          const points = card.querySelector(".draft-card-points")?.getBoundingClientRect();
          return Boolean(points && points.width > points.height * 1.3);
        }),
      };
    })()`);
    await clickElement("#itemCardChoice .draft-card");
  } else if (itemDraft.has_category_choice) {
    await clickElement('.item-draft-card[data-item-id="C19"]');
    await waitFor('document.querySelector("#itemCategoryChoice")?.classList.contains("show") && document.querySelectorAll("#itemCategoryChoice .item-category-button").length >= 1');
    await clickElement("#itemCategoryChoice .item-category-button");
  } else {
    await clickElement(itemDraft.has_persistent ? ".item-draft-card:not(.is-consumable)" : ".item-draft-card");
  }
  await waitFor('document.querySelector("#phaseValue")?.textContent === "出牌中" && document.querySelector("#roundValue")?.textContent === "4/15"', 12000);
  const nextRound = await evaluate(`(() => ({
    round: document.querySelector("#roundValue")?.textContent,
    owned_items: document.querySelectorAll("#itemTray .item-chip").length,
    save_exists: Boolean(localStorage.getItem("cardeater.active-run.v2")),
    item_history: JSON.parse(localStorage.getItem("cardeater.active-run.v2") || "{}").item_history?.length || 0,
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

  reports.push({ viewport, home, home_menu: homeMenu, overlay_layering: overlayLayering, home_theme: homeTheme, home_theme_audio: homeThemeAudio, home_progression: homeProgression, home_audio: homeAudio, reduced_motion: reducedMotion, unlock, dealing, playing, score_stress: scoreStress, menu, catalog, catalog_modes: catalogModes, catalog_detail: catalogDetail, summary_target: summaryTarget, draft, delete_layout: deleteLayout, save_home: saveHome, item_draft: itemDraft, item_choice: itemChoice, next_round: nextRound, card_art: cardArt });
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
    entry.home.rain_count >= 24 && entry.home.rain_unique_cards >= 16 && entry.home.logo_lines === 2 ? null : `${entry.viewport.name}: home card rain is not varied`,
    Math.abs(entry.home.rain_card_ratio - (1 / 1.34)) <= .02 && entry.home.rain_art_square && entry.home.rain_animation === "homeCardFall" ? null : `${entry.viewport.name}: home rain cards are distorted`,
    !entry.home.logo_has_annotation && entry.home.panel_border === 0 && entry.home.shell_border === 0 ? null : `${entry.viewport.name}: home logo still has annotation or frame`,
    entry.home.logo_sigil_gap >= 4 && entry.home.logo_sigil_gap <= 28 ? null : `${entry.viewport.name}: home logo and mode sigils have the wrong closed spacing`,
    entry.home.sigil_actions_gap >= 12 && entry.home.sigil_actions_gap <= 72 ? null : `${entry.viewport.name}: primary home actions are too far from the logo group`,
    entry.home.modes_locked ? null : `${entry.viewport.name}: advanced modes should start locked`,
    entry.home.unlocked_sigils === 1 && entry.home.cleared_sigils === 0 ? null : `${entry.viewport.name}: fresh home mode sigils have wrong unlock/clear state`,
    entry.overlay_layering.count >= 16 && entry.overlay_layering.all_fixed && entry.overlay_layering.all_cover_viewport && entry.overlay_layering.all_above_topbar ? null : `${entry.viewport.name}: one or more modal layers do not cover the viewport`,
    entry.home_menu.viewport_cover && entry.home_menu.top_edge_owned && entry.home_menu.panel_inside && entry.home_menu.welcome_remains_underneath ? null : `${entry.viewport.name}: home menu does not fully cover the animated home screen`,
    entry.unlock.endless_enabled && entry.unlock.hard_enabled ? null : `${entry.viewport.name}: advanced modes did not unlock after victory`,
    entry.home.inside_viewport ? null : `${entry.viewport.name}: home outside viewport`,
    entry.home.horizontal_overflow ? `${entry.viewport.name}: home horizontal overflow` : null,
    entry.home_theme.selected === "day" && entry.home_theme.saved === "day" && entry.home_theme.toggle_label.includes("白昼") && entry.home_theme.title_contrast >= 4.5 && entry.home_theme.copy_contrast >= 4.5 ? null : `${entry.viewport.name}: day home text is low contrast or theme did not save`,
    entry.home_theme.random_start_first && entry.home_theme.rain_anchored && entry.home_theme.rain_covers_viewport && entry.home_theme.home_scroll_locked && entry.home_theme.chooser_scroll_contained && entry.home_theme.footer_inside ? null : `${entry.viewport.name}: home mode chooser escapes its fixed background or has wrong ordering`,
    entry.home_theme.logo_sigil_gap >= 4 && entry.home_theme.logo_sigil_gap <= 28 ? null : `${entry.viewport.name}: home logo and mode sigils overlap after opening the mode chooser`,
    entry.home_theme.sigil_actions_gap >= 12 && entry.home_theme.sigil_actions_gap <= 72 ? null : `${entry.viewport.name}: primary home actions have poor spacing after opening the mode chooser`,
    entry.viewport.mobile && entry.home_theme.logo_width_ratio < .58 ? `${entry.viewport.name}: home logo is too small for the mobile composition` : null,
    entry.home_theme_audio.day.theme === "day" && entry.home_theme_audio.day.mode.includes("C major") && entry.home_theme_audio.night.theme === "night" && entry.home_theme_audio.night.mode.includes("E minor") && entry.home_theme_audio.night.transport_step >= entry.home_theme_audio.day.transport_step && entry.home_theme_audio.night.theme_transition.includes("continuous") ? null : `${entry.viewport.name}: day/night BGM did not crossfade on one continuous transport`,
    entry.home_progression.cleared_sigils === 6 && entry.home_progression.clear_count === "6" && entry.home_progression.god_visible && entry.home_progression.god_logo ? null : `${entry.viewport.name}: mode clears did not evolve the home logo`,
    entry.home_audio.context_state === "uninitialized" && entry.home_audio.bgm_requested && !entry.home_audio.bgm_playing ? null : `${entry.viewport.name}: audio should wait silently for a user gesture`,
    entry.reduced_motion.matches && entry.reduced_motion.visible_cards >= 24 && entry.reduced_motion.duration > 1 ? null : `${entry.viewport.name}: animations disappear when reduced motion is enabled`,
    entry.dealing.real_stack_cards >= 4 && entry.dealing.visible_stack_cards === entry.dealing.real_stack_cards ? null : `${entry.viewport.name}: full real-stack shuffle is missing`,
    entry.dealing.visible_prompt_count === 0 && entry.dealing.message === "" ? null : `${entry.viewport.name}: shuffle still shows a top-left prompt`,
    entry.dealing.shuffle_directions === 2 && entry.dealing.card_animation_names.includes("riffleShuffleCard") ? null : `${entry.viewport.name}: cards do not split and riffle`,
    entry.dealing.fake_card_backs === 0 && entry.dealing.outer_rings === 0 && entry.playing.dealt_instances_survive ? null : `${entry.viewport.name}: deal still swaps to fake cards or retains a ring`,
    entry.dealing.shell_transform === "none" ? null : `${entry.viewport.name}: dealing animation moves the game shell`,
    entry.dealing.animation_name === "shuffleDeckSettle" && entry.dealing.covers_table ? null : `${entry.viewport.name}: shuffle animation is not table-wide`,
    entry.dealing.inventory_hidden ? null : `${entry.viewport.name}: item prompt remains visible during shuffle`,
    entry.playing.phase === "出牌中" && entry.playing.active_cards === 1 ? null : `${entry.viewport.name}: did not enter play`,
    entry.playing.delete_markers === "1" ? null : `${entry.viewport.name}: new game did not start with one delete marker`,
    entry.playing.inventory_below_hud ? null : `${entry.viewport.name}: item tray is not below the HUD`,
    entry.playing.audio.context_state === "running" && entry.playing.audio.bgm_playing && entry.playing.audio.groove_alignment === "kick-bass-melody-even-grid" ? null : `${entry.viewport.name}: BGM did not unlock or align after first interaction`,
    entry.playing.visible_stack_cards === Math.min(3, entry.dealing.real_stack_cards) ? null : `${entry.viewport.name}: deep shuffle cards remain visible during play`,
    entry.playing.card_copy_size >= 12 && entry.playing.hud_label_size >= 11 ? null : `${entry.viewport.name}: gameplay text remains too small`,
    entry.playing.text_size_adjust === "100%" && entry.playing.card_within_viewport && entry.playing.card_head_inside ? null : `${entry.viewport.name}: mobile text autosizing or card width is unsafe`,
    entry.playing.point_values_inside && entry.playing.point_line_height_safe ? null : `${entry.viewport.name}: gameplay point glyphs are clipped`,
    entry.playing.has_gold || entry.playing.timer_visible ? `${entry.viewport.name}: standard mode shows economy HUD` : null,
    entry.playing.horizontal_overflow ? `${entry.viewport.name}: gameplay horizontal overflow` : null,
    entry.score_stress.score_inside && entry.score_stress.postpone_inside && entry.score_stress.card_inside && entry.score_stress.font_mode === "large" ? null : `${entry.viewport.name}: large-font score/postpone content overflows`,
    entry.menu.rule_count >= 8 && entry.menu.has_home && entry.menu.has_autosave_rule && entry.menu.objective.includes("80 / 200 / 600") ? null : `${entry.viewport.name}: menu rules or milestone targets are incomplete`,
    entry.menu.viewport_cover && entry.menu.top_edge_owned && entry.menu.panel_inside && entry.menu.background_action_blocked ? null : `${entry.viewport.name}: menu layer leaks the background or allows gameplay input`,
    entry.menu.forbidden_terms.length ? `${entry.viewport.name}: legacy terms ${entry.menu.forbidden_terms.join(",")}` : null,
    entry.catalog.count === 89 && entry.catalog.effects_present && entry.catalog.effects_inside && entry.catalog.inspectable && entry.catalog.point_rows_horizontal && entry.catalog.standard_selected && entry.catalog.viewport_cover ? null : `${entry.viewport.name}: catalog summaries are clipped, uncovered, or not inspectable`,
    entry.catalog_modes.shop_selected && entry.catalog_modes.shop_summary.includes("商店效果") && entry.catalog_modes.shop_effect.includes("金币") && entry.catalog_modes.standard_effect_changed ? null : `${entry.viewport.name}: catalog shop effect switch is invalid`,
    entry.catalog_detail.effect_visible && entry.catalog_detail.shop_effect_visible && entry.catalog_detail.standard_effect_visible && entry.catalog_detail.standard_selected && entry.catalog_detail.preview_visible && entry.catalog_detail.inside_viewport && entry.catalog_detail.viewport_cover ? null : `${entry.viewport.name}: catalog detail dialog or effect switch is invalid`,
    entry.summary_target.includes("目标 80 分") ? null : `${entry.viewport.name}: first milestone target UI is stale`,
    entry.draft.offer_count === 3 && entry.draft.reroll_value === "0" && entry.draft.offers_changed ? null : `${entry.viewport.name}: draft reroll failed`,
    entry.draft.equal_actions ? null : `${entry.viewport.name}: draft action buttons are unequal`,
    entry.draft.actions_single_row ? null : `${entry.viewport.name}: draft actions are not kept on one row`,
    entry.draft.point_rows_horizontal ? null : `${entry.viewport.name}: draft points are not horizontal`,
    JSON.stringify(entry.draft.wallet_labels) === JSON.stringify(["删牌标记", "刷新标记"]) && entry.draft.wallet_labels_fit && entry.draft.wallet_values_fit ? null : `${entry.viewport.name}: draft wallet content overflows`,
    entry.viewport.mobile && entry.draft.wallet_label_max_size > 8 ? `${entry.viewport.name}: draft wallet labels remain too large` : null,
    entry.draft.inside_viewport ? null : `${entry.viewport.name}: draft outside viewport`,
    !entry.viewport.mobile || (entry.draft.title_single_line && entry.draft.panel_scroll_free && entry.draft.grid_scroll_free && entry.draft.card_content_fits && entry.draft.compact_height) ? null : `${entry.viewport.name}: large-font draft remains oversized, needs scrolling, or clips content`,
    entry.delete_layout.equal_actions ? null : `${entry.viewport.name}: delete buttons are unequal`,
    entry.save_home.continue_enabled && entry.save_home.save_exists ? null : `${entry.viewport.name}: autosave/continue failed`,
    entry.item_draft.count === 3 && entry.item_draft.equal_cards && entry.item_draft.item_ids.every((id) => /^(A[1-8]|B[1-3]|C(?:[1-9]|1\d|20|30))$/.test(id)) ? null : `${entry.viewport.name}: item draft invalid`,
    JSON.stringify(entry.item_draft.item_slots) === JSON.stringify(["relevant", "bridge", "wild"]) ? null : `${entry.viewport.name}: item draft slots are not relevant/bridge/wild`,
    entry.item_draft.inside_viewport ? null : `${entry.viewport.name}: item draft outside viewport`,
    !entry.item_draft.card_choice_id || (entry.item_choice.shown && entry.item_choice.count === 3 && entry.item_choice.equal_cards && entry.item_choice.inside_viewport && entry.item_choice.point_rows_horizontal) ? null : `${entry.viewport.name}: consumable item card choice is invalid`,
    entry.next_round.round === "4/15" && entry.next_round.save_exists && entry.next_round.item_history >= 1 ? null : `${entry.viewport.name}: failed to reach saved round four with an item reward`,
    entry.card_art.failed_ids.length ? `${entry.viewport.name}: card art failed ${entry.card_art.failed_ids.join(",")}` : null,
  ]).filter(Boolean),
];
if (failures.length > 0) throw new Error(`Smoke failures:\n${failures.join("\n")}`);
console.log(JSON.stringify(report, null, 2));
