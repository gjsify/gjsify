import { run } from '@gjsify/unit';

import gvariantSuite from './gvariant.spec.js';
import peerTransportSuite from './peer-transport.spec.js';
import widgetTreeSuite from './widget-tree.spec.js';

run({
    gvariantSuite,
    peerTransportSuite,
    widgetTreeSuite,
});
