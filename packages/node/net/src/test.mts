
import { run } from '@gjsify/unit';

import testSuiteNet from './index.spec.js';
import extendedTestSuite from './extended.spec.js';
import serverTestSuite from './server.spec.js';

run({ testSuiteNet, extendedTestSuite, serverTestSuite });
