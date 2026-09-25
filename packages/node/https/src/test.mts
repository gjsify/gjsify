import { run } from '@gjsify/unit';

import testSuiteHttps from './index.spec.js';
import testSuiteServerTls from './server-tls.spec.js';

run({ testSuiteHttps, testSuiteServerTls });
