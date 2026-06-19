import { run } from '@gjsify/unit';

import discoverSuite from './discover.spec.js';
import registrySuite from './registry.spec.js';

run({
    discoverSuite,
    registrySuite,
});
