// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/buffer — re-exports the standard test.mts
// suite so the existing assertions also run under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey).
//
// The impl is platform-neutral pure-TS (Buffer over Uint8Array + Blob/atob/btoa),
// so the same spec exercises both runtimes. The browser-target alias layer
// (`ALIASES_NODE_FOR_BROWSER` in PR #388) routes `node:buffer` → `@gjsify/buffer`
// so the spec's `import { Buffer } from 'node:buffer'` resolves transparently.

export * from './test.mjs';
import './test.mjs';
