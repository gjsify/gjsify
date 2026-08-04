import { run } from '@gjsify/unit';

import errorMapSuite from './error-map.spec.js';
import transportChoiceSuite from './transport-choice.spec.js';
import cdpProfileSuite from './profiles/cdp.spec.js';

run({
    errorMapSuite,
    transportChoiceSuite,
    cdpProfileSuite,
});
