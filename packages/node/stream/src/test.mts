import '@gjsify/node-globals';
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import consumersTestSuite from './consumers/index.spec.js';
import promisesTestSuite from './promises/index.spec.js';

run({testSuite, consumersTestSuite, promisesTestSuite});
