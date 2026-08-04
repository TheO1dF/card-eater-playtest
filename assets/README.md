# Asset layout

```text
assets/
├─ cards/
│  ├─ v017/          # 89 active, normalized 256×256 transparent PNG sprites
│  └─ legacy-v016/   # preserved pre-v0.17 fallbacks; no longer used at runtime
├─ source/
│  ├─ card-art-v017/
│  │  └─ sheets/     # untouched ChatGPT card source sheets with stable names
│  └─ item-art-v024/
│     └─ sheets/     # untouched ChatGPT item source sheets
├─ item-sprites/
│  └─ v024/          # 39 active, normalized 256×256 transparent item sprites
└─ archive/
   └─ card-art-v016/
      └─ cards/      # complete pre-v0.17 card-art directory (133 files)
```

Do not edit the archived or source files. All current runtime card definitions
point to `cards/v017/`; `cards/legacy-v016/` is retained only for recovery.

Run `scripts/slice-card-art-sheets.ps1` after replacing or adding a source sheet.
The script reads beyond each mathematical cell, selects components owned by the
cell centre, removes the baked checkerboard and pale fringe, preserves the
source artwork's own outline, centres each sprite, and writes 256×256 PNGs.

The full row/column cutting manifest is in
`docs/CARD_ART_SPRITESHEET_PROMPTS_V0.17.md`.

Run `scripts/slice-item-art-sheets.ps1` after replacing one of the three item
source sheets. Its row/column manifest follows
`docs/ITEM_ART_SPRITESHEET_PROMPTS_V0.24.md`.
