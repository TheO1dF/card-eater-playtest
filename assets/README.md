# Asset layout

```text
assets/
├─ cards/
│  ├─ v017/          # 89 active, normalized 256×256 transparent PNG sprites
│  └─ legacy-v016/   # preserved pre-v0.17 fallbacks; no longer used at runtime
├─ source/
│  └─ card-art-v017/
│     └─ sheets/     # untouched ChatGPT source sheets with stable names
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
