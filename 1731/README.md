# PR #1731 — emulator evidence for `AdwBottomSheet:bottom-bar`

Not for merge. This branch exists only so a PR body can link images; `main` never carries it.
Captured on `Medium_Phone_API_36` (1080x2400 @420dpi, x86-64, `-gpu host`) from the NativeScript
storybook built from `feat/bottom-sheet-bottom-bar`.

| file | what it shows |
|---|---|
| `1.png` | `open=false` (bottom bar is the affordance) next to `open=true` (bar gone, sheet up) |
| `2.png` | light press feedback: `#ffffff` -> `#f2f2f2`, i.e. `rgba(0,0,0,.05)` |
| `3.png` | dark press feedback: `#2e2e32` -> `#3d3d40`, i.e. `rgba(255,255,255,.07)` |
| `4.png` | `can-open=false`: the bar stays visible and the press changes 0 px |

Each reading was taken as screenshot AND `uiautomator` tree dump; the numbers above are the
sampled pixel values, 8680 px per reading.
