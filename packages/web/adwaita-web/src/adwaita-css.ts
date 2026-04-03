// Adwaita CSS subset for browser targets.
// Colors from refs/libadwaita/src/stylesheet/_colors.scss (canonical).
// Component styles adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) GNOME contributors (libadwaita), LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Extracted as CSS-in-JS for @gjsify/adwaita-web.

import { editPasteSymbolic, goDownSymbolic, sidebarShowSymbolic } from '@gjsify/adwaita-icons/actions';
import { toDataUri } from '@gjsify/adwaita-icons/utils';

const goDownDataUri = toDataUri(goDownSymbolic);
const editPasteDataUri = toDataUri(editPasteSymbolic);
const sidebarShowDataUri = toDataUri(sidebarShowSymbolic);

export const adwaitaCSS = `
/* ═══════════════════════════════════════════════════════════════
   Adwaita CSS Custom Properties — Light Theme (default)
   ═══════════════════════════════════════════════════════════════ */
:root {
  /* Icons (Adwaita symbolic, encoded as data-URIs) */
  --icon-edit-paste: ${editPasteDataUri};
  --icon-go-down: ${goDownDataUri};
  --icon-sidebar-show: ${sidebarShowDataUri};

  /* Window */
  --window-bg-color: #fafafb;
  --window-fg-color: rgba(0, 0, 6, 0.8);

  /* Views */
  --view-bg-color: #ffffff;
  --view-fg-color: rgba(0, 0, 6, 0.8);

  /* Header bar */
  --headerbar-bg-color: #ffffff;
  --headerbar-fg-color: rgba(0, 0, 6, 0.8);
  --headerbar-shade-color: rgba(0, 0, 6, 0.12);

  /* Sidebar */
  --sidebar-bg-color: #ebebed;

  /* Cards / boxed lists */
  --card-bg-color: #ffffff;
  --card-fg-color: rgba(0, 0, 6, 0.8);
  --card-shade-color: rgba(0, 0, 6, 0.07);

  /* Accent */
  --accent-bg-color: #3584e4;
  --accent-fg-color: #ffffff;
  --accent-color: #1c71d8;

  /* Switch */
  --switch-off-bg: rgba(0, 0, 0, 0.2);
  --switch-knob-bg: #ffffff;

  /* Layout */
  --window-radius: 15px;
  --card-radius: 12px;
  --button-radius: 9px;

  /* Spacing */
  --spacing-xs: 6px;
  --spacing-s: 9px;
  --spacing-m: 12px;
  --spacing-l: 18px;
  --spacing-xl: 24px;

  /* Typography — GNOME default: Adwaita Sans 11 */
  --font-family: 'Adwaita Sans', 'Cantarell', 'Inter', 'Segoe UI', sans-serif;
  --font-size-base: 11pt;
  --font-size-small: 9pt;
  --font-size-heading: 12pt;
  --dim-opacity: 0.55;
}

/* ═══════════════════════════════════════════════════════════════
   Dark Theme — auto via prefers-color-scheme
   ═══════════════════════════════════════════════════════════════ */
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) {
    --window-bg-color: #222226;
    --window-fg-color: #ffffff;
    --view-bg-color: #1d1d20;
    --view-fg-color: #ffffff;
    --headerbar-bg-color: #2e2e32;
    --headerbar-fg-color: #ffffff;
    --headerbar-shade-color: rgba(0, 0, 6, 0.36);
    --sidebar-bg-color: #2e2e32;
    --card-bg-color: rgba(255, 255, 255, 0.08);
    --card-fg-color: #ffffff;
    --card-shade-color: rgba(0, 0, 6, 0.36);
    --accent-color: #78aeed;
    --switch-off-bg: rgba(255, 255, 255, 0.2);
    --switch-knob-bg: #deddda;
  }
}

/* Dark theme manual override */
:root.theme-dark {
  --window-bg-color: #222226;
  --window-fg-color: #ffffff;
  --view-bg-color: #1d1d20;
  --view-fg-color: #ffffff;
  --headerbar-bg-color: #2e2e32;
  --headerbar-fg-color: #ffffff;
  --headerbar-shade-color: rgba(0, 0, 6, 0.36);
  --sidebar-bg-color: #2e2e32;
  --card-bg-color: rgba(255, 255, 255, 0.08);
  --card-fg-color: #ffffff;
  --card-shade-color: rgba(0, 0, 6, 0.36);
  --accent-color: #78aeed;
  --switch-off-bg: rgba(255, 255, 255, 0.2);
  --switch-knob-bg: #deddda;
}

/* ═══════════════════════════════════════════════════════════════
   Component Styles
   ═══════════════════════════════════════════════════════════════ */

/* --- adw-window --- */
adw-window {
  display: flex;
  flex-direction: column;
  background-color: var(--window-bg-color);
  color: var(--window-fg-color);
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  border-radius: var(--window-radius);
  box-shadow:
    0 0 14px 5px rgb(0 0 0 / 15%),
    0 0 5px 2px rgb(0 0 0 / 10%),
    0 0 0 1px rgb(0 0 0 / 5%);
  overflow: hidden;
  outline: 1px solid rgb(255 255 255 / 7%);
  outline-offset: -1px;
}

/* --- adw-header-bar --- */
adw-header-bar {
  display: flex;
  align-items: center;
  min-height: 47px;
  padding: 0 6px;
  background-color: var(--headerbar-bg-color);
  color: var(--headerbar-fg-color);
  box-shadow: inset 0 -1px var(--headerbar-shade-color);
  flex-shrink: 0;
}

adw-header-bar .adw-header-bar-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

adw-header-bar .adw-header-bar-title {
  font-weight: bold;
  font-size: var(--font-size-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

adw-header-bar .adw-header-bar-start {
  display: flex;
  align-items: center;
  padding: 0 6px;
  gap: 4px;
}

adw-header-bar .adw-header-bar-end {
  display: flex;
  align-items: center;
  padding: 0 6px;
  gap: 4px;
}

adw-header-bar .adw-header-btn {
  position: relative;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: var(--button-radius);
  background: transparent;
  color: var(--headerbar-fg-color);
  cursor: pointer;
  padding: 0;
  margin: 0;
  flex-shrink: 0;
}

adw-header-bar .adw-header-btn:hover {
  background: rgba(128, 128, 128, 0.12);
}

adw-header-bar .adw-header-btn:active {
  background: rgba(128, 128, 128, 0.22);
}

/* --- adw-preferences-group --- */
adw-preferences-group {
  display: block;
}

adw-preferences-group .adw-preferences-group-header {
  padding: var(--spacing-xs) 2px;
}

adw-preferences-group .adw-preferences-group-title {
  font-size: var(--font-size-small);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: var(--dim-opacity);
  margin: 0;
  color: var(--window-fg-color);
}

adw-preferences-group .adw-preferences-group-listbox {
  background-color: var(--card-bg-color);
  color: var(--card-fg-color);
  border-radius: var(--card-radius);
  box-shadow:
    0 0 0 1px rgb(0 0 6 / 3%),
    0 1px 3px 1px rgb(0 0 6 / 7%),
    0 2px 6px 2px rgb(0 0 6 / 3%);
  overflow: hidden;
}

/* --- Row base (shared by switch-row, combo-row) --- */
adw-switch-row,
adw-combo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  padding: var(--spacing-s) var(--spacing-m);
  gap: var(--spacing-m);
  border-bottom: 1px solid var(--card-shade-color);
}

adw-switch-row:last-child,
adw-combo-row:last-child {
  border-bottom: none;
}

/* --- adw-switch-row --- */
adw-switch-row .adw-row-title {
  flex: 1;
  font-size: var(--font-size-base);
  color: var(--card-fg-color);
}

adw-switch-row .adw-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

adw-switch-row .adw-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

adw-switch-row .adw-switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--switch-off-bg);
  border-radius: 12px;
  transition: background-color 0.15s ease-out;
}

adw-switch-row .adw-switch-slider::before {
  content: "";
  position: absolute;
  height: 20px;
  width: 20px;
  left: 2px;
  bottom: 2px;
  background-color: var(--switch-knob-bg);
  border-radius: 50%;
  transition: transform 0.15s ease-out;
  box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
}

adw-switch-row .adw-switch input:checked + .adw-switch-slider {
  background-color: var(--accent-bg-color);
}

adw-switch-row .adw-switch input:checked + .adw-switch-slider::before {
  transform: translateX(20px);
}

adw-switch-row .adw-switch input:focus-visible + .adw-switch-slider {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

/* --- adw-combo-row --- */
adw-combo-row {
  position: relative;
  cursor: pointer;
}

adw-combo-row .adw-row-title {
  font-size: var(--font-size-base);
  color: var(--card-fg-color);
  pointer-events: none;
}

adw-combo-row select {
  appearance: none;
  -webkit-appearance: none;
  background-color: transparent;
  border: none;
  padding: 6px 24px 6px 8px;
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  color: var(--card-fg-color);
  cursor: pointer;
  text-align: right;
  background-image: ${goDownDataUri};
  background-repeat: no-repeat;
  background-position: right 4px center;
  background-size: 12px 12px;
  /* Stretch select over the entire row to make it clickable anywhere */
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

adw-combo-row .adw-row-value {
  font-size: var(--font-size-base);
  color: var(--card-fg-color);
  opacity: var(--dim-opacity);
  display: flex;
  align-items: center;
  gap: 4px;
}

adw-combo-row .adw-row-value::after {
  content: "";
  display: inline-block;
  width: 12px;
  height: 12px;
  background-image: ${goDownDataUri};
  background-repeat: no-repeat;
  background-size: contain;
}

adw-combo-row select:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: -1px;
}

adw-combo-row select option {
  background-color: var(--window-bg-color);
  color: var(--window-fg-color);
}

/* --- Utility: separator --- */
.adw-separator-vertical {
  width: 1px;
  align-self: stretch;
  background-color: var(--card-shade-color);
  flex-shrink: 0;
}

/* --- adw-spin-row --- */
adw-spin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  padding: var(--spacing-s) var(--spacing-m);
  gap: var(--spacing-m);
  border-bottom: 1px solid var(--card-shade-color);
}

adw-spin-row:last-child {
  border-bottom: none;
}

adw-spin-row .adw-row-title {
  flex: 1;
  font-size: var(--font-size-base);
  color: var(--card-fg-color);
}

.adw-spin-control {
  display: flex;
  align-items: center;
  gap: 2px;
}

.adw-spin-control button {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--button-radius);
  background: transparent;
  color: var(--card-fg-color);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.adw-spin-control button:hover {
  background: rgba(128, 128, 128, 0.15);
}

.adw-spin-control input {
  width: 56px;
  text-align: center;
  border: none;
  border-radius: var(--button-radius);
  background: rgba(128, 128, 128, 0.1);
  color: var(--card-fg-color);
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  padding: 4px 2px;
}

.adw-spin-control input:focus {
  outline: 2px solid var(--accent-color);
  outline-offset: -1px;
}

/* --- adw-toast-overlay ---
   Reference: refs/adwaita-web/adwaita-web/scss/_toast_overlay.scss */
adw-toast-overlay {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 9px;
  align-items: center;
  pointer-events: none;
}

/* --- adw-toast ---
   Reference: refs/adwaita-web/adwaita-web/scss/_toast.scss */
.adw-toast {
  background-color: #3d3846;
  color: #ffffff;
  padding: 9px 12px;
  border-radius: var(--card-radius);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  gap: 9px;
  width: max-content;
  max-width: 400px;
  min-height: 36px;
  pointer-events: auto;
  font-family: var(--font-family);
  font-size: var(--font-size-base);

  opacity: 0;
  transform: translateY(100%) scale(0.9);
  transition: opacity 0.2s cubic-bezier(0, 0, 0.2, 1),
              transform 0.2s cubic-bezier(0, 0, 0.2, 1);
  will-change: transform, opacity;
}

.adw-toast.visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.adw-toast.hiding {
  opacity: 0;
  transform: translateY(100%) scale(0.9);
  transition-duration: 0.15s;
  transition-timing-function: cubic-bezier(0.4, 0, 1, 1);
}

.adw-toast .adw-toast-title {
  font-weight: normal;
  line-height: 1.3;
}

/* ═══════════════════════════════════════════════════════════════
   adw-overlay-split-view
   Reference: Adw.OverlaySplitView from libadwaita
   ═══════════════════════════════════════════════════════════════ */
adw-overlay-split-view {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

adw-overlay-split-view .adw-osv-sidebar {
  background-color: var(--sidebar-bg-color);
  overflow-y: auto;
  flex-shrink: 0;
  transition: transform 0.2s ease, opacity 0.2s ease, margin 0.2s ease;
  z-index: 10;
  align-self: stretch;
}

adw-overlay-split-view .adw-osv-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-self: stretch;
}

/* Docked mode (not collapsed) — sidebar beside content */
adw-overlay-split-view:not(.collapsed) .adw-osv-sidebar {
  position: relative;
}

/* Docked hide: slide left and collapse space via negative margin.
   Sidebar keeps its intrinsic width so internal elements don't reflow. */
adw-overlay-split-view:not(.collapsed):not(.show-sidebar) .adw-osv-sidebar {
  transform: translateX(-100%);
  opacity: 0;
  pointer-events: none;
}

/* Overlay mode (collapsed) — sidebar on top of content */
adw-overlay-split-view.collapsed .adw-osv-sidebar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  transform: translateX(-100%);
  opacity: 0;
  pointer-events: none;
}

adw-overlay-split-view.collapsed.sidebar-end .adw-osv-sidebar {
  left: auto;
  right: 0;
  transform: translateX(100%);
}

adw-overlay-split-view.collapsed.show-sidebar .adw-osv-sidebar {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

/* Backdrop — visible only in overlay mode when sidebar is open */
adw-overlay-split-view .adw-osv-backdrop {
  display: none;
}

adw-overlay-split-view.collapsed.show-sidebar .adw-osv-backdrop {
  display: block;
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 9;
}

/* Sidebar toggle button — sidebar-show-symbolic icon via CSS mask */
.adw-sidebar-toggle-icon::after {
  content: '';
  position: absolute;
  inset: 0;
  background-color: currentColor;
  -webkit-mask-image: var(--icon-sidebar-show);
  mask-image: var(--icon-sidebar-show);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 16px 16px;
  mask-size: 16px 16px;
  -webkit-mask-position: center;
  mask-position: center;
  pointer-events: none;
}
`;
