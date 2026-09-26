import { run } from '@gjsify/unit';

import testSuiteTls from './index.spec.js';
import testSuiteTlsCert from './cert.spec.js';
import testSuiteTlsGjs from './tls.gjs.spec.js';
import testSuiteGivenSocket from './given-socket.spec.js';
import testSuiteStarttlsUpgrade from './starttls-upgrade.gjs.spec.js';
import testSuiteSniParser from './internal/sni-parser.spec.js';
import testSuiteSessionAccess from './session-access.gjs.spec.js';

run({
    testSuiteTls,
    testSuiteTlsCert,
    testSuiteTlsGjs,
    testSuiteGivenSocket,
    testSuiteStarttlsUpgrade,
    testSuiteSniParser,
    testSuiteSessionAccess,
});
