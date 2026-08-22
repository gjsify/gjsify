// Integration-test entry for @gjsify/integration-domparser.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// The differential oracle for @gjsify/domparser's HTML mode (ADR 0026 § 7):
// parse5 was measured running unmodified under gjsify/GJS, which is what makes a
// hand-written parser verifiable here instead of arguable. Pillars exercised:
// pure-JS string processing plus the Web-pillar DOMParser itself.

import { run } from '@gjsify/unit';

import entitiesSuite from './entities.spec.js';
import fuzzSuite from './fuzz.spec.js';
import selectorSuite from './selectors.spec.js';
import serializeSuite from './serialize.spec.js';
import treeSuite from './tree.spec.js';

run({ entitiesSuite, treeSuite, selectorSuite, serializeSuite, fuzzSuite });
