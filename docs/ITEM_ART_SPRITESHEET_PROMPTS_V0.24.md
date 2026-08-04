# CardEater v0.24 道具多精灵图提示词

## 使用方式

每次生成时，向 ChatGPT 同时上传以下四张新卡图作为风格参考：

- `sheet-01-fruit-fastfood.png`
- `sheet-02-fastfood-dessert.png`
- `sheet-03-dessert-drink.png`
- `sheet-04-animal-celestial.png`

然后发送“共同风格提示词”与对应图集的“单图清单”。不要上传旧的 `meta-atlas-source.png` 或 `shop-items-atlas-v013-source.png` 作为视觉参考。

## 共同风格提示词

```text
Use the four attached CardEater v0.17 card-art sheets as the strict and primary visual reference. Match their actual rendering language, not the older CardEater item icons.

OUTPUT AND GRID
- Produce one exact 2048 × 2048 square sprite sheet.
- Use an exact 4-column × 4-row layout: 16 equal cells, each exactly 512 × 512 pixels.
- Cell boundaries are x = 0/512/1024/1536/2048 and y = 0/512/1024/1536/2048.
- Read the manifest from left to right, then top to bottom.
- Put one isolated item in each requested cell, centered independently.
- Keep every visible pixel, outline and shadow inside its own cell with generous padding.
- Each main object should occupy approximately 62–74% of its cell, matching the apparent scale of the attached card sprites.
- Do not draw grid lines, borders, labels, names, letters, numbers, rarity frames, card frames, UI panels or complete scenes.

EXACT CARDEATER V0.17 PIXEL STYLE
- Bright, friendly, highly readable food-game pixel art.
- Chunky deliberate pixels resembling artwork created at a small native resolution and enlarged with nearest-neighbor scaling.
- Crisp hard pixel edges with absolutely no antialiasing, vector-smooth curves, painterly brushwork, blur or photorealistic texture.
- A thick near-black outer contour, with a few dark-brown inner contour pixels where appropriate.
- Compact clusters of midtone shading instead of smooth gradients.
- Strong small white or pale-yellow specular highlights on the upper-left surfaces.
- Light comes consistently from the upper left.
- A short, simple, cool gray hard-edged cast shadow falls to the lower right, exactly like the attached apple, hamburger, drink and animal sprites.
- Mostly front-facing or gentle three-quarter view. Avoid dramatic perspective.
- Bright natural colors: warm cream paper, tomato red, orange, fruit green, golden yellow, clear blue, simple brass and neutral gray.
- Keep silhouettes bold and immediately recognizable at 64-pixel UI size.
- One dominant literal object per icon. At most one small integrated secondary cue may suggest the effect.
- The physical item named in the manifest is more important than explaining every gameplay rule. Do not turn the icon into a collage of abstract symbols.
- Match the attached sheets' outline thickness, pixel density, highlight size, shadow length, saturation and overall simplicity across all sixteen cells.

BACKGROUND
- Prefer genuine alpha transparency.
- If true transparency cannot be produced, use only the same clean pale white/light-gray checkerboard seen in the attached source sheets, with no colored tint, glow, vignette or texture. Do not fake transparency with a dark checkerboard.

QUALITY CONTROL
- Verify the requested row-major order before rendering.
- Verify that every item is visibly different from every other item.
- Verify that no object or shadow crosses a 512-pixel cell boundary.
- Verify that there is no accidental pseudo-writing.
- Do not reuse an object from another cell with only a color change.
- Do not add decorative coins, crowns, stars, books or cards unless the manifest explicitly requests them.
```

## 图集 1：`item-sprites-sheet-01.png`

在共同提示词之后追加：

