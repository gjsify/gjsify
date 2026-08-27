import { run } from '@gjsify/unit';

import apisSuite from './apis/apis.spec.js';
import eventEmitterSuite from './event-emitter.spec.js';
import classesSuite from './primitives/classes.spec.js';
import primitivesSuite from './primitives/primitives.spec.js';
import widgetsSuite from './primitives/widgets.spec.js';
import solidSuite from './solid/solid.spec.js';
import supportTableSuite from './support-table.spec.js';
import unsupportedSuite from './unsupported.spec.js';

run({
    supportTableSuite,
    unsupportedSuite,
    eventEmitterSuite,
    classesSuite,
    primitivesSuite,
    apisSuite,
    widgetsSuite,
    solidSuite,
});
