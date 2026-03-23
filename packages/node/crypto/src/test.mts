
import { run } from '@gjsify/unit';

import testSuiteHash from './hash.spec.js';
import testSuiteHmac from './hmac.spec.js';
import testSuiteRandom from './random.spec.js';
import testSuitePbkdf2 from './pbkdf2.spec.js';
import testSuiteCipher from './cipher.spec.js';

run({ testSuiteHash, testSuiteHmac, testSuiteRandom, testSuitePbkdf2, testSuiteCipher });
