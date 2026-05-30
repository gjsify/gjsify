import { run } from '@gjsify/unit';

import npmRegistryTestSuite from './index.spec.js';
import timeoutTestSuite from './timeout.spec.js';

run({ npmRegistryTestSuite, timeoutTestSuite });
