import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, getLocale, setLocale, translate } from "../js/i18n.js";
import { getDefaultLanguage } from "../js/platform.js";

test("browser language detection falls back to English outside Chinese locales", () => {
  const chinese = ["zh", "zh-CN", "zh-TW", "zh-Hans-CN", "zh_HK", "ZH-hant", "cmn-Hans-CN", "yue-HK"];
  for (const tag of chinese) {
    assert.equal(getDefaultLanguage({ languages: [tag] }), "zh", tag);
    assert.equal(getDefaultLanguage({ language: tag }), "zh", tag);
  }

  const other = ["en", "en-US", "ja", "ko", "fr-FR", "de", "es-419", "zhuang"];
  for (const tag of other) {
    assert.equal(getDefaultLanguage({ languages: [tag] }), "en", tag);
    assert.equal(getDefaultLanguage({ language: tag }), "en", tag);
  }

  // The primary tag decides; a Chinese entry further down the list does not.
  assert.equal(getDefaultLanguage({ languages: ["en-US", "zh-CN"] }), "en");
  assert.equal(getDefaultLanguage({ languages: ["zh-CN", "en-US"] }), "zh");

  // navigator.languages missing, empty, or no navigator at all.
  assert.equal(getDefaultLanguage({ languages: [], language: "zh-CN" }), "zh");
  assert.equal(getDefaultLanguage({ language: "zh-CN" }), "zh");
  assert.equal(getDefaultLanguage({}), "en");
  assert.equal(getDefaultLanguage(null), "en");
});

test("English localization covers core game entities and dynamic labels", () => {
  setLocale(LANGUAGES.EN);
  assert.equal(getLocale(), "en");
  assert.equal(translate("苹果"), "Apple");
  assert.equal(translate("魔法帽"), "Magic Hat");
  assert.equal(translate("猫猫大军"), "Cat Army");
  assert.equal(translate("完美分类"), "Perfect Sorting");
  assert.equal(translate("第 3 轮赠礼"), "Round 3 Gift");
  assert.equal(translate("累计 25 / 目标 60 分"), "Total 25 / Target 60");
  assert.equal(translate("本局异变：猫猫大军。"), "Mutation: Cat Army.");
  assert.equal(translate("牌面与效果"), "Printed Values & Effects");
  assert.equal(translate("+12 分"), "+12 score");
  assert.equal(translate("自动重洗 · 7 张牌回到餐盘"), "Auto Reshuffle · 7 cards returned to the plate");
  assert.equal(translate("半熟果盘：水果连击从 1 开始"), "Half-Ripe Fruit Bowl: Fruit Combo starts at 1");
  assert.equal(translate("无尽模式：道具可以重复获得；每 5 轮扩容并获得删牌标记，餐盘最多 16 张；累计 1,000,000 分通关。"), "Endless Mode: items can stack. Every 5 rounds, expand the plate and gain a Remove Token; plate capacity is capped at 16. Reach 1,000,000 total score to clear.");
});

test("Chinese localization preserves canonical display copy", () => {
  setLocale(LANGUAGES.ZH);
  assert.equal(getLocale(), "zh");
  assert.equal(translate("苹果"), "苹果");
  assert.equal(translate("选择一张加入牌组"), "选择一张加入牌组");
});

test("English localization never leaves mixed Chinese in dynamic run panels", () => {
  setLocale(LANGUAGES.EN);
  const samples = [
    "7 / 160 张",
    "本轮登场",
    "7 张留在牌组",
    "永久餐盘",
    "每 5 轮免费 +1",
    "未登场候选",
    "每轮重新随机抽取",
    "1 枚",
    "仅轮末选牌阶段可用",
    "出牌阶段只能查看；轮末三选一时可消耗删牌标记删除卡牌。",
    "0 件永久道具",
    "尚未获得永久道具。完成第 3 轮后会出现第一次道具三选一。",
    "本局异变始终生效，可随时回到这里查看。",
    "暂无条约",
    "每轮共同判定；完成即领取金币，未完成会保留到下一轮。",
    "下一轮开场可以接取一条新条约。",
    "基础 $8 · 优惠 -1",
    "水果专柜",
    "删除 $0",
    "结算金币后进入商店，在买牌、扩容与删牌之间取舍。",
    "逐牌计分 3 / 7",
    "点击任意位置 · 加速当前卡牌",
    "本轮 7 张牌 · 得分一览",
    "确认结算 · 进入商店",
    "查看并领取",
    "查看魔法帽详情，再决定是否领取",
    "第 5 轮结算前累计达到 80 分",
    "当前 0 · 还差 80 · 剩余 5 轮 · 已有 2 条并行条约",
    "确认结算 · 选择一张牌",
    "苹果，吃牌，加2分",
    "ROUND SCOREBOARD · 本轮计分台",
    "第 1 轮进行中",
    "首尾赌约",
    "本轮第一张牌额外 -4 分。",
    "第一张牌必须吃、最后一张牌必须弃。",
  ];
  const failures = samples
    .map((source) => ({ source, output: translate(source) }))
    .filter(({ output }) => /[\u3400-\u9fff]/u.test(output));
  assert.deepEqual(failures, []);
  assert.equal(translate("罕见 · 硬吃 · 即时得分"), "Uncommon · Wrong edibility · Instant score");
  assert.equal(translate("ROUND SCOREBOARD · 本轮计分台"), "ROUND SCOREBOARD");
});
