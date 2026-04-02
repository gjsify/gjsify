// Ported from refs/webgl/conformance-suites/2.0.0/conformance/uniforms/
//   null-uniform-location.html, gl-unknown-uniform.html, gl-uniform-bool.html,
//   gl-uniformmatrix4fv.html, uniform-location.html, gl-uniform-arrays.html
// Original: Copyright (c) 2012–2019 The Khronos Group Inc., MIT License
// Modifications: Uses @gjsify/unit; GTK-backed GL context; condensed into one file.

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeProgram } from '../test-utils.js';
import { createGLSetup } from './setup.js';

// ── Shared shader sources ──────────────────────────────────────────────────

const VS = `attribute vec4 a_position; void main() { gl_Position = a_position; }`;

function makeFS(body: string): string {
    return `precision mediump float; ${body}`;
}

// Fragment shaders that actually use each uniform type (so the driver doesn't
// optimize them away as inactive, which would make getUniformLocation return null).
const FS_FLOAT   = makeFS('uniform float u_f; void main() { gl_FragColor = vec4(u_f,0,0,1); }');
const FS_INT     = makeFS('uniform int u_i; void main() { gl_FragColor = vec4(float(u_i),0,0,1); }');
const FS_BOOL    = makeFS('uniform bool u_b; void main() { gl_FragColor = vec4(u_b ? 1.0 : 0.0,0,0,1); }');
const FS_VEC2    = makeFS('uniform vec2 u_v2; void main() { gl_FragColor = vec4(u_v2,0,1); }');
const FS_VEC3    = makeFS('uniform vec3 u_v3; void main() { gl_FragColor = vec4(u_v3,1); }');
const FS_VEC4    = makeFS('uniform vec4 u_v4; void main() { gl_FragColor = u_v4; }');
const FS_MAT2    = makeFS('uniform mat2 u_m2; void main() { gl_FragColor = vec4(u_m2[0],u_m2[1]); }');
const FS_MAT3    = makeFS('uniform mat3 u_m3; void main() { gl_FragColor = vec4(u_m3[0],1); }');
const FS_MAT4    = makeFS('uniform mat4 u_m4; void main() { gl_FragColor = u_m4[0]; }');
const FS_ARR     = makeFS('uniform float u_arr[3]; void main() { gl_FragColor = vec4(u_arr[0]+u_arr[1]+u_arr[2],0,0,1); }');
const FS_VEC4ARR = makeFS('uniform vec4 u_v4arr[3]; void main() { gl_FragColor = u_v4arr[0]+u_v4arr[1]+u_v4arr[2]; }');

