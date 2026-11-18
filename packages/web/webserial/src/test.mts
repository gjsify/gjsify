import { run } from '@gjsify/unit';

import testSuiteRegister from './register.spec.js';
import testSuiteWebserial from './webserial.spec.js';

run({ testSuiteWebserial, testSuiteRegister });
