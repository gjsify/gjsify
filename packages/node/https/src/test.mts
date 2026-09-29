import { run } from '@gjsify/unit';

import testSuiteHttps from './index.spec.js';
import testSuiteHttpsClientTls from './client-tls.spec.js';
import testSuiteServerTls from './server-tls.spec.js';

run({ testSuiteHttps, testSuiteHttpsClientTls, testSuiteServerTls });
