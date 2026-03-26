
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import clientTestSuite from './client.spec.js';
import extendedTestSuite from './extended.spec.js';
import streamingTestSuite from './streaming.spec.js';
import timeoutTestSuite from './timeout.spec.js';
import upgradeTestSuite from './upgrade.spec.js';

run({testSuite, clientTestSuite, extendedTestSuite, streamingTestSuite, timeoutTestSuite, upgradeTestSuite});
