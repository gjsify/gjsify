// Khronos WebGL Conformance Test runner for @gjsify/webgl.
// Runs ported WebGL1 conformance tests using @gjsify/unit.
// Phase 1: buffers, programs, attribs, context (no image loading required).
// Phase 2: rendering-basic (clear-color, simple-shader, draw-indexed), uniforms, state.

import { run } from '@gjsify/unit';
import buffersTests from './conformance/buffers.spec.js';
import programsTests from './conformance/programs.spec.js';
import attribsTests from './conformance/attribs.spec.js';
import contextTests from './conformance/context.spec.js';
import renderingBasicTests from './conformance/rendering-basic.spec.js';
import uniformsTests from './conformance/uniforms.spec.js';
import stateTests from './conformance/state.spec.js';

run({
    testSuite: async () => {
        await buffersTests();
        await programsTests();
        await attribsTests();
        await contextTests();
        await renderingBasicTests();
        await uniformsTests();
        await stateTests();
    },
});
