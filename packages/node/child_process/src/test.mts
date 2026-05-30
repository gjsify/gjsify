import { run } from '@gjsify/unit';

import testSuiteChildProcess from './index.spec.js';
import testSuiteChildProcessParity from './parity.spec.js';

run({ testSuiteChildProcess, testSuiteChildProcessParity });
