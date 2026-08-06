# Card Eater · 正式版

> 中文 / English：游戏会在首次启动时按浏览器语言选择中文或英文，也可以随时在主界面右下角或游戏菜单中切换。语言设置会保存，切换语言不会重开对局或改变规则。

## English quick start

Card Eater is a 15-round deck-building roguelike about sorting a randomly served plate. Drag the top card down to **Eat**, up to **Discard**, or sideways to **Postpone** it. Build synergies through the round-end card draft, collect items every three rounds, and meet the cumulative score milestones on Rounds 5, 10, and 15.

The first run includes Kacha's guided tutorial. Further runs unlock Prep, Shop, Contract Shop, Endless, and Mutation modes without permanent stat upgrades. The complete interface, tutorial, 89-card library, 39-item library, contracts, mutations, shops, and scoring presentation are available in English.

标准模式继续保持“吃 / 弃 / 后置 + 轮末三选一”的轻量流程；完成对局后会逐步解锁备料、商店、条约商店、无尽与异变模式。解锁只增加玩法选择，不提供局外数值成长。

## 当前规则

1. 每轮开始，从永久牌组随机抽取不超过餐盘上限的卡牌。
2. 玩家逐张选择吃、弃或后置，直到餐盘清空。
3. 轮末从 3 张随机卡牌中选择 1 张加入永久牌组，也可以跳过。
4. 每轮选牌时可免费刷新一次；之后刷新消耗刷新标记。
5. 每 3 轮额外进行一次可跳过的道具三选一：候选会结合当前体系、跨体系连接与规则改写，并按普通、罕见、稀有、传奇四档稀有度抽取。
6. 永久道具获得后持续生效；一次性道具会立即提供定向选牌、刷新标记或下一轮的类别爆发。
7. 开局获得 1 枚删牌标记；轮末选牌阶段可点击牌组并消耗标记删除 1 张实体牌，牌组至少保留 1 张。
8. 成功完成第 5、10、15 轮时，餐盘上限永久 +1。
9. 教学难度第 5、10、15 轮的累计目标分别为 60、180、500 分；难度限制会逐层累计，最高提高至 100、200、600 分。未达标立即结束，完成第 15 轮则通关。

初始牌组使用苹果；所有触发水果连击的卡牌都会额外获得当前连击数的分数。梨在连击达到 3 或以上时，标准卡池提供刷新标记，商店卡池则为随后商店提供额外免费刷新。对局会在操作、结算、刷新、选牌和商店操作后自动保存，可随时回到主界面继续。

本地开发时访问 `http://127.0.0.1:8080/?dev=1` 可开启开发者模式：不会修改真实解锁进度，但会临时解锁全部模式、随机开局与 GOD 标记，方便测试商店和后期内容。该参数在 Pages 等非本地域名无效。

## 解锁与模式

- 游玩 1 局：解锁全模式通用的“随机开局”，随机替换两张初始牌。
- 游玩 2 局：解锁备料模式。唯一备料位替代删牌标记；备料牌不进入下一轮，并保证三选一出现同类别候选，存放满一轮后可永久移除。
- 任意模式通关 1 次：解锁商店、无尽与异变模式。异变模式会在标准流程上随机追加一条改变开局、选牌或计分方式的规则；商店模式恢复经典经济牌、经济道具和买牌 / 扩容 / 删牌三角取舍，普通商店仅卡牌价格统一减 1 金币。
- 商店模式通关 1 次：解锁条约商店。每轮接取一条新条约；未完成条约跨轮保留并与后续条约并行判定。12 秒内清盘 +1 金币，8 秒内清盘 +2 金币。
- 无尽模式：道具可重复获得；每 5 轮赠送扩容和删牌标记，餐盘最多 16 张；累计 1,000,000 分通关并获得主界面 `GOD` 标记。

`v1.0.0` 是正式版的全新起点。旧版本玩家首次进入正式版时会自动清除旧进度、对局、统计与教程状态，从咔嚓序章重新开始；正式版内的后续刷新不会重复清档。

卡池仍为 89 张、8 个类别。原经济牌已经改为直接得分、成长、蓄势，或“摧毁自身换取删牌标记”。卡牌效果的内部关键字仍供规则引擎使用，但不再自动堆叠在玩家可见说明前。

## 本地运行

ES Modules 需要通过 HTTP 打开：

```powershell
npm start
```

访问 `http://localhost:8080`。

常用命令：

```powershell
npm test
npm run check
npm run simulate
npm run build
```

`npm run check` 会依次执行语法检查、核心规则测试和静态构建。`npm run build` 输出到 `dist/`。

## 工程结构

- `js/data.js`：89 张卡牌和 7 张初始牌。
- `js/draft.js`：轮末三选一、免费刷新、删牌标记与备料位。
- `js/items.js`：32 件稀有度道具、定向一次性选择、永久规则改写与跨轮效果。
- `js/platform.js`：本机记录、设置与自动存档。
- `js/plate.js`：随机餐盘、容量与后置。
- `js/engine.js`：卡牌效果与计分。
- `js/shop.js` / `js/rules.js`：商店经济与逐轮条约。
- `js/state.js`：多模式轮次状态机。
- `js/main.js`：普通、备料、商店、条约、无尽与异变流程。
- `js/ui.js`：游戏、教程、菜单、牌组与三选一 UI。
- `test/core.test.js`：新规则、卡池、资源标记与核心卡牌回归测试。
- `scripts/browser-smoke.mjs`：Microsoft Edge 的移动端与桌面端完整流程冒烟测试。

卡图资源与生成记录仍保留在 `assets/` 和 `docs/`；其中旧版 handoff 文档仅作为历史参考，不代表本试验版规则。
