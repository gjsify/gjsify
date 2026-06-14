import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
import extendedTestSuite from './extended.spec.js';
import streamsTestSuite from './streams.spec.js';
run({ testSuite, extendedTestSuite, streamsTestSuite });
