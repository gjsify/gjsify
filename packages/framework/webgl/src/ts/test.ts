import { run } from '@gjsify/unit';

import webgl1TestSuite from './webgl1.spec.js';
import webgl2TestSuite from './webgl2.spec.js';
import canvasSizingSuite from './html-canvas-element.spec.js';
import hidpiSuite from './hidpi.spec.js';
import softwareRendererSuite from './software-renderer.spec.js';
import registerSuite from './register.spec.js';
import glsl1DesktopSuite from './context/shader-program/glsl1-desktop.spec.js';
import legacyFormatsSuite from './context/texture-management/legacy-formats.spec.js';
import legacyCoreProfileSuite from './legacy-core-profile.spec.js';

run({
    testSuite: async () => {
        await webgl1TestSuite();
        await webgl2TestSuite();
        await canvasSizingSuite();
        await hidpiSuite();
        await softwareRendererSuite();
        await glsl1DesktopSuite();
        await legacyFormatsSuite();
        await legacyCoreProfileSuite();
    },
    registerSuite,
});
