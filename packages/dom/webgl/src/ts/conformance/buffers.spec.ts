// Ported from refs/webgl/conformance-suites/2.0.0/conformance/buffers/
// Original: Copyright (c) 2012 The Khronos Group Inc., MIT License
// Modifications: Uses @gjsify/unit; GTK-backed GL context instead of browser canvas;
//   pixel checks use makeTestFBO/readPixel (GTK FBO 0 is not readable outside render signal).

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeProgram, makeTestFBO, destroyTestFBO, readPixel, pixelClose } from '../test-utils.js';
import { createGLSetup } from './setup.js';

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/buffers tests');
            return;
        }
        const { gl, glArea, win } = setup;
        glArea.make_current();

        // ── buffer-bind-test.html ──────────────────────────────────────────────
        // "Checks a buffer can only be bound to 1 target."

        await describe('conformance/buffers/buffer-bind-test', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('should be able to bind and unbind an ARRAY_BUFFER', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.deleteBuffer(buf);
            });

            await it('should be able to bind and unbind an ELEMENT_ARRAY_BUFFER', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.deleteBuffer(buf);
            });

            await it('binding ARRAY_BUFFER to ELEMENT_ARRAY_BUFFER target should generate INVALID_OPERATION', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.deleteBuffer(buf);
            });

            await it('binding ELEMENT_ARRAY_BUFFER to ARRAY_BUFFER target should generate INVALID_OPERATION', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.deleteBuffer(buf);
            });
        });

        // ── buffer-data-and-buffer-sub-data.html ──────────────────────────────
        // "Test bufferData/bufferSubData with or without ArrayBuffer input"

        await describe('conformance/buffers/buffer-data-and-buffer-sub-data', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('bufferData with no buffer bound generates INVALID_OPERATION', async () => {
                gl.bufferData(gl.ARRAY_BUFFER, 4, gl.STATIC_DRAW);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
            });

            await it('bufferData with negative size generates INVALID_VALUE', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.getError(); // clear
                gl.bufferData(gl.ARRAY_BUFFER, -4, gl.STATIC_DRAW);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferData with null data generates INVALID_VALUE', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.getError(); // clear
                (gl as any).bufferData(gl.ARRAY_BUFFER, null, gl.STATIC_DRAW);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferData with size 0 succeeds and sets buffer size to 0', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(0);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferData with ArrayBuffer sets correct buffer size', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, new ArrayBuffer(4), gl.STATIC_DRAW);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(4);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferData with numeric size 4 sets buffer size to 4', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 4, gl.STATIC_DRAW);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(4);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferSubData before bufferData generates INVALID_VALUE', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, new ArrayBuffer(1));
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferSubData with negative offset generates INVALID_VALUE', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
                gl.getError(); // clear
                gl.bufferSubData(gl.ARRAY_BUFFER, -10, new ArrayBuffer(64));
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferSubData that overflows buffer generates INVALID_VALUE', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
                gl.getError(); // clear
                gl.bufferSubData(gl.ARRAY_BUFFER, 65, new ArrayBuffer(64));
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferSubData within bounds succeeds', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
                gl.getError(); // clear
                gl.bufferSubData(gl.ARRAY_BUFFER, 10, new ArrayBuffer(64));
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bufferSubData(gl.ARRAY_BUFFER, 10, new Float32Array(0));
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });

            await it('bufferSubData with non-ArrayBuffer throws TypeError', async () => {
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
                gl.getError(); // clear
                expect(() => (gl as any).bufferSubData(gl.ARRAY_BUFFER, 0, 42)).toThrow();
                expect(() => (gl as any).bufferSubData(gl.ARRAY_BUFFER, 0, "5.5")).toThrow();
                expect(() => (gl as any).bufferSubData(gl.ARRAY_BUFFER, 10, null)).toThrow();
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
                gl.deleteBuffer(buf);
            });
        });

        // ── element-array-buffer-delete-recreate.html ─────────────────────────
        // Regression: delete + recreate element array buffer, then drawElements

        await describe('conformance/buffers/element-array-buffer-delete-recreate', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('drawElements succeeds after deleting and recreating the element array buffer', async () => {
                const vsSrc = `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
                const fsSrc = `precision mediump float; void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }`;
                const prog = makeProgram(gl, vsSrc, fsSrc);
                gl.useProgram(prog);

                const fbo = makeTestFBO(gl, 2, 2);

                const vertexBuffer = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                    -1, -1,  1, -1,  -1, 1,  1, 1,
                ]), gl.STATIC_DRAW);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

                // Create, delete, recreate element array buffer
                let indexBuffer = gl.createBuffer()!;
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 3]), gl.STATIC_DRAW);
                gl.deleteBuffer(indexBuffer);

                indexBuffer = gl.createBuffer()!;
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 3]), gl.STATIC_DRAW);

                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0);
                expect(gl.getError()).toBe(gl.NO_ERROR);

                const pixel = readPixel(gl, 1, 1);
                expect(pixelClose(pixel, [0, 255, 0, 255])).toBeTruthy();

                destroyTestFBO(gl, fbo);
                gl.deleteBuffer(vertexBuffer);
                gl.deleteBuffer(indexBuffer);
                gl.deleteProgram(prog);
            });
        });

        win.destroy();
    });
};
