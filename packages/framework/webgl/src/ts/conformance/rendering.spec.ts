// Ported from refs/headless-gl/test/{blending,depth-buffer}.js
// Original: BSD-2-Clause license, headless-gl contributors (Mikola Lysenko)
// Modifications: Uses @gjsify/unit; GTK-backed GL context; pixel checks use makeTestFBO/makeTestFBOWithDepth

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import {
    makeProgram, drawTriangle,
    makeTestFBO, destroyTestFBO,
    makeTestFBOWithDepth, destroyTestFBOWithDepth,
    pixelClose,
} from '../test-utils.js';
import { createGLSetup } from './setup.js';

const VS = `
    precision mediump float;
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const VS_DEPTH = `
    attribute vec2 position;
    uniform float depth;
    void main() { gl_Position = vec4(position, depth, 1.0); }`;

const FS_COLOR = `
    precision mediump float;
    uniform vec4 color;
    void main() { gl_FragColor = color; }`;

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/rendering tests');
            return;
        }
        const { gl, glArea } = setup;
        glArea.make_current();

        // ── blending ───────────────────────────────────────────────────────────

        await describe('rendering/blending', async () => {
            beforeEach(async () => { glArea.make_current(); });

            const W = 2, H = 2;

            interface BlendTest {
                name: string;
                equation: number;
                srcFactor: number;
                dstFactor: number;
                dstColor: [number, number, number, number];
                srcColor: [number, number, number, number];
                expected: [number, number, number, number];
            }

            function runBlendTest(t: BlendTest): boolean {
                const fbo = makeTestFBO(gl, W, H);

                // Render dst color into FBO
                const fsSrc = `
                    precision mediump float;
                    void main() { gl_FragColor = vec4(${t.srcColor[0]},${t.srcColor[1]},${t.srcColor[2]},${t.srcColor[3]}); }`;

                gl.clearColor(t.dstColor[0], t.dstColor[1], t.dstColor[2], t.dstColor[3]);
                gl.clear(gl.COLOR_BUFFER_BIT);

                const prog = makeProgram(gl, VS, fsSrc);
                gl.useProgram(prog);

                gl.enable(gl.BLEND);
                gl.blendEquation(t.equation);
                gl.blendFunc(t.srcFactor, t.dstFactor);

                drawTriangle(gl);
                gl.disable(gl.BLEND);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBO(gl, fbo);

                const expected255 = t.expected.map(v => Math.round(v * 255)) as [number, number, number, number];
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (!pixelClose(pixels.subarray(i, i + 4) as unknown as Uint8Array, expected255, 4)) {
                        return false;
                    }
                }
                return true;
            }

            await it('FUNC_ADD ONE ONE: dst=[0.5,0.5,0.5,1] + src=[0.5,0.5,0.5,1] = [1,1,1,1]', async () => {
                expect(runBlendTest({
                    name: 'ADD ONE ONE',
                    equation: gl.FUNC_ADD,
                    srcFactor: gl.ONE,
                    dstFactor: gl.ONE,
                    dstColor: [0.5, 0.5, 0.5, 1.0],
                    srcColor: [0.5, 0.5, 0.5, 1.0],
                    expected: [1.0, 1.0, 1.0, 1.0],
                })).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('FUNC_ADD ONE ZERO: dst=[0.5,0.5,0.5,0.5] + src=[0.2,0.2,0.2,1] = [0.2,0.2,0.2,1]', async () => {
                expect(runBlendTest({
                    name: 'ADD ONE ZERO',
                    equation: gl.FUNC_ADD,
                    srcFactor: gl.ONE,
                    dstFactor: gl.ZERO,
                    dstColor: [0.5, 0.5, 0.5, 0.5],
                    srcColor: [0.2, 0.2, 0.2, 1.0],
                    expected: [0.2, 0.2, 0.2, 1.0],
                })).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('FUNC_ADD ZERO SRC_COLOR: dst=[0.8,0.8,0.8,1] * src=[0.5,0.5,0.5,0.5] = [0.4,0.4,0.4,0.5]', async () => {
                expect(runBlendTest({
                    name: 'ADD ZERO SRC_COLOR',
                    equation: gl.FUNC_ADD,
                    srcFactor: gl.ZERO,
                    dstFactor: gl.SRC_COLOR,
                    dstColor: [0.8, 0.8, 0.8, 1.0],
                    srcColor: [0.5, 0.5, 0.5, 0.5],
                    expected: [0.4, 0.4, 0.4, 0.5],
                })).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('FUNC_ADD DST_COLOR ZERO: dst=[0.8,0.8,0.8,1] src=[0.5,0.5,0.5,0.5] = [0.4,0.4,0.4,0.5]', async () => {
                expect(runBlendTest({
                    name: 'ADD DST_COLOR ZERO',
                    equation: gl.FUNC_ADD,
                    srcFactor: gl.DST_COLOR,
                    dstFactor: gl.ZERO,
                    dstColor: [0.8, 0.8, 0.8, 1.0],
                    srcColor: [0.5, 0.5, 0.5, 0.5],
                    expected: [0.4, 0.4, 0.4, 0.5],
                })).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('FUNC_ADD SRC_ALPHA ONE_MINUS_SRC_ALPHA: alpha=0.5 blend', async () => {
                expect(runBlendTest({
                    name: 'ADD SRC_ALPHA ONE_MINUS_SRC_ALPHA',
                    equation: gl.FUNC_ADD,
                    srcFactor: gl.SRC_ALPHA,
                    dstFactor: gl.ONE_MINUS_SRC_ALPHA,
                    dstColor: [0.5, 0.0, 0.5, 1.0],
                    srcColor: [0.5, 1.0, 0.0, 0.5],
                    expected: [0.5, 0.5, 0.25, 0.75],
                })).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── depth-buffer ───────────────────────────────────────────────────────

        await describe('rendering/depth-buffer', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('DEPTH_TEST NOTEQUAL: both passes render because depths differ', async () => {
                const W = 50, H = 50;
                const fbo = makeTestFBOWithDepth(gl, W, H);

                gl.clearColor(0, 0, 0, 0);
                gl.clearDepth(1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.NOTEQUAL);

                const prog = makeProgram(gl, VS_DEPTH, FS_COLOR);
                gl.useProgram(prog);

                // clip_z=0 → NDC z=0 → depth=0.5. clearDepth=1.0. NOTEQUAL(0.5 vs 1.0) → PASS.
                // Red drawn. Depth buffer = 0.5.
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 1, 0, 0, 1);
                drawTriangle(gl);

                // clip_z=1 → NDC z=1 → depth=1.0. Buffer=0.5. NOTEQUAL(1.0 vs 0.5) → PASS.
                // Green drawn (overwrites red). Expected: all green.
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 1);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 0, 1, 0, 1);
                drawTriangle(gl);

                gl.disable(gl.DEPTH_TEST);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBOWithDepth(gl, fbo);

                let allGreen = true;
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (!pixelClose(pixels.subarray(i, i + 4) as unknown as Uint8Array,
                            [0, 255, 0, 255], 3)) {
                        allGreen = false;
                        break;
                    }
                }
                expect(allGreen).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('DEPTH_TEST LESS: closer triangle overwrites farther', async () => {
                const W = 20, H = 20;
                const fbo = makeTestFBOWithDepth(gl, W, H);

                gl.clearColor(0, 0, 0, 0);
                gl.clearDepth(1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LESS);

                const prog = makeProgram(gl, VS_DEPTH, FS_COLOR);
                gl.useProgram(prog);

                // Draw blue at depth=0.5 (passes LESS vs cleared=1)
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.5);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 0, 0, 1, 1);
                drawTriangle(gl);

                // Draw green at depth=0.25 (passes LESS vs depth=0.5)
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.25);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 0, 1, 0, 1);
                drawTriangle(gl);

                // Draw red at depth=0.75 (fails LESS vs depth=0.25, does not overwrite)
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.75);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 1, 0, 0, 1);
                drawTriangle(gl);

                gl.disable(gl.DEPTH_TEST);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBOWithDepth(gl, fbo);

                let allGreen = true;
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (!pixelClose(pixels.subarray(i, i + 4) as unknown as Uint8Array,
                            [0, 255, 0, 255], 3)) {
                        allGreen = false;
                        break;
                    }
                }
                expect(allGreen).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('depthMask(false) prevents depth writes', async () => {
                const W = 10, H = 10;
                const fbo = makeTestFBOWithDepth(gl, W, H);

                gl.clearColor(0, 0, 0, 0);
                gl.clearDepth(1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LESS);

                const prog = makeProgram(gl, VS_DEPTH, FS_COLOR);
                gl.useProgram(prog);

                // Draw red at depth=0.5, mask off writes
                gl.depthMask(false);
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.5);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 1, 0, 0, 1);
                drawTriangle(gl);

                // Re-enable depth writes; draw green at depth=0.75
                // Since depth buffer still has 1.0 (red didn't write), green passes LESS
                gl.depthMask(true);
                gl.uniform1f(gl.getUniformLocation(prog, 'depth'), 0.75);
                gl.uniform4f(gl.getUniformLocation(prog, 'color'), 0, 1, 0, 1);
                drawTriangle(gl);

                gl.disable(gl.DEPTH_TEST);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBOWithDepth(gl, fbo);

                let allGreen = true;
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (!pixelClose(pixels.subarray(i, i + 4) as unknown as Uint8Array,
                            [0, 255, 0, 255], 3)) {
                        allGreen = false;
                        break;
                    }
                }
                expect(allGreen).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── scissor ────────────────────────────────────────────────────────────

        await describe('rendering/scissor', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('scissor test clips rendering to specified rectangle', async () => {
                const W = 20, H = 20;
                const fbo = makeTestFBO(gl, W, H);

                // Fill everything red
                gl.clearColor(1, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);

                // Scissor to left half and fill green
                gl.enable(gl.SCISSOR_TEST);
                gl.scissor(0, 0, W / 2, H);
                gl.clearColor(0, 1, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.disable(gl.SCISSOR_TEST);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBO(gl, fbo);

                // Left half should be green, right half red
                let ok = true;
                for (let y = 0; y < H; y++) {
                    for (let x = 0; x < W; x++) {
                        const i = (y * W + x) * 4;
                        const pix = pixels.subarray(i, i + 4) as unknown as Uint8Array;
                        if (x < W / 2) {
                            if (!pixelClose(pix, [0, 255, 0, 255])) { ok = false; break; }
                        } else {
                            if (!pixelClose(pix, [255, 0, 0, 255])) { ok = false; break; }
                        }
                    }
                    if (!ok) break;
                }
                expect(ok).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── mapbox-ansis: depthRange interaction ────────────────────────────────
        // Ported from refs/headless-gl/test/mapbox-ansis.js
        // Original: BSD-2-Clause license, headless-gl contributors (Mikola Lysenko)
        // Tests depthRange(near, far) mapping of NDC z to window-space depth.

        await describe('rendering/mapbox-ansis', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('depthRange: green at range(0,0.1) survives blue at range(0.9,1) with LEQUAL', async () => {
                const W = 4, H = 4;

                const vsSrc = `
                    precision mediump float;
                    uniform float u_z;
                    attribute vec2 a_position;
                    void main() { gl_Position = vec4(a_position, u_z, 1.0); }`;

                const fsSrc = `
                    precision mediump float;
                    uniform vec4 u_color;
                    void main() { gl_FragColor = u_color; }`;

                // Use an RGBA8 FBO with a depth renderbuffer
                const fb = gl.createFramebuffer()!;
                const colorTex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, colorTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.bindTexture(gl.TEXTURE_2D, null);

                const depthRb = gl.createRenderbuffer()!;
                gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
                gl.bindRenderbuffer(gl.RENDERBUFFER, null);

                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
                gl.viewport(0, 0, W, H);

                gl.clearColor(1, 0, 0, 1);
                gl.clearDepth(1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);

                const prog = makeProgram(gl, vsSrc, fsSrc);
                gl.useProgram(prog);

                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                // Full-screen quad: 2 triangles covering [-1,1]² clip space
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                    -1, -1,  1, -1, -1, 1,
                    -1,  1,  1, -1,  1, 1,
                ]), gl.STATIC_DRAW);
                const aPos = gl.getAttribLocation(prog, 'a_position');
                gl.enableVertexAttribArray(aPos);
                gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

                const uColor = gl.getUniformLocation(prog, 'u_color');
                const uZ = gl.getUniformLocation(prog, 'u_z');

                // Green pass: NDC z=0.5 mapped by depthRange(0, 0.1)
                // depth = 0 + (0.1-0)*(0.5+1)/2 = 0.075 < cleared=1 → LEQUAL passes
                gl.uniform1f(uZ, 0.5);
                gl.uniform4fv(uColor, [0, 1, 0, 1]);
                gl.depthRange(0, 0.1);
                gl.drawArrays(gl.TRIANGLES, 0, 6);

                // Blue pass: NDC z=0.5 mapped by depthRange(0.9, 1)
                // depth = 0.9 + (0.1)*(0.5+1)/2 = 0.975 > green's 0.075 → fails LEQUAL
                gl.uniform1f(uZ, 0.5);
                gl.uniform4fv(uColor, [0, 0, 1, 1]);
                gl.depthRange(0.9, 1);
                gl.drawArrays(gl.TRIANGLES, 0, 6);

                // Restore depthRange default
                gl.depthRange(0, 1);
                gl.disable(gl.DEPTH_TEST);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.deleteTexture(colorTex);
                gl.deleteRenderbuffer(depthRb);
                gl.deleteFramebuffer(fb);

                expect(gl.getError()).toBe(gl.NO_ERROR);

                // All pixels should be green (blue failed depth test)
                let allGreen = true;
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (pixels[i] !== 0 || pixels[i + 1] !== 255 ||
                        pixels[i + 2] !== 0 || pixels[i + 3] !== 255) {
                        allGreen = false;
                        break;
                    }
                }
                expect(allGreen).toBe(true);
            });
        });

        // ── viewport ───────────────────────────────────────────────────────────

        await describe('rendering/viewport', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('viewport restricts rendering region', async () => {
                const W = 20, H = 20;
                const fbo = makeTestFBO(gl, W, H);

                gl.clearColor(1, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);

                // Render into bottom-left quadrant only
                const HW = W / 2;
                gl.viewport(0, 0, HW, H / 2);

                const fsGreen = `precision mediump float; void main() { gl_FragColor = vec4(0,1,0,1); }`;
                const prog = makeProgram(gl, VS, fsGreen);
                gl.useProgram(prog);
                drawTriangle(gl);

                // Restore full viewport
                gl.viewport(0, 0, W, H);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBO(gl, fbo);

                // Bottom-left quadrant should be green, rest red
                let ok = true;
                for (let y = 0; y < H; y++) {
                    for (let x = 0; x < W; x++) {
                        const i = (y * W + x) * 4;
                        const pix = pixels.subarray(i, i + 4) as unknown as Uint8Array;
                        if (x < HW && y < H / 2) {
                            if (!pixelClose(pix, [0, 255, 0, 255])) { ok = false; break; }
                        } else {
                            if (!pixelClose(pix, [255, 0, 0, 255])) { ok = false; break; }
                        }
                    }
                    if (!ok) break;
                }
                expect(ok).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('getParameter(VIEWPORT) returns current viewport', async () => {
                const fbo = makeTestFBO(gl, 16, 16);
                gl.viewport(2, 3, 10, 12);
                const v = gl.getParameter(gl.VIEWPORT) as Int32Array;
                expect(v[0]).toBe(2);
                expect(v[1]).toBe(3);
                expect(v[2]).toBe(10);
                expect(v[3]).toBe(12);
                gl.viewport(0, 0, 16, 16);
                destroyTestFBO(gl, fbo);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

    });
};
