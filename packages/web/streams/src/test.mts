
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import byobSuite from './byob.spec.js';

await run({ testSuite, byobSuite });
