import { run } from '@gjsify/unit';

import libsecretDriverSuite from './libsecret-driver.spec.js';
import secretStoreSuite from './secret-store.spec.js';

run({ secretStoreSuite, libsecretDriverSuite });
