
import { run } from '@gjsify/unit';

import eventEmitterTestSuite from './event-emitter.spec.js';
import callableTestSuite from './callable.spec.js';

run({ eventEmitterTestSuite, callableTestSuite });
