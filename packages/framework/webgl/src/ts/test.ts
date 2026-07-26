import { run } from '@gjsify/unit';

import webgl1TestSuite from './webgl1.spec.js';
import webgl2TestSuite from './webgl2.spec.js';
import registerSuite from './register.spec.js';

run({
    testSuite: async () => {
        await webgl1TestSuite();
        await webgl2TestSuite();
    },
    registerSuite,
});
