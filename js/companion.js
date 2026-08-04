import { GAME_MODES, MODE_LABELS } from "./config.js";
import { getMutation } from "./mutations.js";

export const FIRST_MEETING_PROLOGUE = Object.freeze([
  Object.freeze({
    speaker: "玩家",
    message: "……",
    detail: "耳边有很轻的呼噜声。",
    visual: "black",
    continue_label: "……",
  }),
  Object.freeze({
    speaker: "玩家",
    message: "这里是哪里……？",
    detail: "眼睛像被一层雾黏住了。面前只有一点白色的轮廓。",
    visual: "wake",
    continue_label: "睁开眼",
  }),
  Object.freeze({
    speaker: "玩家",
    message: "这是什么？一个……餐盘？",
    detail: "空的。可我为什么觉得，有什么东西正要被端上来？",
    visual: "plate",
    continue_label: "仔细看看",
  }),
]);

const MODE_INTROS = Object.freeze({
  [GAME_MODES.PREP]: Object.freeze([
    Object.freeze({ speaker: "咔嚓", message: "这次让我帮你藏一张牌。", detail: "备料位只有一个。我试过挤进去，尾巴还露在外面。" }),
    Object.freeze({ speaker: "咔嚓", message: "放进去的牌，下轮一定不会上桌。", detail: "让它在备料位安静待过一轮，就能永久移除；中途换牌，等待会重新计算。" }),
    Object.freeze({ speaker: "咔嚓", message: "备料也会给我们留下一点线索。", detail: "每次轮末选牌，至少会出现一张与备料牌同类别的牌。藏什么，下一步就会更像什么。" }),
  ]),
  [GAME_MODES.SHOP]: Object.freeze([
    Object.freeze({ speaker: "咔嚓", message: "咔嚓夜市开门啦！先说好，金币不能直接吃。", detail: "首要目标仍是拿够分数。金币只是把现在的选择，变成之后更高的分数。" }),
    Object.freeze({ speaker: "咔嚓", message: "每轮里，每张实体牌第一次被吃掉时会带来 1 金币。", detail: "经济卡和道具还能追加收入；同一张牌重洗后再吃，不会重复拿基础金币。" }),
    Object.freeze({ speaker: "咔嚓", message: "买牌、扩容、删牌——钱只能花一次。", detail: "商店会替代免费选牌与免费扩容。别把钱全花在看起来很好吃的东西上……这是经验之谈。" }),
  ]),
  [GAME_MODES.CONTRACT_SHOP]: Object.freeze([
    Object.freeze({ speaker: "咔嚓", message: "纸越多越适合磨爪……但你最好先看内容。", detail: "每轮可接一条新条约。没完成的条约不会堵住下一份，它们会并行保留。" }),
    Object.freeze({ speaker: "咔嚓", message: "完成条约能赚金币，清盘够快也有奖金。", detail: "12 秒内清盘 +1 金币，8 秒内清盘 +2 金币。结算清单会把每一笔来源写清楚。" }),
    Object.freeze({ speaker: "咔嚓", message: "别为了金币忘记分数目标。", detail: "一袋亮闪闪的硬币救不了没达标的餐盘。我试过了喵。" }),
  ]),
  [GAME_MODES.ENDLESS]: Object.freeze([
    Object.freeze({ speaker: "咔嚓", message: "我把第十五轮后面的终点线挠掉了。", detail: "这里没有普通终点。每过 5 轮，餐盘与删牌资源会继续成长。" }),
    Object.freeze({ speaker: "咔嚓", message: "道具可以重复获得，但餐盘不会无限变大。", detail: "牌太多时，强大和混乱只隔着一根猫毛。我们把目标定在 1,000,000 分。" }),
    Object.freeze({ speaker: "咔嚓", message: "真到了那里，主界面会记住你。", detail: "我也会。虽然我可能会装作只是碰巧路过。" }),
  ]),
});

export function getModeCompanionIntro(state) {
  if (state?.mode === GAME_MODES.MUTATION) {
    const mutation = getMutation(state.mutation_id);
    return [
      { speaker: "咔嚓", message: "先别开饭。空气的味道不对……", detail: `本局异变：${mutation?.name ?? "未知异变"}。` },
      { speaker: "咔嚓", message: mutation?.description ?? "规则正在发生变化。", detail: "随机开局在异变模式中不生效。对局中点右上角“异”，随时可以再看规则。" },
    ];
  }
  return MODE_INTROS[state?.mode] ?? [];
}

export function getFirstUnseenUnlockedMode(unlocks = {}, hasSeen = () => true) {
  const candidates = [
    [GAME_MODES.PREP, "prep"],
    [GAME_MODES.SHOP, "shop"],
    [GAME_MODES.CONTRACT_SHOP, "contract_shop"],
    [GAME_MODES.ENDLESS, "endless"],
    [GAME_MODES.MUTATION, "mutation"],
  ];
  return candidates.find(([mode, key]) => unlocks[key] && !hasSeen(mode))?.[0] ?? null;
}

export function getHomeCompanionLines({ unlocks = {}, progression = {}, tutorial_complete = false } = {}) {
  const lines = tutorial_complete
    ? [
      "我闻过了，今天的苹果没问题。大概。",
      "后置不是逃避，是把麻烦留给五秒后的你。",
      "一张牌越吃越难吃时，它可能是在劝你改用弃。",
      "先想流派再拿牌。见什么拿什么，最后只会得到一盘剩菜。",
      "我没有偷吃你的分数。真的没有。",
      "牌面是眼前的分，效果是以后每一轮的分。别只盯着大的数字。",
      "刷新不是为了找最稀有的牌，是为了找最适合这副牌的牌。",
    ]
    : [
      "……你看得见我？先开一局。还有，见到猫牌时别急着吃。",
      "餐盘后面是什么？我也想知道。你先进去，我在旁边看着。",
    ];
  if (unlocks.prep) lines.push("备料位只能放一张牌。那不是猫窝，我确认过了。", "备料牌待满一轮才能移除，临时反悔会让等待重新开始。现在反悔还来得及。");
  if (unlocks.shop) lines.push("金币不会直接变成分数。花出去的时机，才会。", "夜市里的每样东西都说自己很划算。包括我看中的鱼干。");
  if (unlocks.contract_shop) lines.push("没完成的条约会留下，但不会挡住新条约。纸多了记得别慌。", "八秒清盘听起来很短。猫的一次冲刺已经够了。");
  if (unlocks.mutation) lines.push("异变模式每次都有一种怪味。进去前深呼吸，进去后别信直觉。", "如果满桌都是橘猫，首先声明：那不是我干的。");
  if (unlocks.endless) lines.push("无尽不是没有终点。是一百万分那么远的终点。", "牌组越大，选择越不像选择。偶尔删牌，是给未来的自己留位置。");
  if (progression.god) lines.push("GOD 标记挺亮的。没有我的名字，不过我决定原谅它。", "一百万分以后还能做什么？当然是再高一点。喵。");
  return lines;
}

export const HOME_COMPANION_ANNOYED_LINES = Object.freeze([
  "嗯？我在。",
  "你已经点我很多次了喵。餐盘不会自己清空。",
  "再点一下，我就把你的香蕉藏进备料区。",
  "……",
  "爪子要收费了。",
  "我现在开始假装自己是一张卡背。",
]);

export function getModeUnlockNotice(mode) {
  return mode ? `我闻到一扇新门开了。${MODE_LABELS[mode]}已经可以进入——要不要去看看？` : "你回来啦。我一直在这里。";
}
