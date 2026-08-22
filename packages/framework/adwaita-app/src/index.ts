// @gjsify/adwaita-app — native Adwaita application shell for GJS/GTK apps.
// Composition-first: opt-in wiring for the boilerplate (lifecycle, devtools,
// CSS, nav split view, async view mounting, dialogs/toast/file) — it never
// hides Adw/GTK. Pure named exports; no /register, no globalThis writes.

export { AdwaitaApp, runAdwaitaApp, runApplication } from './application.js';
export type { AdwaitaAppOptions } from './application.js';

export { createNavShell } from './nav-shell.js';
export type { NavShell, NavShellOptions } from './nav-shell.js';

export { LoadToken, loadIntoStack } from './view-loader.js';
export type { LoadIntoStackOptions } from './view-loader.js';

export { LoadingStack } from './loading-stack.js';

export { confirmDialog, errorDialog } from './dialogs.js';
export type { ConfirmOptions } from './dialogs.js';

export { registerToastOverlay, showToast } from './toast.js';

export { pickFile, saveFile } from './file-dialog.js';
export type { FileFilterSpec, PickFileOptions } from './file-dialog.js';

export { initLocale } from './locale.js';
export type { InitLocaleOptions, Translator } from './locale.js';

export { SYSTEM_LOCALE_DIR, resolveLocaleDir } from './locale-dir.js';
export type { ResolveLocaleDirOptions } from './locale-dir.js';

export { readAppDevHooks } from './dev-hooks.js';
export type { AppDevHooks, ReadAppDevHooksOptions } from './dev-hooks.js';

export { findNavItem, resolveInitialNavIndex } from './nav-model.js';
export type { AboutInfo, ConfirmResponse, NavItem } from './types.js';
