// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/sys — re-exports the standard test.mts suite
// so the existing assertions also run under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey).
//
// The impl is platform-neutral pure-TS (the deprecated util alias over plain
// JS), so the same spec exercises both runtimes. The browser-target alias
// layer (`ALIASES_NODE_FOR_BROWSER`) routes `node:sys` → `@gjsify/sys` so the
// spec's imports resolve transparently.

export * from './test.mjs';
import './test.mjs';
