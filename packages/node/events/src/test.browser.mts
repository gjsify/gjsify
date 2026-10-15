// SPDX-License-Identifier: MIT
// Browser test entry. Not `./test.mjs`: that registers the AbortController polyfill, which a
// browser has natively and whose bare specifier it cannot resolve.
import { run } from '@gjsify/unit';

import eventEmitterTestSuite from './event-emitter.spec.js';
import callableTestSuite from './callable.spec.js';

run({ eventEmitterTestSuite, callableTestSuite });
