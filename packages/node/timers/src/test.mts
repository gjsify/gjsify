import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/microtask';
import 'abort-controller/register'; // register AbortController/AbortSignal globals on GJS (no-op on Node)
import { run } from '@gjsify/unit';

import testSuiteTimers from './index.spec.js';
import testSuitePromises from './promises.spec.js';
import extendedTestSuite from './extended.spec.js';

run({ testSuiteTimers, testSuitePromises, extendedTestSuite });
