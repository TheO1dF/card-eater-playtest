# 游戏名称：吃牌肉鸽 (Eat & Discard Roguelike)
# 项目类型：移动端/网页端适配的纯前端静态 Web 游戏 (HTML/CSS/Vanilla JS)

## 1. 游戏概述
这是一款结合了左右/上下滑动机制（类似 Reigns/Tinder）、卡牌构筑（DBG）和倍率结算（类似 Balatro）的肉鸽游戏。
核心交互：玩家对居中的卡牌向上滑动（弃牌）或向下滑动（吃牌）。
核心循环：15 轮游戏，每轮包含：三选一永久规则 ->（第 3/6/9/12 轮追加危险任务三选一）-> 吃弃牌消耗牌库/条件重洗 -> 累计结算 -> 付费刷新商店 -> 下一轮。第 5/10/15 轮检查累计分数门槛。

## 2. 核心数据结构 (Data Models)
### 2.1 卡牌 (Card)
- `id`: String (唯一标识)
- `name`: String (卡牌名称，如：苹果)
- `type`: String (类型：水果/星体/动物/特殊)
- `eat_points`: Number (吃牌基础分)
- `discard_points`: Number (弃牌基础分)
- `effect`: Object/Null (特殊效果，如：下一次吃牌翻倍)

### 2.2 规则/遗物 (Rule/Reward)
- `id`: String
- `name`: String
- `description`: String
- `trigger_type`: String (触发类型：如 sequence_eat 连续吃, time_limit 时间限制)
- `condition`: Object (触发条件：如 target_type: 水果, count: 3)
- `multiplier`: Number (倍率奖励)

### 2.3 玩家状态 (Player State)
- `current_round`: Number (1~15)
- `total_score`: Number (累计总分)
- `target_score`: Number (当前阶段目标分，第5/10/15轮检查)
- `gold`: Number (金币，每轮基础获得量=本轮吃牌数，其他经济效果另算)
- `deck`: Array<Card> (当前牌库)
- `active_rules`: Array<Rule> (本轮激活的规则倍率卡)
- `items`: Array<Item> (任务给予的唯一永久道具)
- `active_quest`: Quest/Null (当前任务与风险、条件、奖励)
- `reshuffle_charges`: Number (本轮可用重洗次数，小牌组限定)
- `remove_card_cost`: Number (商店删牌费用：0, 5, 10...)

## 3. 核心机制设计要求
1. **滑动交互**：引入轻量级手势库或原生 Touch 事件，支持上下滑动物理反馈。
2. **独立序列监听**：“吃”和“弃”的序列必须相互独立。在“吃苹果->弃汽车->吃西瓜”中，“吃”的序列仍视为连续吃水果。只有“吃”了非水果牌，水果连击才中断。
3. **限时机制**：游戏进入滑动阶段开始计时（Timer），直到牌库空停止，用于判定限时规则。
4. **状态机 (State Machine)**：游戏严格按照 `Init` -> `RuleDraft` -> `[QuestDraft]` -> `Playing` -> `Scoring` -> `Shop` -> `NextRound` / `GameOver` 流转。
5. **流派资源差异**：吃牌基础分少但获得基础金币；弃牌无基础金币但分数更高，可由条件经济牌补足经济。大牌组牌面总量高但稀释核心；10 张以内的小牌组可通过道具/卡牌获得重洗。
6. **商店约束**：买走商品后不免费补货；刷新从 3 金币开始，每次 +2。商人、黄金门票等强经济牌延后出现、唯一且每轮限触发。
7. **数值安全**：所有分数、倍率、金币、次数和音高进入表现层前必须是有限值；单轮最多 250 次行动，分数饱和上限 `9e15`。

## 4. 目录结构规划
/
├── index.html       # 游戏主入口及 UI 骨架
├── css/
│   └── style.css    # 响应式样式与动画 (Mobile-first)
├── js/
│   ├── main.js      # 游戏初始化与主控逻辑
│   ├── data.js      # 基础牌库与规则库的数据字典
│   ├── state.js     # 玩家状态与存档管理
│   ├── gesture.js   # 滑动交互与物理效果逻辑
│   ├── engine.js    # 计分算法与序列监听逻辑
│   ├── quests.js    # 危险任务选择、风险与奖励
│   ├── items.js     # 永久道具效果
│   ├── numbers.js   # 有限值和饱和运算
│   └── ui.js        # DOM 渲染与弹窗控制
└── assets/          # 图标与音效 (可选)
