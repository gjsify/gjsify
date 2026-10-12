import { run } from '@gjsify/unit';

import conformanceGjsTestSuite from './conformance.gjs.spec.js';
import testSuite from './index.spec.js';
import registerSuite from './register.spec.js';

run({ testSuite, registerSuite, conformanceGjsTestSuite });
