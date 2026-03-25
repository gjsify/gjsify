// Import the polyfill to register globalThis.crypto on GJS (no-op on Node.js)
import './index.js';

import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';

run({ testSuite });
