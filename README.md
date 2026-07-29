# Card Eater · 15 轮试验版

这是从 CardEater Classic 分离出的无经济实验分支。游戏保留“吃 / 弃 / 后置”和永久牌组构筑，取消开局任务、持续合约、金币、限时奖励、商店与付费扩容。

## 当前规则

1. 每轮开始，从永久牌组随机抽取不超过餐盘上限的卡牌。
2. 玩家逐张选择吃、弃或后置，直到餐盘清空。
3. 轮末从 3 张随机卡牌中选择 1 张加入永久牌组，也可以跳过。
4. 在轮末选牌阶段，可以点击牌组并消耗 1 枚删牌 token 删除 1 张实体牌；牌组至少保留 1 张。
5. 成功完成第 5、10、15 轮时，餐盘上限永久 +1。
6. 第 5、10、15 轮的累计目标分别为 100、300、500 分；未达标立即结束，完成第 15 轮则通关。

卡池仍为 89 张、8 个类别。原经济牌已经改为直接得分、成长、蓄势，或“摧毁自身换取删牌 token”。卡牌效果的内部关键字仍供规则引擎使用，但不再自动堆叠在玩家可见说明前。

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
- `js/draft.js`：轮末三选一、跳过、加牌与 token 删牌。
- `js/plate.js`：随机餐盘、容量与后置。
- `js/engine.js`：卡牌效果与计分。
- `js/state.js`：精简后的轮次状态机。
- `js/main.js`：15 轮主流程。
- `js/ui.js`：游戏、教程、菜单、牌组与三选一 UI。
- `test/core.test.js`：新规则、卡池、token 与核心卡牌回归测试。
- `scripts/browser-smoke.mjs`：Microsoft Edge 的移动端与桌面端完整流程冒烟测试。

卡图资源与生成记录仍保留在 `assets/` 和 `docs/`；其中旧版 handoff 文档仅作为历史参考，不代表本试验版规则。
