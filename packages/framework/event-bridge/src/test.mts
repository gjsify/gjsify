import { run } from '@gjsify/unit';

import eventBridgeSuite from './event-bridge.spec.js';
import touchPointersSuite from './touch-pointers.spec.js';

run({ eventBridgeSuite, touchPointersSuite });
