import { run } from '@gjsify/unit';

import devtoolsIfaceSuite from './devtools-iface.spec.js';
import gvariantSuite from './gvariant.spec.js';
import peerTransportSuite from './peer-transport.spec.js';
import widgetTreeSuite from './widget-tree.spec.js';

run({
    devtoolsIfaceSuite,
    gvariantSuite,
    peerTransportSuite,
    widgetTreeSuite,
});
