// Ported from refs/webgl/conformance-suites/2.0.0/conformance/attribs/
//   gl-vertex-attrib.html  (refs/webgl/sdk/tests/js/tests/gl-vertex-attrib.js)
//   gl-enable-vertex-attrib.html
//   gl-bindAttribLocation-repeated.html
// Original: Copyright (c) 2012–2019 The Khronos Group Inc., MIT License
// Modifications: Uses @gjsify/unit; inline vertex/fragment sources; no DRNG random testing.

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeProgram } from '../test-utils.js';
import { createGLSetup } from './setup.js';

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/attribs tests');
            return;
        }
        const { gl, glArea, win } = setup;
        glArea.make_current();

        // ── gl-vertex-attrib.html ──────────────────��──────────────────────────
        // "This test ensures WebGL implementations vertexAttrib can be set and read."

        await describe('conformance/attribs/gl-vertex-attrib: vertexAttrib round-trip', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('vertexAttrib1f stores value in slot 0 and defaults to [x,0,0,1]', async () => {
                gl.vertexAttrib1f(0, 5);
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v instanceof Float32Array).toBeTruthy();
                expect(v[0]).toBe(5);
                expect(v[1]).toBe(0);
                expect(v[2]).toBe(0);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib2f stores two values and defaults the rest to [_,_,0,1]', async () => {
                gl.vertexAttrib2f(0, 6, 7);
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(6);
                expect(v[1]).toBe(7);
                expect(v[2]).toBe(0);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib3f stores three values and defaults last to 1', async () => {
                gl.vertexAttrib3f(0, 7, 8, 9);
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(7);
                expect(v[1]).toBe(8);
                expect(v[2]).toBe(9);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib4f stores all four values', async () => {
                gl.vertexAttrib4f(0, 6, 7, 8, 9);
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(6);
                expect(v[1]).toBe(7);
                expect(v[2]).toBe(8);
                expect(v[3]).toBe(9);
            });

            await it('vertexAttrib1fv with array round-trips correctly', async () => {
                gl.vertexAttrib1fv(0, [1]);
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(1);
                expect(v[1]).toBe(0);
                expect(v[2]).toBe(0);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib1fv with Float32Array round-trips correctly', async () => {
                gl.vertexAttrib1fv(0, new Float32Array([-1]));
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(-1);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib2fv with array round-trips correctly', async () => {
                gl.vertexAttrib2fv(0, [1, 2]);
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(1);
                expect(v[1]).toBe(2);
                expect(v[2]).toBe(0);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib3fv with Float32Array round-trips correctly', async () => {
                gl.vertexAttrib3fv(0, new Float32Array([1, -2, 3]));
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(1);
                expect(v[1]).toBe(-2);
                expect(v[2]).toBe(3);
                expect(v[3]).toBe(1);
            });

            await it('vertexAttrib4fv with Float32Array round-trips correctly', async () => {
                gl.vertexAttrib4fv(0, new Float32Array([1, 2, -3, 4]));
                const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array;
                expect(v[0]).toBe(1);
                expect(v[1]).toBe(2);
                expect(v[2]).toBe(-3);
                expect(v[3]).toBe(4);
            });

            await it('setting attrib values generates no GL error', async () => {
                const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
                for (let i = 0; i < numAttribs; i++) {
                    gl.vertexAttrib4f(i, i * 0.1, i * 0.2, i * 0.3, i * 0.4);
                }
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        await describe('conformance/attribs/gl-vertex-attrib: out-of-range index', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getVertexAttrib with out-of-range index generates INVALID_VALUE', async () => {
                const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
                gl.getVertexAttrib(numAttribs, gl.CURRENT_VERTEX_ATTRIB);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });

            await it('vertexAttrib1fv with out-of-range index generates INVALID_VALUE', async () => {
                const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
                gl.vertexAttrib1fv(numAttribs, [1]);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });

            await it('vertexAttrib4fv with out-of-range index generates INVALID_VALUE', async () => {
                const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
                gl.vertexAttrib4fv(numAttribs, new Float32Array([1, 2, 3, 4]));
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });

            await it('vertexAttrib4f with out-of-range index generates INVALID_VALUE', async () => {
                const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
                gl.vertexAttrib4f(numAttribs, 1, 2, 3, 4);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });
        });

        // ── gl-enable-vertex-attrib.html ───────────────────────────────────────
        // "tests that turning on attribs that have no buffer bound fails to draw"

        await describe('conformance/attribs/gl-enable-vertex-attrib', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('drawArrays with enabled attrib that has no buffer bound generates INVALID_OPERATION', async () => {
                const vsSrc = `attribute vec4 vPosition; void main() { gl_Position = vPosition; }`;
                const fsSrc = `void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;
                const prog = makeProgram(gl, vsSrc, fsSrc);
                gl.useProgram(prog);

                const vertexObject = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, vertexObject);
                gl.bufferData(gl.ARRAY_BUFFER,
                    new Float32Array([0, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0]),
                    gl.STATIC_DRAW);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

                // Enable attrib 3 which has no buffer bound
                gl.enableVertexAttribArray(3);
                expect(gl.getError()).toBe(gl.NO_ERROR);

                gl.drawArrays(gl.TRIANGLES, 0, 3);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);

                gl.disableVertexAttribArray(0);
                gl.disableVertexAttribArray(3);
                gl.deleteBuffer(vertexObject);
                gl.deleteProgram(prog);
            });
        });

        // ── gl-bindAttribLocation-repeated.html ───────────────────────────────
        // "Test repeated loading of programs involving bindAttribLocation calls"

        await describe('conformance/attribs/gl-bindAttribLocation-repeated', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getAttribLocation returns the bound location after linkProgram', async () => {
                const vsSrc = `attribute vec4 vPosition; void main() { gl_Position = vPosition; }`;
                const fsSrc = `void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;

                function setup(attribIndex: number): WebGLProgram {
                    const vs = gl.createShader(gl.VERTEX_SHADER)!;
                    gl.shaderSource(vs, vsSrc);
                    gl.compileShader(vs);
                    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
                    gl.shaderSource(fs, fsSrc);
                    gl.compileShader(fs);
                    const prog = gl.createProgram()!;
                    gl.attachShader(prog, vs);
                    gl.attachShader(prog, fs);
                    gl.bindAttribLocation(prog, attribIndex, 'vPosition');
                    gl.linkProgram(prog);
                    expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
                    expect(gl.getAttribLocation(prog, 'vPosition')).toBe(attribIndex);
                    gl.deleteShader(vs);
                    gl.deleteShader(fs);
                    return prog;
                }

                const p0 = setup(0);
                const p3 = setup(3);
                const p1 = setup(1);
                // Re-setup with index 3 to detect driver program-binary cache issues
                const p3b = setup(3);

                gl.deleteProgram(p0);
                gl.deleteProgram(p3);
                gl.deleteProgram(p1);
                gl.deleteProgram(p3b);
            });
        });

        win.destroy();
    });
};
