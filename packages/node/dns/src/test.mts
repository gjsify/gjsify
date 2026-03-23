
import { run } from '@gjsify/unit';

import testSuiteDns from './index.spec.js';
import testSuiteDnsPromises from './promises.spec.js';

run({ testSuiteDns, testSuiteDnsPromises });
