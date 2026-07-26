// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/http — runs the browser-target conformance
// spec (`index.browser.spec.ts`, which imports the `./browser.js` polyfill
// directly) under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey).
//
// The browser-target alias layer (`ALIASES_NODE_FOR_BROWSER`, PR #388) routes
// `node:http` → that entry, and `tests/browser/` discovers the resulting
// `dist/test.browser.mjs` bundle.

import { run } from '@gjsify/unit';

import testSuite from './index.browser.spec.js';

run({ testSuite });
