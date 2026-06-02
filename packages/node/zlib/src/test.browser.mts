// Browser test entry for @gjsify/zlib — runs the browser-target conformance
// spec (`index.browser.spec.ts`, which imports the `./browser.js` polyfill
// directly) under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey).

import { run } from '@gjsify/unit';

import testSuite from './index.browser.spec.js';

run({ testSuite });
