// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/xeddsa — re-exports the standard test.mts
// suite so the same vectors also run under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey). The implementation is pure TypeScript on
// @noble/curves, so one spec covers every runtime.

export * from './test.mjs';
import './test.mjs';
