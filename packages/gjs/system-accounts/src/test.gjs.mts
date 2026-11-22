// GJS entry: the pure suites plus the driver against the fake accounts service.
import { run } from '@gjsify/unit';

import dbusSuite from './dbus.spec.js';
import dbusGioSuite from './dbus-gio.gjs.spec.js';
import goaSuite from './goa.gjs.spec.js';
import mappingSuite from './mapping.spec.js';
import noAccountStoreSuite from './no-account-store.spec.js';
import mobileSuite from './system-accounts.mobile.spec.js';

run({ mappingSuite, noAccountStoreSuite, mobileSuite, dbusSuite, dbusGioSuite, goaSuite });