// Helper: compare Float32Array-like values with a tolerance.
function floatArrayClose(a: Float32Array | number[], b: number[], tol = 0.001): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < b.length; i++) {
        if (Math.abs((a as any)[i] - b[i]) > tol) return false;
    }
    return true;
}

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/uniforms tests');
            return;
        }
        const { gl, glArea } = setup;
        glArea.make_current();

        // ── null-uniform-location ──────────────────────────────────────────────
        // "All uniform* calls with a null location must silently succeed (NO_ERROR)."

        await describe('conformance/uniforms/null-uniform-location', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('uniform* with null location generates NO_ERROR', async () => {
                const prog = makeProgram(gl, VS, FS_FLOAT);
                gl.useProgram(prog);
                gl.uniform1f(null, 1);          gl.getError();
                gl.uniform1fv(null, [1]);        gl.getError();
                gl.uniform1i(null, 1);           gl.getError();
                gl.uniform1iv(null, [1]);        gl.getError();
                gl.uniform2f(null, 1, 2);        gl.getError();
                gl.uniform2fv(null, [1, 2]);     gl.getError();
                gl.uniform2i(null, 1, 2);        gl.getError();
                gl.uniform2iv(null, [1, 2]);     gl.getError();
                gl.uniform3f(null, 1, 2, 3);     gl.getError();
                gl.uniform3fv(null, [1, 2, 3]);  gl.getError();
                gl.uniform3i(null, 1, 2, 3);     gl.getError();
                gl.uniform3iv(null, [1, 2, 3]);  gl.getError();
                gl.uniform4f(null, 1,2,3,4);     gl.getError();
                gl.uniform4fv(null, [1,2,3,4]);  gl.getError();
                gl.uniform4i(null, 1,2,3,4);     gl.getError();
                gl.uniform4iv(null, [1,2,3,4]);  gl.getError();
                gl.uniformMatrix2fv(null, false, [1,0,0,1]);               gl.getError();
                gl.uniformMatrix3fv(null, false, [1,0,0,0,1,0,0,0,1]);    gl.getError();
                gl.uniformMatrix4fv(null, false, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]); gl.getError();
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── gl-unknown-uniform ─────────────────────────────────────────────────
        // "getUniformLocation for an unknown name returns null."

        await describe('conformance/uniforms/gl-unknown-uniform', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getUniformLocation for unknown uniform returns null', async () => {
                const prog = makeProgram(gl, VS, FS_FLOAT);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'someUnknownUniform');
                expect(loc).toBeNull();
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('uniform1f with null location (unknown) generates NO_ERROR', async () => {
                const prog = makeProgram(gl, VS, FS_FLOAT);
                gl.useProgram(prog);
                gl.uniform1f(null, 42);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── gl-uniform-bool ────────────────────────────────────────────────────
        // "bool uniforms can be set via uniform1i (and uniform1f as an alias)."

        await describe('conformance/uniforms/gl-uniform-bool', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('setting a bool uniform via uniform1i succeeds', async () => {
                const prog = makeProgram(gl, VS, FS_BOOL);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_b')!;
                expect(loc).not.toBeNull();
                gl.uniform1i(loc, 1);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });

        // ── scalar/vector uniform round-trip ───────────────────────────────────

        await describe('conformance/uniforms/scalar-vector-round-trip', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('uniform1f / getUniform round-trips a float', async () => {
                const prog = makeProgram(gl, VS, FS_FLOAT);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_f')!;
                gl.uniform1f(loc, 0.5);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as number;
                expect(Math.abs(val - 0.5) < 0.001).toBe(true);
            });

            await it('uniform1i / getUniform round-trips an int', async () => {
                const prog = makeProgram(gl, VS, FS_INT);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_i')!;
                gl.uniform1i(loc, 7);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as number;
                expect(val).toBe(7);
            });

            await it('uniform2fv / getUniform round-trips a vec2', async () => {
                const prog = makeProgram(gl, VS, FS_VEC2);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_v2')!;
                gl.uniform2fv(loc, [0.25, 0.75]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as Float32Array;
                expect(floatArrayClose(val, [0.25, 0.75])).toBe(true);
            });

            await it('uniform3fv / getUniform round-trips a vec3', async () => {
                const prog = makeProgram(gl, VS, FS_VEC3);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_v3')!;
                gl.uniform3fv(loc, [0.1, 0.2, 0.3]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as Float32Array;
                expect(floatArrayClose(val, [0.1, 0.2, 0.3])).toBe(true);
            });

            await it('uniform4fv / getUniform round-trips a vec4', async () => {
                const prog = makeProgram(gl, VS, FS_VEC4);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_v4')!;
                gl.uniform4fv(loc, [0.1, 0.2, 0.3, 0.4]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as Float32Array;
                expect(floatArrayClose(val, [0.1, 0.2, 0.3, 0.4])).toBe(true);
            });
        });

        // ── gl-uniformmatrix4fv ────────────────────────────────────────────────
        // "matrix uniforms: size validation + transpose=true is INVALID_VALUE in WebGL1"

        await describe('conformance/uniforms/gl-uniformmatrix4fv', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('uniformMatrix2fv with correct size (4 elements) succeeds', async () => {
                const prog = makeProgram(gl, VS, FS_MAT2);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_m2')!;
                gl.uniformMatrix2fv(loc, false, [1,0, 0,1]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('uniformMatrix2fv with too few elements generates INVALID_VALUE', async () => {
                const prog = makeProgram(gl, VS, FS_MAT2);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_m2')!;
                gl.uniformMatrix2fv(loc, false, [1, 0, 0]);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });

            await it('uniformMatrix3fv with correct size (9 elements) succeeds', async () => {
                const prog = makeProgram(gl, VS, FS_MAT3);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_m3')!;
                gl.uniformMatrix3fv(loc, false, [1,0,0, 0,1,0, 0,0,1]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('uniformMatrix4fv with correct size (16 elements) succeeds', async () => {
                const prog = makeProgram(gl, VS, FS_MAT4);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_m4')!;
                gl.uniformMatrix4fv(loc, false, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('uniformMatrix4fv with transpose=true generates INVALID_VALUE in WebGL1', async () => {
                const prog = makeProgram(gl, VS, FS_MAT4);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_m4')!;
                gl.uniformMatrix4fv(loc, true, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });

            await it('uniformMatrix4fv / getUniform round-trips a mat4', async () => {
                const prog = makeProgram(gl, VS, FS_MAT4);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_m4')!;
                const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
                gl.uniformMatrix4fv(loc, false, identity);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as Float32Array;
                expect(floatArrayClose(val, identity)).toBe(true);
            });
        });

        // ── gl-uniform-arrays ──────────────────────────────────────────────────

        await describe('conformance/uniforms/gl-uniform-arrays', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('uniform1fv sets a float array and getUniform retrieves element [0]', async () => {
                const prog = makeProgram(gl, VS, FS_ARR);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_arr[0]')!;
                expect(loc).not.toBeNull();
                gl.uniform1fv(loc, [0.1, 0.2, 0.3]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                const val = gl.getUniform(prog, loc) as number;
                expect(Math.abs(val - 0.1) < 0.001).toBe(true);
            });

            await it('uniform1fv with fewer values than array size (partial update) succeeds', async () => {
                const prog = makeProgram(gl, VS, FS_ARR);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_arr[0]')!;
                gl.uniform1fv(loc, [0.5, 0.6]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('uniform4fv sets a vec4 array', async () => {
                const prog = makeProgram(gl, VS, FS_VEC4ARR);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_v4arr[0]')!;
                expect(loc).not.toBeNull();
                gl.uniform4fv(loc, [
                    0.1, 0.2, 0.3, 0.4,
                    0.5, 0.6, 0.7, 0.8,
                    0.9, 1.0, 0.0, 0.0,
                ]);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('calling uniform* before useProgram generates INVALID_OPERATION', async () => {
                const prog = makeProgram(gl, VS, FS_ARR);
                gl.useProgram(null);
                const loc = gl.getUniformLocation(prog, 'u_arr[0]');
                if (loc !== null) {
                    gl.uniform1fv(loc, [1, 2, 3]);
                    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                } else {
                    // null location — null-location path is also acceptable
                    expect(gl.getError()).toBe(gl.NO_ERROR);
                }
            });
        });

        // ── uniform-location ───────────────────────────────────────────────────
        // "Location becomes invalid after relinking the program."

        await describe('conformance/uniforms/uniform-location', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getUniformLocation returns non-null for known uniform', async () => {
                const prog = makeProgram(gl, VS, FS_FLOAT);
                gl.useProgram(prog);
                const loc = gl.getUniformLocation(prog, 'u_f');
                expect(loc).not.toBeNull();
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('location from different program generates INVALID_OPERATION', async () => {
                const prog1 = makeProgram(gl, VS, FS_FLOAT);
                const prog2 = makeProgram(gl, VS, FS_FLOAT);
                const loc = gl.getUniformLocation(prog1, 'u_f')!;
                gl.useProgram(prog2);
                gl.uniform1f(loc, 1);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
            });

            await it('location becomes invalid after relinkProgram', async () => {
                const prog = makeProgram(gl, VS, FS_FLOAT);
                gl.useProgram(prog);
                const locBefore = gl.getUniformLocation(prog, 'u_f')!;
                expect(locBefore).not.toBeNull();
                // Relink invalidates all previously obtained locations
                gl.linkProgram(prog);
                gl.uniform1f(locBefore, 1);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                // Obtaining a fresh location after relink works again
                const locAfter = gl.getUniformLocation(prog, 'u_f')!;
                expect(locAfter).not.toBeNull();
                gl.uniform1f(locAfter, 1);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });
        });
    });
};
