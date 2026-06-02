// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/module — runs the browser-target conformance
// spec under `gjsify build --app browser` (Playwright/Firefox/SpiderMonkey).
//
// `node:module` has no browser-native equivalent, so the spec imports the
// partial browser stub directly (`./browser.js`) and locks in its honest
// behavior (real builtinModules/isBuiltin; createRequire throws structured
// ERR_REQUIRE_ESM / ERR_MODULE_NOT_FOUND).

import { run } from '@gjsify/unit';

import testSuiteModuleBrowser from './index.browser.spec.js';

run({ testSuiteModuleBrowser });
