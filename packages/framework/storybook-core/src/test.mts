import { run } from '@gjsify/unit';

import storyViewBaseTestSuite from './story-view-base.spec.js';
import registryTestSuite from './registry.spec.js';
import controlsTestSuite from './controls.spec.js';
import controllerTestSuite from './controller.spec.js';
import categoryOrderTestSuite from './category-order.spec.js';
import discoverTestSuite from './discover.spec.js';
import settingsTestSuite from './settings.spec.js';

run({
    storyViewBaseTestSuite,
    registryTestSuite,
    controlsTestSuite,
    controllerTestSuite,
    categoryOrderTestSuite,
    discoverTestSuite,
    settingsTestSuite,
});
