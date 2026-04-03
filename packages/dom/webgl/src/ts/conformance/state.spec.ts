// Ported from refs/webgl/conformance-suites/2.0.0/conformance/state/
//   gl-initial-state.html, gl-get-calls.html, gl-enable-enum-test.html,
//   gl-getstring.html, gl-geterror.html, gl-object-get-calls.html
// Original: Copyright (c) 2012–2019 The Khronos Group Inc., MIT License
// Modifications: Uses @gjsify/unit; GTK-backed GL context; subset without image loading.

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeProgram } from '../test-utils.js';
import { createGLSetup } from './setup.js';

function arrClose(a: Float32Array | Int32Array | number[], b: number[], tol = 0.001): boolean {
    if ((a as any).length !== b.length) return false;
    for (let i = 0; i < b.length; i++) {
        if (Math.abs((a as any)[i] - b[i]) > tol) return false;
    }
    return true;
}

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/state tests');
            return;
        }
        const { gl, glArea } = setup;
        glArea.make_current();

        // ── gl-getstring ───────────────────────────────────────────────────────

        await describe('conformance/state/gl-getstring', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('VERSION starts with "WebGL 1.0"', async () => {
                const v = gl.getParameter(gl.VERSION) as string;
                expect(typeof v).toBe('string');
                expect(v.startsWith('WebGL 1.0')).toBe(true);
            });

            await it('SHADING_LANGUAGE_VERSION starts with "WebGL GLSL ES 1.0"', async () => {
                const v = gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string;
                expect(typeof v).toBe('string');
                expect(v.startsWith('WebGL GLSL ES 1.0')).toBe(true);
            });

            await it('VENDOR is a string (may be empty on some drivers)', async () => {
                const v = gl.getParameter(gl.VENDOR);
                expect(typeof v).toBe('string');
            });

            await it('RENDERER is a non-empty string', async () => {
                const v = gl.getParameter(gl.RENDERER) as string;
                expect(typeof v).toBe('string');
                expect(v.length > 0).toBe(true);
            });
        });

        // ── gl-initial-state ───────────────────────────────────────────────────

        await describe('conformance/state/gl-initial-state — blend', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('BLEND_SRC_RGB initial value is ONE', async () => {
                expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.ONE);
            });

            await it('BLEND_SRC_ALPHA initial value is ONE', async () => {
                expect(gl.getParameter(gl.BLEND_SRC_ALPHA)).toBe(gl.ONE);
            });

            await it('BLEND_DST_RGB initial value is ZERO', async () => {
                expect(gl.getParameter(gl.BLEND_DST_RGB)).toBe(gl.ZERO);
            });

            await it('BLEND_DST_ALPHA initial value is ZERO', async () => {
                expect(gl.getParameter(gl.BLEND_DST_ALPHA)).toBe(gl.ZERO);
            });

            await it('BLEND_EQUATION_RGB initial value is FUNC_ADD', async () => {
                expect(gl.getParameter(gl.BLEND_EQUATION_RGB)).toBe(gl.FUNC_ADD);
            });

            await it('BLEND_EQUATION_ALPHA initial value is FUNC_ADD', async () => {
                expect(gl.getParameter(gl.BLEND_EQUATION_ALPHA)).toBe(gl.FUNC_ADD);
            });

            await it('BLEND_COLOR initial value is [0,0,0,0]', async () => {
                const v = gl.getParameter(gl.BLEND_COLOR) as Float32Array;
                expect(arrClose(v, [0, 0, 0, 0])).toBe(true);
            });
        });

        // ── gl-get-calls — initial state ───────────────────────────────────────

        await describe('conformance/state/gl-get-calls — initial state', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('ACTIVE_TEXTURE initial value is TEXTURE0', async () => {
                expect(gl.getParameter(gl.ACTIVE_TEXTURE)).toBe(gl.TEXTURE0);
            });

            await it('ARRAY_BUFFER_BINDING initial value is null', async () => {
                expect(gl.getParameter(gl.ARRAY_BUFFER_BINDING)).toBeNull();
            });

            await it('ELEMENT_ARRAY_BUFFER_BINDING initial value is null', async () => {
                expect(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)).toBeNull();
            });

            await it('BLEND initial value is false', async () => {
                expect(gl.getParameter(gl.BLEND)).toBe(false);
            });

            await it('COLOR_CLEAR_VALUE initial value is [0,0,0,0]', async () => {
                const v = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
                expect(arrClose(v, [0, 0, 0, 0])).toBe(true);
            });

            await it('COLOR_WRITEMASK initial value is [true,true,true,true]', async () => {
                const v = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
                expect(v[0]).toBe(true);
                expect(v[1]).toBe(true);
                expect(v[2]).toBe(true);
                expect(v[3]).toBe(true);
            });

            await it('CULL_FACE initial value is false', async () => {
                expect(gl.getParameter(gl.CULL_FACE)).toBe(false);
            });

            await it('CULL_FACE_MODE initial value is BACK', async () => {
                expect(gl.getParameter(gl.CULL_FACE_MODE)).toBe(gl.BACK);
            });

            await it('CURRENT_PROGRAM initial value is null', async () => {
                const prog = gl.getParameter(gl.CURRENT_PROGRAM);
                expect(prog).toBeNull();
            });

            await it('DEPTH_CLEAR_VALUE initial value is 1', async () => {
                expect(gl.getParameter(gl.DEPTH_CLEAR_VALUE)).toBe(1);
            });

            await it('DEPTH_FUNC initial value is LESS', async () => {
                expect(gl.getParameter(gl.DEPTH_FUNC)).toBe(gl.LESS);
            });

            await it('DEPTH_RANGE initial value is [0, 1]', async () => {
                const v = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;
                expect(arrClose(v, [0, 1])).toBe(true);
            });

            await it('DEPTH_TEST initial value is false', async () => {
                expect(gl.getParameter(gl.DEPTH_TEST)).toBe(false);
            });

            await it('DEPTH_WRITEMASK initial value is true', async () => {
                expect(gl.getParameter(gl.DEPTH_WRITEMASK)).toBe(true);
            });

            await it('DITHER initial value is true', async () => {
                expect(gl.getParameter(gl.DITHER)).toBe(true);
            });

            await it('FRONT_FACE initial value is CCW', async () => {
                expect(gl.getParameter(gl.FRONT_FACE)).toBe(gl.CCW);
            });

            await it('GENERATE_MIPMAP_HINT initial value is DONT_CARE', async () => {
                expect(gl.getParameter(gl.GENERATE_MIPMAP_HINT)).toBe(gl.DONT_CARE);
            });

            await it('LINE_WIDTH initial value is 1', async () => {
                expect(gl.getParameter(gl.LINE_WIDTH)).toBe(1);
            });

            await it('PACK_ALIGNMENT initial value is 4', async () => {
                expect(gl.getParameter(gl.PACK_ALIGNMENT)).toBe(4);
            });

            await it('POLYGON_OFFSET_FACTOR initial value is 0', async () => {
                expect(gl.getParameter(gl.POLYGON_OFFSET_FACTOR)).toBe(0);
            });

            await it('POLYGON_OFFSET_FILL initial value is false', async () => {
                expect(gl.getParameter(gl.POLYGON_OFFSET_FILL)).toBe(false);
            });

            await it('POLYGON_OFFSET_UNITS initial value is 0', async () => {
                expect(gl.getParameter(gl.POLYGON_OFFSET_UNITS)).toBe(0);
            });

            await it('RENDERBUFFER_BINDING initial value is null', async () => {
                expect(gl.getParameter(gl.RENDERBUFFER_BINDING)).toBeNull();
            });

            await it('SAMPLE_COVERAGE_INVERT initial value is false', async () => {
                expect(gl.getParameter(gl.SAMPLE_COVERAGE_INVERT)).toBe(false);
            });

            await it('SAMPLE_COVERAGE_VALUE initial value is 1', async () => {
                expect(gl.getParameter(gl.SAMPLE_COVERAGE_VALUE)).toBe(1);
            });

            await it('SCISSOR_TEST initial value is false', async () => {
                expect(gl.getParameter(gl.SCISSOR_TEST)).toBe(false);
            });

            await it('STENCIL_CLEAR_VALUE initial value is 0', async () => {
                expect(gl.getParameter(gl.STENCIL_CLEAR_VALUE)).toBe(0);
            });

            await it('STENCIL_FAIL initial value is KEEP', async () => {
                expect(gl.getParameter(gl.STENCIL_FAIL)).toBe(gl.KEEP);
            });

            await it('STENCIL_FUNC initial value is ALWAYS', async () => {
                expect(gl.getParameter(gl.STENCIL_FUNC)).toBe(gl.ALWAYS);
            });

            await it('STENCIL_BACK_FUNC initial value is ALWAYS', async () => {
                expect(gl.getParameter(gl.STENCIL_BACK_FUNC)).toBe(gl.ALWAYS);
            });

            await it('STENCIL_REF initial value is 0', async () => {
                expect(gl.getParameter(gl.STENCIL_REF)).toBe(0);
            });

            await it('STENCIL_TEST initial value is false', async () => {
                expect(gl.getParameter(gl.STENCIL_TEST)).toBe(false);
            });

            await it('TEXTURE_BINDING_2D initial value is null', async () => {
                expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBeNull();
            });

            await it('TEXTURE_BINDING_CUBE_MAP initial value is null', async () => {
                expect(gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP)).toBeNull();
            });

            await it('UNPACK_ALIGNMENT initial value is 4', async () => {
                expect(gl.getParameter(gl.UNPACK_ALIGNMENT)).toBe(4);
            });

            await it('UNPACK_FLIP_Y_WEBGL initial value is false', async () => {
                expect(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)).toBe(false);
            });

            await it('UNPACK_PREMULTIPLY_ALPHA_WEBGL initial value is false', async () => {
                expect(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)).toBe(false);
            });

            await it('MAX_TEXTURE_SIZE is at least 64', async () => {
                expect((gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) >= 64).toBe(true);
            });

            await it('MAX_VERTEX_ATTRIBS is at least 8', async () => {
                expect((gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number) >= 8).toBe(true);
            });

            await it('MAX_COMBINED_TEXTURE_IMAGE_UNITS is at least 8', async () => {
                expect((gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number) >= 8).toBe(true);
            });

            await it('MAX_FRAGMENT_UNIFORM_VECTORS is at least 16', async () => {
                expect((gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number) >= 16).toBe(true);
            });

            await it('MAX_VERTEX_UNIFORM_VECTORS is at least 128', async () => {
                expect((gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number) >= 128).toBe(true);
            });

            await it('ALIASED_POINT_SIZE_RANGE is [>0, >=1]', async () => {
                const v = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
                expect((v as any)[0] > 0).toBe(true);
                expect((v as any)[1] >= 1).toBe(true);
            });

            await it('ALIASED_LINE_WIDTH_RANGE is [>0, >=1]', async () => {
                const v = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array;
                expect((v as any)[0] > 0).toBe(true);
                expect((v as any)[1] >= 1).toBe(true);
            });
        });

        // ── gl-get-calls — state change round-trip ─────────────────────────────

        await describe('conformance/state/gl-get-calls — state changes', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('clearColor updates COLOR_CLEAR_VALUE', async () => {
                gl.clearColor(0.1, 0.2, 0.3, 0.4);
                const v = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
                expect(arrClose(v, [0.1, 0.2, 0.3, 0.4])).toBe(true);
                gl.clearColor(0, 0, 0, 0);
            });

            await it('activeTexture updates ACTIVE_TEXTURE', async () => {
                gl.activeTexture(gl.TEXTURE2);
                expect(gl.getParameter(gl.ACTIVE_TEXTURE)).toBe(gl.TEXTURE2);
                gl.activeTexture(gl.TEXTURE0);
            });

            await it('blendFunc updates BLEND_SRC_RGB and BLEND_DST_RGB', async () => {
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.SRC_ALPHA);
                expect(gl.getParameter(gl.BLEND_DST_RGB)).toBe(gl.ONE_MINUS_SRC_ALPHA);
                gl.blendFunc(gl.ONE, gl.ZERO);
            });

            await it('depthFunc updates DEPTH_FUNC', async () => {
                gl.depthFunc(gl.EQUAL);
                expect(gl.getParameter(gl.DEPTH_FUNC)).toBe(gl.EQUAL);
                gl.depthFunc(gl.LESS);
            });

            await it('useProgram updates CURRENT_PROGRAM', async () => {
                const VS = 'attribute vec4 p; void main() { gl_Position = p; }';
                const FS = 'void main() { gl_FragColor = vec4(1); }';
                const prog = makeProgram(gl, VS, FS);
                gl.useProgram(prog);
                expect(gl.getParameter(gl.CURRENT_PROGRAM)).toBe(prog);
                gl.useProgram(null);
                expect(gl.getParameter(gl.CURRENT_PROGRAM)).toBeNull();
            });
        });

        // ── gl-enable-enum-test ────────────────────────────────────────────────

        await describe('conformance/state/gl-enable-enum-test', async () => {
            beforeEach(async () => { glArea.make_current(); });

            const validCaps = [
                'BLEND', 'CULL_FACE', 'DEPTH_TEST', 'DITHER',
                'POLYGON_OFFSET_FILL', 'SAMPLE_ALPHA_TO_COVERAGE',
                'SAMPLE_COVERAGE', 'SCISSOR_TEST', 'STENCIL_TEST',
            ] as const;

            for (const cap of validCaps) {
                await it(`enable/disable/isEnabled round-trip for ${cap}`, async () => {
                    gl.getError(); // flush any stale error
                    const val = (gl as any)[cap] as number;
                    const was = gl.isEnabled(val);
                    gl.enable(val);
                    expect(gl.isEnabled(val)).toBe(true);
                    expect(gl.getError()).toBe(gl.NO_ERROR);
                    gl.disable(val);
                    expect(gl.isEnabled(val)).toBe(false);
                    expect(gl.getError()).toBe(gl.NO_ERROR);
                    // restore
                    if (was) gl.enable(val); else gl.disable(val);
                });
            }

            await it('enable with invalid enum generates INVALID_ENUM', async () => {
                gl.enable(0x0BC0); // GL_ALPHA_TEST — desktop-only
                expect(gl.getError()).toBe(gl.INVALID_ENUM);
            });
        });

        // ── gl-geterror ────────────────────────────────────────────────────────

        await describe('conformance/state/gl-geterror', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('enable(ALPHA_TEST desktop enum) generates INVALID_ENUM', async () => {
                gl.enable(0x0BC0);
                expect(gl.getError()).toBe(gl.INVALID_ENUM);
            });

            await it('viewport with negative width/height generates INVALID_VALUE', async () => {
                gl.viewport(0, 0, -1, -1);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                // restore
                const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
                gl.viewport(0, 0, (vp as any)[2], (vp as any)[3]);
            });
        });

        // ── gl-object-get-calls — getBufferParameter ───────────────────────────

        await describe('conformance/state/gl-object-get-calls — getBufferParameter', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getBufferParameter BUFFER_SIZE returns correct size after bufferData', async () => {
                gl.getError(); // flush any stale error from previous tests
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 16, gl.DYNAMIC_DRAW);
                expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(16);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('getBufferParameter BUFFER_USAGE returns correct usage after bufferData', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 16, gl.DYNAMIC_DRAW);
                expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE)).toBe(gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });
        });

        // ── gl-object-get-calls — getRenderbufferParameter ────────────────────

        await describe('conformance/state/gl-object-get-calls — getRenderbufferParameter', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getRenderbufferParameter returns correct width/height/format', async () => {
                const rb = gl.createRenderbuffer()!;
                gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, 64, 32);
                expect(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH)).toBe(64);
                expect(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_HEIGHT)).toBe(32);
                expect(gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT))
                    .toBe(gl.RGBA4);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindRenderbuffer(gl.RENDERBUFFER, null);
                gl.deleteRenderbuffer(rb);
            });
        });
    });
};
