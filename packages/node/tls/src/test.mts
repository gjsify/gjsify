
import { run } from '@gjsify/unit';

import testSuiteTls from './index.spec.js';
import testSuiteTlsCert from './cert.spec.js';
import testSuiteTlsGjs from './tls.gjs.spec.js';

run({ testSuiteTls, testSuiteTlsCert, testSuiteTlsGjs });
