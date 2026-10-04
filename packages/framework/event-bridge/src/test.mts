import { run } from '@gjsify/unit';

import eventBridgeSuite from './event-bridge.spec.js';
import keyMapSuite from './key-map.spec.js';
import touchPointersSuite from './touch-pointers.spec.js';

run({ eventBridgeSuite, keyMapSuite, touchPointersSuite });
