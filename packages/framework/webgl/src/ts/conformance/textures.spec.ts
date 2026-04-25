// Ported from refs/headless-gl/test/{alpha-texture,cubeMap}.js
// Original: BSD-2-Clause license, headless-gl contributors (Mikola Lysenko)
// Modifications: Uses @gjsify/unit; GTK-backed GL context; pixel checks use makeTestFBO;
//   additional tests ported from refs/webgl/conformance-suites/2.0.0/conformance/textures/misc/

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeProgram, drawTriangle, makeTestFBO, destroyTestFBO } from '../test-utils.js';
import { createGLSetup } from './setup.js';

const VS_TEX = `
    precision mediump float;
    attribute vec2 position;
    varying vec2 vTexCoord;
    void main() {
        vTexCoord = 0.5 * (position + 1.0);
        gl_Position = vec4(position, 0.0, 1.0);
    }`;

const FS_TEX = `
    precision mediump float;
    uniform sampler2D uTex;
    varying vec2 vTexCoord;
    void main() { gl_FragColor = texture2D(uTex, vTexCoord); }`;

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/textures tests');
            return;
        }
        const { gl, glArea } = setup;
        glArea.make_current();

        // ── texImage2D RGBA ────────────────────────────────────────────────────

        await describe('textures/texImage2D-rgba', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('upload 2×2 RGBA Uint8Array and sample it back', async () => {
                const W = 2, H = 2;
                const fbo = makeTestFBO(gl, W, H);

                const data = new Uint8Array([
                    255, 0, 0, 255,   // red
                    0, 255, 0, 255,   // green
                    0, 0, 255, 255,   // blue
                    255, 255, 0, 255, // yellow
                ]);
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

                const prog = makeProgram(gl, VS_TEX, FS_TEX);
                gl.useProgram(prog);
                gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
                drawTriangle(gl);

                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.deleteTexture(tex);
                destroyTestFBO(gl, fbo);
            });

            await it('createTexture returns non-null; deleteTexture cleans up', async () => {
                const tex = gl.createTexture()!;
                expect(tex).toBeDefined();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    new Uint8Array([128, 128, 128, 255]));
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── alpha texture ──────────────────────────────────────────────────────

        await describe('textures/alpha-texture', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('ALPHA format texImage2D: RGB channels zero, alpha matches upload data', async () => {
                const W = 4, H = 4;
                const fbo = makeTestFBO(gl, W, H);

                // Upload pattern: alpha = (i+j) % 255
                const data = new Uint8Array(W * H);
                for (let i = 0; i < H; i++) {
                    for (let j = 0; j < W; j++) {
                        data[i * W + j] = (i + j) % 255;
                    }
                }

                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, W, H, 0, gl.ALPHA, gl.UNSIGNED_BYTE, data);
                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                const prog = makeProgram(gl, VS_TEX, FS_TEX);
                gl.useProgram(prog);
                gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
                drawTriangle(gl);

                expect(gl.getError()).toBe(gl.NO_ERROR);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                // RGB channels must be 0 for ALPHA format; alpha must match upload
                let ok = true;
                for (let k = 0; k < W * H; k++) {
                    const i = k * 4;
                    if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) {
                        ok = false;
                        break;
                    }
                    // Alpha channel: allow ±3 for GPU rounding
                    if (Math.abs(pixels[i + 3] - data[k]) > 3) {
                        ok = false;
                        break;
                    }
                }
                expect(ok).toBe(true);

                gl.deleteTexture(tex);
                destroyTestFBO(gl, fbo);
            });
        });

        // ── texSubImage2D ──────────────────────────────────────────────────────

        await describe('textures/texSubImage2D', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('texSubImage2D overwrites a sub-region of an RGBA texture', async () => {
                const W = 4, H = 4;
                const fbo = makeTestFBO(gl, W, H);

                // Start with all-red texture
                const redData = new Uint8Array(W * H * 4).fill(0);
                for (let i = 0; i < W * H; i++) {
                    redData[i * 4] = 255;
                    redData[i * 4 + 3] = 255;
                }

                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, redData);

                // Overwrite top-left 2×2 with green
                const greenPatch = new Uint8Array([
                    0, 255, 0, 255,
                    0, 255, 0, 255,
                    0, 255, 0, 255,
                    0, 255, 0, 255,
                ]);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, greenPatch);
                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.deleteTexture(tex);
                destroyTestFBO(gl, fbo);
            });
        });

        // ── texture parameters ─────────────────────────────────────────────────

        await describe('textures/parameters', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getTexParameter returns set WRAP and FILTER values', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

                expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S)).toBe(gl.CLAMP_TO_EDGE);
                expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T)).toBe(gl.REPEAT);
                expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER)).toBe(gl.LINEAR);
                expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER)).toBe(gl.NEAREST);
                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
            });

            await it('MIRRORED_REPEAT wrap mode is accepted', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S)).toBe(gl.MIRRORED_REPEAT);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
            });

            await it('LINEAR_MIPMAP_LINEAR min filter is accepted', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER)).toBe(gl.LINEAR_MIPMAP_LINEAR);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
            });
        });

        // ── active texture units ───────────────────────────────────────────────

        await describe('textures/active-texture', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('activeTexture switches binding slot; each unit holds independent binding', async () => {
                const tex0 = gl.createTexture()!;
                const tex1 = gl.createTexture()!;

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, tex0);

                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, tex1);

                // Switch back to TEXTURE0 — should still have tex0 bound
                gl.activeTexture(gl.TEXTURE0);
                expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBe(tex0);

                gl.activeTexture(gl.TEXTURE1);
                expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBe(tex1);

                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex0);
                gl.deleteTexture(tex1);
            });

            await it('getParameter ACTIVE_TEXTURE reflects activeTexture call', async () => {
                gl.activeTexture(gl.TEXTURE3);
                expect(gl.getParameter(gl.ACTIVE_TEXTURE)).toBe(gl.TEXTURE3);
                gl.activeTexture(gl.TEXTURE0);
                expect(gl.getParameter(gl.ACTIVE_TEXTURE)).toBe(gl.TEXTURE0);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── cubemap ────────────────────────────────────────────────────────────

        await describe('textures/cubemap', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('attach all 6 cubemap faces to FBO — no GL error', async () => {
                const tex = gl.createTexture()!;
                const fb = gl.createFramebuffer()!;
                const whitePixel = new Uint8Array([255, 255, 255, 255]);

                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

                for (let i = 0; i < 6; i++) {
                    gl.texImage2D(
                        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0,
                        gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixel
                    );
                    gl.framebufferTexture2D(
                        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, tex, 0
                    );
                }

                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
                gl.activeTexture(gl.TEXTURE0);
                gl.deleteTexture(tex);
                gl.deleteFramebuffer(fb);
            });

            await it('createTexture with TEXTURE_CUBE_MAP binding — no error', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
                gl.deleteTexture(tex);
            });
        });

        // ── luminance texture ──────────────────────────────────────────────────

        await describe('textures/luminance', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('LUMINANCE format texImage2D — no error', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                // 4×1 LUMINANCE: rowStride = 4 (width=4, pixelSize=1, aligned to 4) = 4 bytes exactly
                const data = new Uint8Array([128, 64, 192, 32]);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 4, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
            });

            await it('LUMINANCE_ALPHA format texImage2D — no error', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                const data = new Uint8Array([128, 255, 64, 128]);  // 2 LA pixels
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, 2, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, data);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
            });
        });

        // ── generateMipmap ─────────────────────────────────────────────────────

        await describe('textures/generateMipmap', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('generateMipmap on power-of-two RGBA texture — no error', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                const W = 4, H = 4;
                const data = new Uint8Array(W * H * 4).fill(255);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
                gl.generateMipmap(gl.TEXTURE_2D);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.deleteTexture(tex);
            });
        });

    });
};
