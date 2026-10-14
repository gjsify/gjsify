// Browser test entry. @gjsify/distribution is pure TS with no platform globals, so the same
// spec runs unchanged in the browser.

import { run } from '@gjsify/unit';

import indexSuite from './index.spec.js';

run({
    indexSuite,
});
