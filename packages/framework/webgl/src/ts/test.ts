import { run } from '@gjsify/unit';

import webgl1TestSuite from './webgl1.spec.js';
import webgl2TestSuite from './webgl2.spec.js';
import canvasSizingSuite from './html-canvas-element.spec.js';
import softwareRendererSuite from './software-renderer.spec.js';
import registerSuite from './register.spec.js';

run({
    testSuite: async () => {
        await webgl1TestSuite();
        await webgl2TestSuite();
        await canvasSizingSuite();
        await softwareRendererSuite();
    },
    registerSuite,
});
