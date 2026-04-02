// Khronos WebGL Conformance Test runner for @gjsify/webgl.
// Runs ported WebGL1 conformance tests using @gjsify/unit.
// Phase 1: buffers, programs, attribs, context (no image loading required).

import { run } from '@gjsify/unit';
import buffersTests from './conformance/buffers.spec.js';
import programsTests from './conformance/programs.spec.js';
import attribsTests from './conformance/attribs.spec.js';
import contextTests from './conformance/context.spec.js';

run({
    testSuite: async () => {
        await buffersTests();
        await programsTests();
        await attribsTests();
        await contextTests();
    },
});
