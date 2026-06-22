import { run } from '@gjsify/unit';

import registrySuite from './registry.spec.js';
import routingSuite from './routing.spec.js';

run({
    registrySuite,
    routingSuite,
});
