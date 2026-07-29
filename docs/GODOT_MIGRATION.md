# Godot 迁移设计

当前 Demo 的核心约束是：游戏状态、卡牌、规则与结算结果都可被 `JSON.stringify`，核心计分不得访问 DOM、Web Audio、LocalStorage 或浏览器时间。H5 只是一层表现与平台适配，Godot 可以复刻同一数据契约与测试向量。

## 模块映射

| H5 模块 | Godot 建议实现 | 职责 |
| --- | --- | --- |
| `config.js`, `balance.js`, `plate.js` | `GameConfig.gd` / `.tres` | 轮数、门槛、价格、商店权重与永久餐盘容量 |
| `data.js`, `keywords.js`, `rules.js` | JSON / Godot Resource | 卡牌、统一关键字与永久规则内容库 |
| `quests.js`, `items.js` | JSON / Godot Resource | 危险任务、永久道具与奖励 |
| `numbers.js` | `SafeNumbers.gd` | 有限值、饱和运算、紧凑显示 |
| `state.js` | `GameState.gd`（Resource） | 可存档状态与阶段流转 |
| `engine.js` | `RoundEngine.gd`（RefCounted） | 行为记录、序列、效果、结算 |
| `platform.js` | Autoload `Platform.gd` | 时间、随机种子、UUID、震动、存档 |
| `gesture.js` | `CardDragController.gd` | 触摸/鼠标输入和甩动判定 |
| `ui.js`, `main.js` | Control 场景 + `GameController.gd` | 展示和流程编排 |

## 稳定的数据契约

字段统一使用 `snake_case`，阶段枚举保持 `Init / RuleDraft / QuestDraft / Playing / Scoring / Shop / NextRound / GameOver`：

```json
{
  "schema_version": 8,
  "phase": "Playing",
  "current_round": 6,
  "total_score": 220,
  "gold": 9,
  "plate_capacity": 10,
  "plate_upgrade_count": 0,
  "deck": [],
  "active_rules": [],
  "rule_history": [],
  "items": [],
  "active_quest": null,
  "quest_history": [],
  "permanent_multipliers": [],
  "round": {
    "draw_pile": [],
    "action_budget": 10,
    "reserve_count": 0,
    "spent_pile": [],
    "actions": [],
    "eat_sequence": [],
    "discard_sequence": [],
    "buffs": [],
    "final_multipliers": [],
    "pending_gold_bonus": 0,
    "shop_discount": 0,
    "shop_reroll_count": 0,
    "shop_free_rerolls": 0,
    "reshuffle_charges": 0,
    "reshuffle_count": 0,
    "destroyed_count": 0,
    "generated_count": 0,
    "grown_count": 0,
    "effect_trigger_counts": {},
    "consume_next_uuid": null,
    "quest_flat_modifier": 0,
    "quest_action_modifiers": {},
    "quest_first_action_modifier": 0,
    "quest_last_action_modifier": 0,
    "elapsed_ms": 0
  }
}
```

`active_rules` 是本局永久规则集合，每轮只追加、不替换；`items`、`active_quest` 与两种 history 用于存档、回放和分析。卡牌稳定字段包括 `id/name/rarity/type/edibility/eat_points/discard_points/role/synergy_tags/effect`。每张卡保存 `art_file/runtime_atlas/runtime_x/runtime_y/sprite_sheet/sprite_x/sprite_y`；H5 使用“7 张开局独立小图 + 单张中后期紧凑图集”，任务和道具使用 4×4 `meta-atlas.webp`。Godot 可直接使用独立纹理，或按图集字段建立 `AtlasTexture`。

`plate.js` 是 v0.11 的纯函数边界。每轮必须先洗完整牌组，再按永久 `plate_capacity` 截取餐盘，并记录 `action_budget / reserve_count`。牌组尺寸不再修改倍率、基础金币、卡价或删牌收入；基础金币等于实际吃牌数。商店扩容每次永久 `+1`，基础价格依次为 2 / 3 / 5 / 8 / 12 / 17……；刷新费用为 1 / 2 / 3……，删牌费用为 0 / 3 / 6……。Godot 侧应逐项复刻现有测试向量。

