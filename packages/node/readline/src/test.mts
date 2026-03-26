import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
import promisesTestSuite from './promises.spec.js';
run({ testSuite, promisesTestSuite });
