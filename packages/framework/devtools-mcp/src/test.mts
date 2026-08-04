import { run } from '@gjsify/unit';

import dbusClientSuite from './dbus-client.spec.js';
import errorMapSuite from './error-map.spec.js';
import transportChoiceSuite from './transport-choice.spec.js';
import cdpProfileSuite from './profiles/cdp.spec.js';

run({
    dbusClientSuite,
    errorMapSuite,
    transportChoiceSuite,
    cdpProfileSuite,
});
