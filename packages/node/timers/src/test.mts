import '@gjsify/node-globals';
import { run } from '@gjsify/unit';

import testSuiteTimers from './index.spec.js';
import testSuitePromises from './promises.spec.js';
import extendedTestSuite from './extended.spec.js';

run({ testSuiteTimers, testSuitePromises, extendedTestSuite });