```text
Create the following sixteen sprites in exact row-major order.

ROW 1
1. Fruit Stall Voucher — a cream paper produce voucher with a small red-and-white striped market awning built into its top edge and one large, simple apple-and-pear emblem. The ticket remains the dominant object.
2. Hot Meal Pickup Voucher — a warm orange pickup ticket clipped to a small steaming closed takeaway box. Make the ticket and hot meal connection unmistakable.
3. Dessert Gift Voucher — a cream gift voucher tied once with a pink ribbon, with a single strawberry cake-slice seal.
4. Drink Redemption Voucher — a pale-blue drink voucher wrapped around a simple glass bottle with an orange straw.

ROW 2
5. Astronomy Observation Voucher — a midnight-blue observation ticket with a small brass telescope and crescent-moon seal. Keep it bright and readable, not dark or ornate.
6. VIP Introduction Letter — an ivory introduction envelope with a burgundy wax seal and one small gold guest ribbon.
7. Animal Adoption Certificate — a kraft-paper adoption certificate with one green ribbon, a paw-print seal and a small collar tag.
8. Universal Pickup Form — a practical cream claim form on a small clipboard, stamped with one simple multicolor parcel symbol; no writing.

ROW 3
9. Golden-Faced Balance — a literal polished golden tabletop balance scale. One pan carries a green fork token, the other an orange discard-arrow token, with the higher-value side visibly raised by a magical golden glow. No numbers.
10. Reverse-Taste Counter — a compact countertop mechanical counter with one green food light and one red food light arranged in reverse order, plus a rising row of three illuminated tally windows. No digits.
11. Rebellious Dining Fork — one recognizable silver dining fork bent defiantly backward, wearing a tiny red bandana. Keep it playful and inanimate.
12. Three-Round Paper Cutter — a small tabletop paper guillotine cutting a stack of exactly three thick meal tickets. The cutter is the dominant silhouette.

ROW 4
13. Shatterproof Lamination — one meal card visibly sealed inside thick glossy transparent laminate while a tiny impact crack stops at the film surface.
14. Double-Spin Coin — exactly two interlocked brass refresh coins spinning in opposite directions, each with a simple circular arrow embossing and no letters.
15. Half-Ripe Fruit Platter — a ceramic fruit plate containing an apple, banana and pear that are each half green and half ripe, with one tiny combo sparkle.
16. Leader Bell — a bright restaurant service bell fitted with a small animal collar and paw-shaped clapper, leaning slightly forward as if leading a procession.
```

| 行 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 1 | A1 果摊兑换券 | A2 热餐取餐券 | A3 甜点礼盒券 | A4 饮品兑换券 |
| 2 | A5 星象观测券 | A6 贵宾介绍信 | A7 动物领养证 | A8 万用提货单 |
| 3 | B1 金面天平 | B2 逆味计数器 | B3 叛逆餐叉 | C1 三轮裁纸机 |
| 4 | C2 防碎覆膜 | C3 双旋硬币 | C4 半熟果盘 | C5 领队铃铛 |

## 图集 2：`item-sprites-sheet-02.png`

在共同提示词之后追加：

```text
Create the following sixteen sprites in exact row-major order.

ROW 1
1. Eight-Flavor Palette — an octagonal ceramic tasting palette with exactly eight large colored sauce wells around one central tasting spoon. Keep every well readable and do not add more than eight.
2. Two-Color Metronome — a chunky restaurant metronome split cleanly into green and orange halves, with one swinging brass arm.
3. Fruit Peel Recycling Bag — a sturdy green kitchen recycling sack with clearly visible apple peel, banana peel and pear peel coming from its open top.
4. Double-Layer Straw — exactly two thick parallel intertwined drinking straws, turquoise and orange, sharing one simple glass of juice.

ROW 2
5. Magic Hat — a classic deep-purple magician's top hat with simple yellow stars and one cute white rabbit emerging from it. This item must remain unmistakably a magic hat.
6. Pear-Scent Ripening Bag — a breathable kraft produce bag containing a visible banana bunch, with one large green pear emblem and a small pear-shaped aroma curl.
7. Rapid Serving Lamp — a compact stainless restaurant heat lamp over one empty plate, with a small stopwatch integrated into the lamp housing.
8. Red-Ink Compound Ledger — a burgundy accounting ledger with a red ink bottle and one green sprouting arrow curling upward from a corrected red mark. No writing or numbers.

ROW 3
9. Two-Way Serving Belt — a compact tabletop restaurant conveyor with exactly two opposing lanes and two bold directional arrows, carrying the same small plate back for a second pass.
10. Biogas Stove — a battered compact kitchen burner connected to a small organic-waste canister, producing one bright green-blue flame.
11. Copy Tray — two identical metal serving trays, one behind the other, holding two identical simple meal-card silhouettes; the rear copy is slightly pale but still solid pixel art.
12. Refrigerated Turnover Crate — a frosted blue insulated produce crate holding one pear, with ice crystals and a simple circular return arrow attached to the crate.

ROW 4
13. First-and-Last Weights — two clearly different brass calibration weights: the first is hollow and nearly weightless, while the last is a double stacked weight. No numbers.
14. Special-Event Pass — one large perforated cream event ticket with a bold chef-star seal surrounded by a simple ring of category colors. Avoid tiny detailed symbols.
15. Three-Action Time Clock — a chunky restaurant punch clock with exactly three large colored action buttons: orange upward arrow, green downward arrow, purple sideways arrow. No words.
16. Reverse-Bake Dessert Spatula — a copper dessert spatula flipping one cake slice backward along a curved orange arrow, sending a small warm sparkle back into the cake.
```

