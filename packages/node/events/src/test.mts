import { run } from '@gjsify/unit';
import 'abort-controller/register'; // registers AbortController/AbortSignal globals on GJS (no-op on Node)

import eventEmitterTestSuite from './event-emitter.spec.js';
import callableTestSuite from './callable.spec.js';

run({ eventEmitterTestSuite, callableTestSuite });
