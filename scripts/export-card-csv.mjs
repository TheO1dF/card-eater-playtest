import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getRarityPrice } from "../js/balance.js";
import { CARD_LIBRARY } from "../js/data.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const starterIds = new Set(["F002", "F003", "K001", "D001", "A001", "A008", "A004"]);
const roleLabels = Object.freeze({
  baseline: "基础", setup: "启动", payoff: "收割", sacrifice: "牺牲", engine: "成长引擎", economy: "经济",
});

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const headers = ["编号", "名称", "初始牌", "食用属性", "类别", "稀有度", "商店价", "吃分", "弃分", "角色", "联动标签", "关键字", "效果类型", "效果"];
const rows = Object.values(CARD_LIBRARY).map((card) => [
  card.id,
  card.name,
  starterIds.has(card.id) ? "是" : "否",
  card.edibility === "edible" ? "可食用" : "不可食用",
  card.type,
  card.rarity,
  starterIds.has(card.id) || card.rarity === "诅咒" ? "-" : getRarityPrice(card.rarity),
  card.eat_points,
  card.discard_points,
  roleLabels[card.role] ?? card.role,
  card.synergy_tags.join("|"),
  card.effect?.keywords?.join("|") ?? "-",
  card.effect?.kind ?? "-",
  card.effect?.description ?? "无额外效果",
]);

const output = [headers, ...rows].map((row) => row.map(csv).join(",")).join("\r\n");
await writeFile(resolve(root, "cardeater.csv"), `\ufeff${output}\r\n`, "utf8");
console.log(`Exported ${rows.length} cards to cardeater.csv`);
