
import { run } from '@gjsify/unit';

import testSuite from './index.spec.js';
import webgl2TestSuite from './webgl2.spec.js';

run({ testSuite: async () => { await testSuite(); await webgl2TestSuite(); } });
