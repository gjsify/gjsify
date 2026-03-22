
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import clientTestSuite from './client.spec.js';

run({testSuite, clientTestSuite});
