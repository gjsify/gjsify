// Browser test entry. @gjsify/stories is a pure-TS contract — its specs import
// only the contract (no platform / DOM / Node globals) — so they run unchanged
// in the browser. Reuse the same spec files (mirrors @gjsify/storybook-core).

import { run } from '@gjsify/unit';

import argsSuite from './args.spec.js';

run({
    argsSuite,
});
