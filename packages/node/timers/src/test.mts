
import { run } from '@gjsify/unit';

import testSuiteTimers from './index.spec.js';
import testSuitePromises from './promises.spec.js';

run({ testSuiteTimers, testSuitePromises });
