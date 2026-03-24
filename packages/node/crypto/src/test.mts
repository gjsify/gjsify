
import { run } from '@gjsify/unit';

import testSuiteHash from './hash.spec.js';
import testSuiteHmac from './hmac.spec.js';
import testSuiteRandom from './random.spec.js';
import testSuitePbkdf2 from './pbkdf2.spec.js';
import testSuiteCipher from './cipher.spec.js';
import testSuiteScrypt from './scrypt.spec.js';
import testSuiteDh from './dh.spec.js';
import testSuiteEcdh from './ecdh.spec.js';
import testSuiteGcm from './gcm.spec.js';
import testSuiteSign from './sign.spec.js';
import testSuiteKeyObject from './key-object.spec.js';
import testSuiteX509 from './x509.spec.js';

run({ testSuiteHash, testSuiteHmac, testSuiteRandom, testSuitePbkdf2, testSuiteCipher, testSuiteScrypt, testSuiteDh, testSuiteEcdh, testSuiteGcm, testSuiteSign, testSuiteKeyObject, testSuiteX509 });
