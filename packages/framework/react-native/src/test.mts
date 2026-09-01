import { run } from '@gjsify/unit';

import apisSuite from './apis/apis.spec.js';
import eventEmitterSuite from './event-emitter.spec.js';
import listsSuite from './lists/lists.spec.js';
import classesSuite from './primitives/classes.spec.js';
import defaultsSuite from './primitives/defaults.spec.js';
import primitivesSuite from './primitives/primitives.spec.js';
import widgetsSuite from './primitives/widgets.spec.js';
import routerWidgetsSuite from './router/router.spec.js';
import routesSuite from './router/routes.spec.js';
import solidSuite from './solid/solid.spec.js';
import stylesheetSuite from './stylesheet.spec.js';
import supportTableSuite from './support-table.spec.js';
import unsupportedSuite from './unsupported.spec.js';

run({
    supportTableSuite,
    unsupportedSuite,
    eventEmitterSuite,
    classesSuite,
    defaultsSuite,
    stylesheetSuite,
    primitivesSuite,
    apisSuite,
    widgetsSuite,
    listsSuite,
    solidSuite,
    routesSuite,
    routerWidgetsSuite,
});
