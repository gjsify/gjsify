// Browser test entry for @gjsify/os — runs the reduced browser-target spec
// (`index.browser.spec.ts`) under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey).
//
// Unlike the standard `test.mts`, this does NOT re-export `index.spec.ts`: that
// suite asserts host-OS-specific values (platform === 'linux', cpus().length >
// 0, real memory readings, …) that cannot hold in a browser. The browser entry
// (`./browser.ts`) returns constant 'browser'/0/[]/'localhost' values, so we
// exercise it with a dedicated spec that only asserts what is true there.

import { run } from '@gjsify/unit';
import testSuite from './index.browser.spec.js';
run({ testSuite });
