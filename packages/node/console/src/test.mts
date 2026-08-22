import { run } from '@gjsify/unit';

import gerrorSuite from './gerror.gjs.spec.js';
import testSuite from './index.spec.js';

run({ testSuite, gerrorSuite });
