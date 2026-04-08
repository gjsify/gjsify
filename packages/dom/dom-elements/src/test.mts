
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import stubsSuite from './stubs.spec.js';

run({ testSuite, stubsSuite });
