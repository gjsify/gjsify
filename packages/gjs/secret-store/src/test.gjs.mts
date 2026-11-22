// GJS entry: the pure suites plus the driver against a real Secret Service (skipped, with its
// reason, where the host has none).
import { run } from '@gjsify/unit';

import libsecretDriverSuite from './libsecret-driver.spec.js';
import libsecretSuite from './libsecret.gjs.spec.js';
import secretStoreSuite from './secret-store.spec.js';

run({ secretStoreSuite, libsecretDriverSuite, libsecretSuite });
