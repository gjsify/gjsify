
import { run } from '@gjsify/unit';

import testSuiteNet from './index.spec.js';
import extendedTestSuite from './extended.spec.js';
import serverTestSuite from './server.spec.js';
import timeoutTestSuite from './timeout.spec.js';
import errorTestSuite from './error.spec.js';
import throughputTestSuite from './throughput.spec.js';

run({ testSuiteNet, extendedTestSuite, serverTestSuite, timeoutTestSuite, errorTestSuite, throughputTestSuite });