`reshuffle.js` 是重洗的唯一规则边界：只把本轮已处理且仍属于永久牌组的实体牌洗回；每次消耗 1 点可叠加次数并增加 `reshuffle_count`。空牌堆且仍可重洗时不得自动结算，必须让玩家选择重洗或结束本轮。

运行时卡图不是直接按 AI 图集的固定格子裸切：`scripts/optimize-sprites.mjs` 会先移除跨格孤立像素，再根据 alpha 主体包围盒缩放到统一安全区并光学居中。Godot 侧若直接使用 `assets/cards/*.webp`，可获得与 H5 一致的图标尺寸和锚点；重新生成美术资源后应先运行该导出流程。

`effect.kind` 使用数据驱动分派，目前 109 张有效果卡覆盖 60 种类型，包含位置/相邻、历史追溯、牌组规模、蓄势、生成、摧毁、成长、储存、经济与预判等家族。完整类型以 `CARD_LIBRARY` 的运行时数据为准；`keywords.js` 负责把这些底层类型归并成玩家可理解的统一关键字。移植时按 `kind` 建立 Effect Resolver，不要为具体卡牌 ID 写分支；`effect.keywords`、成长进度、储存分和生成来源也必须保留。

`actions` 保存全局顺序；`eat_sequence` 与 `discard_sequence` 只接收对应行为。新 Buff 在当前牌结算后加入，所以只影响未来牌；永久成长写回 `deck` 中 UUID 相同的牌，并同步当前轮副本。重洗只回收 `spent_pile` 中仍存在于永久牌组的 UUID，被摧毁的牌不能返回。所有加法、乘法和计数都应复刻 `numbers.js` 的有限值与饱和规则，分数上限为 `9e15`。

## Godot 输入手感复刻

使用单个 `Control` 卡牌节点处理 `_gui_input`，兼容 `InputEventScreenTouch`、`InputEventScreenDrag` 和鼠标：

1. 按下时记录位置与时间，并调用 `accept_event()`。
2. 拖动时只更新视觉 Transform，规则核心不接收未提交动作。
3. 保存指数平滑后的纵向速度，松手时计算 `projected_y = drag_y + velocity_y * 120ms`。
4. 阈值使用卡牌高度的 22%，限制在 72–116 逻辑像素；短甩动至少 24 像素且速度达到 0.62 px/ms。
5. 达标后先播放约 170ms 离场 Tween，再发出 `card_committed(action, uuid)`；未达标播放带轻微过冲的回弹。

视觉、音频、震动应订阅 `card_committed`、`effect_triggered` 与结算事件，不能反向修改核心分数。连击音高由表现层根据连续相同行动数计算，可直接替换为 Godot `AudioStreamPlayer.pitch_scale`。

## 推荐场景树

```text
Game (Control)
├── HUD (Control)
├── Playfield (Control)
│   ├── DiscardZone
│   ├── CardStack
│   └── EatZone
├── Controls
└── OverlayLayer (CanvasLayer)
    ├── RuleDraft
    ├── QuestDraft
    ├── QuestStatus
    ├── DeckStatus
    ├── RoundSummary
    ├── Shop
    └── GameOver
```

移动端建议使用竖屏基准 720×1280、`canvas_items` 拉伸与安全区容器；桌面端在同一场景限制最大桌面宽度。像素素材关闭 Filter 与 Mipmaps，UI 位移尽量落在整数像素。

## 迁移顺序

1. 将 `config/balance/data/rules` 导出为 JSON 或 Resource，并校验卡牌、规则 ID 唯一。
2. 按 `test/core.test.js` 的输入输出移植 `GameState` 与 `RoundEngine`。
3. 复刻状态迁移表、永久规则追加、任务轮、重洗和全局去重抽取。
4. 接入卡牌场景、Tween、触摸手势和像素图集。
5. 最后接商店、音频、震动和平台存档；保持 `RoundEngine` 无平台依赖。
