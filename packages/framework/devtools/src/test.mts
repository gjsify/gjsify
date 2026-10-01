import { run } from '@gjsify/unit';

import devtoolsIfaceSuite from './devtools-iface.spec.js';
import gvariantSuite from './gvariant.spec.js';
import pangoSuite from './pango.spec.js';
import peerTransportSuite from './peer-transport.spec.js';
import screenshotSuite from './screenshot.spec.js';
import shotSuite from './shot.spec.js';
import widgetTreeSuite from './widget-tree.spec.js';

run({
    devtoolsIfaceSuite,
    gvariantSuite,
    pangoSuite,
    peerTransportSuite,
    screenshotSuite,
    shotSuite,
    widgetTreeSuite,
});
