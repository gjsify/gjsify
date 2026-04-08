import '@gjsify/node-globals';
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import callableTestSuite from './callable.spec.js';
import consumersTestSuite from './consumers/index.spec.js';
import promisesTestSuite from './promises/index.spec.js';
import edgeCasesTestSuite from './edge-cases.spec.js';
import transformTestSuite from './transform.spec.js';
import pipeTestSuite from './pipe.spec.js';
import inheritanceTestSuite from './inheritance.spec.js';

run({
	testSuite,
	callableTestSuite,
	consumersTestSuite,
	promisesTestSuite,
	edgeCasesTestSuite,
	transformTestSuite,
	pipeTestSuite,
	inheritanceTestSuite,
});
