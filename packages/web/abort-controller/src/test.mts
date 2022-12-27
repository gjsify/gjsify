import { run } from '@gjsify/unit';

import abortControllerTestSuite from './abort-controller.spec.js';
import abortSignalTestSuite from './abort-signal.spec.js';

run({abortControllerTestSuite, abortSignalTestSuite});
