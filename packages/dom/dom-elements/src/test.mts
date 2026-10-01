import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import fontFaceSuite from './font-face.spec.js';
import stubsSuite from './stubs.spec.js';
import htmlImageElementSuite from './html-image-element.spec.js';
import registerSuite from './register.spec.js';
import resizeObserverSuite from './resize-observer.spec.js';
import selectorsSuite from './selectors.spec.js';

run({
    testSuite,
    fontFaceSuite,
    stubsSuite,
    htmlImageElementSuite,
    registerSuite,
    resizeObserverSuite,
    selectorsSuite,
});
