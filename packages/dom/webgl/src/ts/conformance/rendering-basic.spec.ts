// Ported from refs/headless-gl/test/{clear-color,simple-shader,draw-indexed}.js
// Original: MIT license, headless-gl contributors
// Modifications: Uses @gjsify/unit; GTK-backed GL context; pixel checks use makeTestFBO
//   (GTK FBO 0 is not readable outside the render signal).

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeProgram, drawTriangle, makeTestFBO, destroyTestFBO, pixelClose } from '../test-utils.js';
import { createGLSetup } from './setup.js';

const VS_SRC = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FS_GREEN = `
    void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }`;

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/rendering-basic tests');
            return;
        }
        const { gl, glArea } = setup;
        glArea.make_current();

        // ── clear-color ────────────────────────────────────────────────────────
        // "clear color fills every pixel of the FBO with the specified RGBA value"

        await describe('rendering-basic/clear-color', async () => {
            beforeEach(async () => { glArea.make_current(); });

            const W = 10, H = 10;

            function testColor(r: number, g: number, b: number, a: number): boolean {
                const fbo = makeTestFBO(gl, W, H);
                gl.clearColor(r / 255, g / 255, b / 255, a / 255);
                gl.clear(gl.COLOR_BUFFER_BIT);
                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBO(gl, fbo);
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (pixels[i] !== r || pixels[i + 1] !== g ||
                        pixels[i + 2] !== b || pixels[i + 3] !== a) return false;
                }
                return true;
            }

            await it('clearColor black (0,0,0,0) fills all pixels', async () => {
                expect(testColor(0, 0, 0, 0)).toBe(true);
            });

            await it('clearColor white (255,255,255,255) fills all pixels', async () => {
                expect(testColor(255, 255, 255, 255)).toBe(true);
            });

            await it('clearColor green (0,255,0,255) fills all pixels', async () => {
                expect(testColor(0, 255, 0, 255)).toBe(true);
            });

            await it('clearColor magenta (255,0,255,0) fills all pixels', async () => {
                expect(testColor(255, 0, 255, 0)).toBe(true);
            });
        });

        // ── simple-shader ──────────────────────────────────────────────────────
        // "vertex + fragment shader renders a fullscreen green triangle"

        await describe('rendering-basic/simple-shader', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('fullscreen green triangle covers every pixel', async () => {
                const W = 50, H = 50;
                const fbo = makeTestFBO(gl, W, H);

                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                const prog = makeProgram(gl, VS_SRC, FS_GREEN);
                gl.useProgram(prog);
                drawTriangle(gl);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                destroyTestFBO(gl, fbo);

                let allGreen = true;
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (!pixelClose(pixels.subarray(i, i + 4) as unknown as Uint8Array,
                                    [0, 255, 0, 255])) {
                        allGreen = false;
                        break;
                    }
                }
                expect(allGreen).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── draw-indexed ───────────────────────────────────────────────────────
        // "drawElements with an index buffer renders a green quad"

        await describe('rendering-basic/draw-indexed', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('drawElements covers every pixel with green', async () => {
                const W = 50, H = 50;
                const fbo = makeTestFBO(gl, W, H);

                gl.clearColor(1, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);

                const prog = makeProgram(gl, VS_SRC, FS_GREEN);
                gl.useProgram(prog);

                const vbuffer = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, vbuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                    -1, -1,
                     1, -1,
                    -1,  1,
                     1,  1,
                ]), gl.STATIC_DRAW);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

                const ebuffer = gl.createBuffer()!;
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebuffer);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([
                    0, 1, 2,
                    2, 1, 3,
                ]), gl.STATIC_DRAW);

                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

                const pixels = new Uint8Array(W * H * 4);
                gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                gl.deleteBuffer(vbuffer);
                gl.deleteBuffer(ebuffer);
                destroyTestFBO(gl, fbo);

                let allGreen = true;
                for (let i = 0; i < W * H * 4; i += 4) {
                    if (!pixelClose(pixels.subarray(i, i + 4) as unknown as Uint8Array,
                                    [0, 255, 0, 255])) {
                        allGreen = false;
                        break;
                    }
                }
                expect(allGreen).toBe(true);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });
    });
};
