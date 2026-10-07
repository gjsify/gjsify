// GJS entry: the pure suites plus the driver against the fake accounts service.
import { run } from '@gjsify/unit';

import goaSuite from './goa.gjs.spec.js';
import mappingSuite from './mapping.spec.js';
import noAccountStoreSuite from './no-account-store.spec.js';

run({ mappingSuite, noAccountStoreSuite, goaSuite });
