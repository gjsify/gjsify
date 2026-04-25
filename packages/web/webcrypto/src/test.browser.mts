// Browser test entry for @gjsify/webcrypto.
// Does NOT import ./index.js (the GJS/GLib implementation) — the browser's
// native crypto.subtle is used directly. Spec tests run against the platform.
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';

run({ testSuite });
