import { run } from '@gjsify/unit';

import mappingSuite from './mapping.spec.js';
import noAccountStoreSuite from './no-account-store.spec.js';

run({ mappingSuite, noAccountStoreSuite });
