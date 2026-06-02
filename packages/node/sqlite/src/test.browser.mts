// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/sqlite — runs the browser-target conformance
// spec under `gjsify build --app browser` (Playwright/Firefox/SpiderMonkey).
//
// `node:sqlite` has no browser-native equivalent, so the spec imports the
// partial browser stub directly (`./browser.js`) and locks in its honest
// behavior (import without throwing; database ops throw ERR_NOT_SUPPORTED).

import { run } from '@gjsify/unit';

import testSuiteSqliteBrowser from './index.browser.spec.js';

run({ testSuiteSqliteBrowser });
