# PR #1755 — the selected story row keeps its colour

- `1.png` — light mode, three panels: **web before** (red border, white on white),
  **web after** (green border, neutral pill), **GTK reference** (grey border).
- `2.png` — dark mode, before and after: unchanged, so the fix is light-mode only.

Captured 2026-09-22 from `showcases/gtk/adwaita-storybook`, story `Boxed Lists/Combo Row`.
GTK via `tools/shoot-stories.js` over the devtools D-Bus surface; web via Playwright/Firefox
at 1200x800 against the built `dist/`.
