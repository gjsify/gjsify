import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import registerSuite from './register.spec.js';

run({ testSuite, registerSuite });
