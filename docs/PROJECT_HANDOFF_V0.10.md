# CardEater v0.10 项目交接

## 当前事实

- 版本：`0.10.0`；存档结构：`schema_version: 7`。
- 静态原生 H5，入口为 `index.html`，构建输出 `dist/`，目标平台为 Cloudflare Pages。
- 卡池 110 张、60 种底层效果、74 条永久规则、12 种危险任务、12 件任务道具与 14 件商店道具。
- 复杂文本继续统一使用【摧毁】【相邻】【成长】【生成】【重洗】等关键字；虚空牌是唯一无效果、无类别牌。
- 牌组与任务查看器的顶栏遮挡问题已经由用户实测确认解决。

## v0.10 的唯一大牌组约束：永久餐盘

不要恢复 v0.9 的五层压力系统。当前设计刻意只保留一个玩家可见、可投资的机制：

1. `plate_capacity` 初始为 10，是永久属性。
2. 每轮先洗完整牌组，再随机截取 `min(deck.length, plate_capacity)` 张进入餐盘。
3. 其余牌记录在 `reserve_count`，本轮不出现；下轮重新洗牌后再次参与随机。
4. 商店始终提供餐盘扩容入口，每次付费永久 `+1`。
5. 扩容基础费用为 `3 + n(n+3)/2`：3、5、8、12、17、23、30……。
6. 餐盘硬安全上限与牌组上限一致，均为 160；正常 15 轮经济不可能接近该值。

这使大牌组玩家在“继续买牌扩大候选池”和“扩容让更多牌实际登场”之间分配金币。小牌组的优势只来自更高的核心抽中率、位置可控性和重洗，不再拥有系统赠送倍率。

实现集中在 `js/plate.js`：

- `getPlateDrawBudget(deckSize, plateCapacity)`
- `takeRoundDrawPile(shuffledDeck, plateCapacity)`
- `getPlateUpgradeBaseCost(upgradeCount)`
- `getPlateUpgradeCost(upgradeCount, discount)`
- `getPlateSummary(deckSize, plateCapacity)`

## 已明确删除的 v0.9 机制

- 构筑密度 `×1.15 / ×1.07`
- 基础金币前 6 次上限
- 大牌组携带费
- 牌组扩张商店附加价
- 稀有度删牌返还
- 超载删牌奖励
- “回收标签”道具

代码中不应再出现 `deck-pressure.js`、`shop_size_surcharge`、`overload_salvage`、`getGoldEconomy` 或 `deck_size_at_start`。旧 v0.9 文档是历史记录，不代表当前规则。

## 当前经济

- 每次实际吃牌提供 1 基础金币；不存在饱腹或携带费。
- 卡牌效果金币独立结算。
- 卡牌价：普通 3、罕见 6、稀有 10、传奇 16。
- 刷新：每间商店按 1、2、3、4……递增；免费刷新也推进次数。
- 扩容：3、5、8、12、17、23……，每次永久 +1。
- 删牌：0、5、10……递增，不返还任何金币。
- `IT106` 已改为“餐盘量尺”：购买价 7，永久让扩容费用 -1，最低为 1。

经济意图是前期可以买普通牌、低成本刷新并完成第一次扩容；中后期稀有牌、传奇牌和递增扩容共同消耗资金。不要通过牌组尺寸再叠加隐形税。

## 执行顺序

### 回合开始

`main.prepareRound()`：重置回合 → 洗完整牌组 → `takeRoundDrawPile(shuffledDeck, state.plate_capacity)` → 应用道具与任务 → 进入出牌。

### 回合结束

`engine.finalizeRound()` 只计算卡牌、规则、道具与任务倍率。随后 `engine.getGoldReward()` 返回 `eat_sequence.length`，主流程加入基础金币并显示在结算栏。

### 商店

- `shop.getPlateUpgradeStatus()` 返回基础价、量尺优惠、实际价与失败原因。
- `shop.buyPlateUpgrade()` 扣金币，更新 `plate_capacity / plate_upgrade_count`。
- 卡牌只按稀有度基础价与现有商店折扣定价，牌组大小不参与。
- `removeCard()` 只扣当前删牌费用，不计算任何 salvage。

## 关键状态字段

```json
{
  "schema_version": 7,
  "plate_capacity": 10,
  "plate_upgrade_count": 0,
  "round": {
    "draw_pile": [],
    "action_budget": 10,
    "reserve_count": 0
  }
}
```

## 验证

```powershell
npm test
npm run check
node --check scripts/browser-smoke.mjs
```

自动化覆盖：默认 10 张餐盘、30/100 张牌组仍只登场容量内牌、扩容价格曲线、量尺优惠、扩容购买与上限、无构筑密度、基础金币等于实际吃牌、无牌组卡价、刷新 1/2/3、删牌永不返还、第 10 轮大牌组购买及 15 轮长局。

## 后续试玩重点

- 第一次扩容通常发生在第几轮，玩家是否能理解它是永久投资。
- 玩家在 10 / 12 / 15 张牌组时，扩容与买核心牌的选择比例。
- 3/5/8/12/17 曲线是否让中期扩容过慢；若需调整，只改 `plate_upgrade_base_cost` 或公式，不先增加新税。
- 1/2/3 刷新是否造成过度寻找传奇牌；必要时调整晚期稀有度权重或同店刷新曲线。
- 删牌没有金币收益后，0/5/10 的费用是否仍过高。

本文件是下一轮开发的首要入口；完整卡牌设计见 `docs/PROJECT_HANDOFF_V0.8.md`，历史 v0.9 压力方案仅供说明为何被撤回。
