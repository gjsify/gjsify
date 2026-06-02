// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/buffer — runs the browser-target conformance
// spec (`index.browser.spec.ts`, which imports the `./index.js` Buffer impl
// directly) under `gjsify build --app browser` (Playwright/Firefox/SpiderMonkey).
//
// Replaces the previous hollow `export * from './test.mjs'` re-export: that
// re-export tree-shook the browser bundle to 0 bytes (no live binding survived
// the dead-code pass) and pulled in `@gjsify/node-globals` register side-effects.

import { run } from '@gjsify/unit';

import testSuite from './index.browser.spec.js';

run({ testSuite });
