// Browser test entry for @gjsify/process — runs the reduced browser-target spec
// (`index.browser.spec.ts`) under `gjsify build --app browser`
// (Playwright/Firefox/SpiderMonkey).
//
// Unlike the standard `test.mts`, this does NOT re-export `index.spec.ts` /
// `extended.spec.ts`: those suites assert host-process values (pid > 0, version
// starting with 'v', process.env.PATH, real memoryUsage, working chdir, a live
// EventEmitter, …) that cannot hold in a browser. The browser entry
// (`./browser.ts`) is the minimal defunctzombie-style shim, so we exercise it
// with a dedicated spec that only asserts what is true there.

import { run } from '@gjsify/unit';
import testSuite from './index.browser.spec.js';
run({ testSuite });
