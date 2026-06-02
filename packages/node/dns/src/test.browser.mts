// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/dns — runs the browser-target conformance
// spec under `gjsify build --app browser` (Playwright/Firefox/SpiderMonkey).
//
// Unlike the canonical browser tests (which exercise real browser globals),
// `node:dns` has no browser-native equivalent, so the spec imports the partial
// browser stub directly (`./browser.js`) and locks in its honest behavior.

import { run } from '@gjsify/unit';

import testSuiteDnsBrowser from './index.browser.spec.js';

run({ testSuiteDnsBrowser });
