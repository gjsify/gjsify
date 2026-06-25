// Browser test entry. The core specs are pure TS — they import only the
// @gjsify/stories contract (no platform imports, no DOM/Node globals) — so they
// run unchanged in the browser, unlike the Web-API packages whose specs exercise
// browser globals directly. We therefore reuse the same spec files here.

import { run } from '@gjsify/unit';

import storyViewBaseTestSuite from './story-view-base.spec.js';
import registryTestSuite from './registry.spec.js';
import controlsTestSuite from './controls.spec.js';
import controllerTestSuite from './controller.spec.js';
import discoverTestSuite from './discover.spec.js';

run({
    storyViewBaseTestSuite,
    registryTestSuite,
    controlsTestSuite,
    controllerTestSuite,
    discoverTestSuite,
});
