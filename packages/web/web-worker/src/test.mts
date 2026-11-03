import { run } from '@gjsify/unit';

import workerSuite from './worker.spec.js';
import comlinkSuite from './comlink.spec.js';
import registerSuite from './register.gjs.spec.js';

run({ workerSuite, comlinkSuite, registerSuite });
