import { run } from '@gjsify/unit';

import dbusSuite from './dbus.spec.js';
import mappingSuite from './mapping.spec.js';
import noAccountStoreSuite from './no-account-store.spec.js';
import mobileSuite from './system-accounts.mobile.spec.js';

run({ mappingSuite, noAccountStoreSuite, mobileSuite, dbusSuite });
