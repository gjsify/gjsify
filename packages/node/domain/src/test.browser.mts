// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/domain — runs the browser-target conformance
// spec (`index.browser.spec.ts`, which imports `./index.js` directly) under
// `gjsify build --app browser` (Playwright/Firefox/SpiderMonkey).

import { run } from '@gjsify/unit';

import testSuite from './index.browser.spec.js';

run({ testSuite });