| 行 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 1 | C6 八味调色盘 | C7 双色节拍器 | C8 果皮回收袋 | C9 双层吸管 |
| 2 | C10 魔法帽 | C11 梨香催熟袋 | C12 极速出餐灯 | C13 红字复利簿 |
| 3 | C14 双程传菜带 | C15 沼气炉 | C16 复写托盘 | C17 冷藏周转箱 |
| 4 | C18 首尾砝码 | C19 专场通行证 | C20 三式打卡器 | C30 反烤甜点铲 |

## 图集 3：`item-sprites-sheet-03.png`

在共同提示词之后追加：

```text
Create seven economy-item sprites in cells 1 through 7 in exact row-major order. Cells 8 through 16 must contain only untouched transparent space or the clean pale checkerboard background, with no objects or shadows.

ROW 1
1. Coin-Operated Straw — one thick orange drinking straw attached directly to a small brass coin slot, with one gold coin entering the slot and one juice droplet at the straw tip.
2. Guild Badge — one simple enamel restaurant-workers badge combining a serving tray silhouette with a small coin wreath. No letters.
3. Discount Printer — a compact cream receipt printer producing one short coupon with a bold downward price arrow and a refresh symbol. No writing or numbers.
4. Night Market Membership Card — a dark-purple membership card with a bright crescent moon, a striped food-stall awning and one gold downward-price arrow. No letters.

ROW 2
5. Plate Measuring Rule — a folding brass ruler bent around the rim of one white ceramic plate, clearly measuring its diameter.
6. Combo Money Flag — one small triumphant fruit-stall pennant planted in a compact pile of coins, with three linked fruit silhouettes on the flag and no number.
7. Hardship Coin Purse — a worn patched brown coin purse squeezing through one red negative-score plate while a bright refresh coin pops out on the other side.
8. EMPTY CELL — no object, no shadow, no decoration.

ROW 3
9. EMPTY CELL — no object, no shadow, no decoration.
10. EMPTY CELL — no object, no shadow, no decoration.
11. EMPTY CELL — no object, no shadow, no decoration.
12. EMPTY CELL — no object, no shadow, no decoration.

ROW 4
13. EMPTY CELL — no object, no shadow, no decoration.
14. EMPTY CELL — no object, no shadow, no decoration.
15. EMPTY CELL — no object, no shadow, no decoration.
16. EMPTY CELL — no object, no shadow, no decoration.
```

| 行 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| 1 | E101 投币吸管 | E102 工会徽章 | E103 优惠打印机 | E104 夜市会员卡 |
| 2 | E105 餐盘量尺 | E106 连击钱旗 | E107 苦差零钱袋 | 留空 |
| 3 | 留空 | 留空 | 留空 | 留空 |
| 4 | 留空 | 留空 | 留空 | 留空 |

## 常见偏差的修正句

若画面过于精细、偏旧图风格：

```text
Regenerate in the brighter and chunkier visual language of the attached v0.17 card sheets. Reduce ornamental detail, enlarge the main silhouette, use a thicker near-black outline, simpler pixel clusters, brighter natural color and the same short lower-right gray shadow as the attached apple and rabbit.
```

若模型把道具画成复杂效果拼贴：

```text
The literal named physical object must dominate each cell. Remove extra floating icons and decorative props. Keep only one small secondary gameplay cue integrated into the object.
```

若出现平滑边缘：

```text
Remove all antialiasing and smooth vector curves. Render hard square pixels with nearest-neighbor enlargement, crisp stepped outlines and no subpixel transparency on the object contour.
```

若串格或尺寸不一致：

```text
Treat every 512 × 512 cell as a sealed independent canvas. No pixel or shadow may cross a cell boundary. Normalize all main objects to the same apparent 62–74% cell occupancy.
```
