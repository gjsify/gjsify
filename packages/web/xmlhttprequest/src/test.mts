// GJS test entry for @gjsify/xmlhttprequest.
//
// GJS-ONLY on purpose — there is no `--app node` leg. `src/index.ts` imports the
// default export and `resolveRootRelativeUrl` from `@gjsify/fetch`, and on node
// that specifier routes to `fetch/globals.mjs`, which exports neither; the build
// stops at MISSING_EXPORT. That is what `gjsify.runtimes.node: "none"` declares.
// The browser leg is a separate entry (`src/test.browser.mts`) and measures the
// runtime's native XHR, not this package.
//
// `@gjsify/node-globals/register/url` comes first because `installObjectURLSupport()`
// patches the `URL` global in place and reads the bare identifier — with no `URL`
// on `globalThis` the patch is a ReferenceError, not a no-op.
import '@gjsify/node-globals/register/url';
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import registerSuite from './register.spec.js';

run({ testSuite, registerSuite });
