import { run } from '@gjsify/unit';

import eventEmitterSuite from './event-emitter.spec.js';
import supportTableSuite from './support-table.spec.js';
import unsupportedSuite from './unsupported.spec.js';

run({
    supportTableSuite,
    unsupportedSuite,
    eventEmitterSuite,
});
