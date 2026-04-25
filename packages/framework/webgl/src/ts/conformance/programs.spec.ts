// Ported from refs/webgl/conformance-suites/2.0.0/conformance/programs/
//   program-test.html, gl-shader-test.html, get-active-test.html
// Original: Copyright (c) 2012 The Khronos Group Inc., MIT License
// Modifications: Uses @gjsify/unit; inline shader sources replace script-element loading;
//   pixel checks use makeTestFBO + readPixel instead of wtu.checkCanvas.

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { makeTestFBO, destroyTestFBO, readPixel, pixelClose } from '../test-utils.js';
import { createGLSetup } from './setup.js';

// Shared vertex shader used across several tests
const VS_POSITION = `attribute vec4 a_position; void main() { gl_Position = a_position; }`;
const VS_COLOR_ATTRIB = `attribute vec4 aVertex; attribute vec4 aColor; varying vec4 vColor; void main() { vColor = aColor; gl_Position = aVertex; }`;
const FS_VARYING_COLOR = `precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;
const FS_RED = `void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;
const FS_GREEN = `void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }`;
const FS_SETTABLE = `precision mediump float; uniform vec4 u_color; void main() { gl_FragColor = u_color; }`;

// Standard program with two attribs (a_vertex FLOAT_VEC4, a_normal FLOAT_VEC3) and
// one uniform (u_modelViewProjMatrix FLOAT_MAT4) — mirrors wtu.loadStandardProgram.
const VS_STANDARD = `
    attribute vec4 a_vertex;
    attribute vec3 a_normal;
    uniform mat4 u_modelViewProjMatrix;
    void main() { gl_Position = u_modelViewProjMatrix * (a_vertex + vec4(a_normal, 0.0)); }`;
const FS_STANDARD = `
    precision mediump float;
    void main() { gl_FragColor = vec4(1.0); }`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
}

function linkProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string,
                     attribBindings?: [string, number][]): WebGLProgram | null {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    if (attribBindings) {
        for (const [name, loc] of attribBindings) gl.bindAttribLocation(prog, loc, name);
    }
    gl.linkProgram(prog);
    return prog;
}

/** Fill the current FBO with a fullscreen triangle and return the center pixel. */
function drawFullscreenAndRead(gl: WebGLRenderingContext, prog: WebGLProgram,
                                posAttrib: string | number = 'a_position'): Uint8Array {
    const loc = typeof posAttrib === 'string' ? gl.getAttribLocation(prog, posAttrib) : posAttrib;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // Fullscreen triangle covering entire clip space
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-4, -4, 4, -4, 0, 4]), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);
    gl.deleteBuffer(buf);
    return readPixel(gl, 0, 0);
}

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/programs tests');
            return;
        }
        const { gl, glArea, win } = setup;
        glArea.make_current();

        // ── program-test.html ─────────────────────────────────────────────────
        // "Tests that program compiling/linking/using works correctly."

        await describe('conformance/programs/program-test: compileShader', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('good vertex shader should compile', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER,
                    'attribute vec4 aVertex; void main() { gl_Position = aVertex; }');
                expect(gl.getShaderParameter(vs, gl.COMPILE_STATUS)).toBeTruthy();
                gl.deleteShader(vs);
            });

            await it('good fragment shader should compile', async () => {
                const fs = compileShader(gl, gl.FRAGMENT_SHADER,
                    'precision mediump float; void main() { gl_FragColor = vec4(1.0); }');
                expect(gl.getShaderParameter(fs, gl.COMPILE_STATUS)).toBeTruthy();
                gl.deleteShader(fs);
            });

            await it('getShaderParameter with desktop-only INFO_LOG_LENGTH returns null and INVALID_ENUM', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER,
                    'attribute vec4 v; void main() { gl_Position = v; }');
                const INFO_LOG_LENGTH = 0x8B84; // desktop GL constant not valid in WebGL
                const result = gl.getShaderParameter(vs, INFO_LOG_LENGTH);
                expect(result).toBeNull();
                expect(gl.getError()).toBe(gl.INVALID_ENUM);
                gl.deleteShader(vs);
            });
        });

        await describe('conformance/programs/program-test: attachShader / detachShader', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('attaching a vertex shader succeeds', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            await it('attaching the same shader twice generates INVALID_OPERATION', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.getError(); // clear
                gl.attachShader(prog, vs);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            await it('attaching two vertex shaders to same program generates INVALID_OPERATION', async () => {
                const vs1 = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const vs2 = compileShader(gl, gl.VERTEX_SHADER,
                    'attribute vec4 v; void main() { gl_Position = v * 0.5; }');
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs1);
                gl.getError(); // clear
                gl.attachShader(prog, vs2);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.deleteProgram(prog);
                gl.deleteShader(vs1);
                gl.deleteShader(vs2);
            });

            await it('detaching an attached shader succeeds', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.detachShader(prog, vs);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            await it('detaching a non-attached shader generates INVALID_OPERATION', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, fs);
                gl.getError(); // clear
                gl.detachShader(prog, vs); // vs is not attached
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });
        });

        await describe('conformance/programs/program-test: getAttachedShaders', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('empty program returns empty list', async () => {
                const prog = gl.createProgram()!;
                const shaders = gl.getAttachedShaders(prog);
                expect(shaders?.length).toBe(0);
                gl.deleteProgram(prog);
            });

            await it('attached shaders appear in getAttachedShaders', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                const shaders = gl.getAttachedShaders(prog)!;
                expect(shaders.length).toBe(2);
                expect(shaders.includes(vs)).toBeTruthy();
                expect(shaders.includes(fs)).toBeTruthy();
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });

            await it('detached shaders are removed from getAttachedShaders', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.detachShader(prog, vs);
                const shaders = gl.getAttachedShaders(prog)!;
                expect(shaders.length).toBe(1);
                expect(shaders.includes(fs)).toBeTruthy();
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });
        });

        await describe('conformance/programs/program-test: linkProgram / useProgram', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('valid program should link', async () => {
                const prog = linkProgram(gl, VS_COLOR_ATTRIB, FS_VARYING_COLOR,
                    [['aVertex', 0], ['aColor', 1]])!;
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
                expect(typeof gl.getProgramInfoLog(prog)).toBe('string');
                gl.deleteProgram(prog);
            });

            await it('program with no fragment shader should fail to link', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.linkProgram(prog);
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeFalsy();
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            await it('program with no vertex shader should fail to link', async () => {
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, fs);
                gl.linkProgram(prog);
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeFalsy();
                gl.deleteProgram(prog);
                gl.deleteShader(fs);
            });

            await it('using a valid program should succeed', async () => {
                const prog = linkProgram(gl, VS_COLOR_ATTRIB, FS_VARYING_COLOR,
                    [['aVertex', 0], ['aColor', 1]])!;
                gl.useProgram(prog);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.useProgram(null);
                gl.deleteProgram(prog);
            });

            await it('using an invalid (unlinked) program should generate INVALID_OPERATION', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.linkProgram(prog); // fails — no FS
                gl.useProgram(prog);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            await it('drawing with null program generates INVALID_OPERATION', async () => {
                const prog = linkProgram(gl, VS_POSITION, FS_RED, [['a_position', 0]])!;
                const fbo = makeTestFBO(gl, 2, 2);
                const buf = gl.createBuffer()!;
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER,
                    new Float32Array([0, 0, 1, 0, 0, 1]), gl.STATIC_DRAW);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(0);
                gl.useProgram(null);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.disableVertexAttribArray(0);
                gl.deleteBuffer(buf);
                destroyTestFBO(gl, fbo);
                gl.deleteProgram(prog);
            });
        });

        await describe('conformance/programs/program-test: deleteProgram / deleteShader', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('deleting the current program does not affect the current rendering state', async () => {
                const prog = linkProgram(gl, VS_POSITION, FS_RED, [['a_position', 0]])!;
                gl.useProgram(prog);
                gl.deleteProgram(prog);
                // Program still usable until unbound
                const fbo = makeTestFBO(gl, 2, 2);
                const pixel = drawFullscreenAndRead(gl, prog, 0);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();
                destroyTestFBO(gl, fbo);
                gl.useProgram(null);
            });

            await it('unattached deleted shader is invalid immediately', async () => {
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_RED);
                gl.deleteShader(fs);
                gl.compileShader(fs);
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
            });

            await it('attached deleted shader is still valid while attached', async () => {
                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_POSITION);
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_RED);
                const prog = linkProgram(gl, VS_POSITION, FS_RED, [['a_position', 0]])!;
                gl.attachShader(prog, vs); // would fail (already attached), ignore error
                gl.getError();
                // Delete fs3 which is attached to prog
                const fs3 = compileShader(gl, gl.FRAGMENT_SHADER, FS_GREEN);
                const prog2 = gl.createProgram()!;
                gl.attachShader(prog2, vs);
                gl.attachShader(prog2, fs3);
                gl.deleteShader(fs3);
                // Still attached — should still be valid
                gl.compileShader(fs3);
                expect(gl.getShaderParameter(fs3, gl.COMPILE_STATUS)).toBeTruthy();
                gl.deleteProgram(prog);
                gl.deleteProgram(prog2);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });
        });

        await describe('conformance/programs/program-test: relink updates rendering', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('relinking with a new fragment shader updates the program output', async () => {
                const fbo = makeTestFBO(gl, 2, 2);

                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_POSITION);
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_RED);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.bindAttribLocation(prog, 0, 'a_position');
                gl.linkProgram(prog);
                gl.useProgram(prog);
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();

                gl.clear(gl.COLOR_BUFFER_BIT);
                let pixel = drawFullscreenAndRead(gl, prog, 0);
                expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();

                // Relink with green fragment shader
                gl.shaderSource(fs, FS_GREEN);
                gl.compileShader(fs);
                gl.linkProgram(prog);
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();

                gl.clear(gl.COLOR_BUFFER_BIT);
                pixel = drawFullscreenAndRead(gl, prog, 0);
                expect(pixelClose(pixel, [0, 255, 0, 255])).toBeTruthy();

                destroyTestFBO(gl, fbo);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });

            await it('relinking clears uniforms — output should be transparent black', async () => {
                const fbo = makeTestFBO(gl, 2, 2);

                const vs = compileShader(gl, gl.VERTEX_SHADER, VS_POSITION);
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SETTABLE);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.bindAttribLocation(prog, 0, 'a_position');
                gl.linkProgram(prog);
                gl.useProgram(prog);

                const colorLoc = gl.getUniformLocation(prog, 'u_color')!;
                gl.uniform4f(colorLoc, 1, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                let pixel = drawFullscreenAndRead(gl, prog, 0);
                expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();

                // Relink clears uniforms back to zero
                gl.linkProgram(prog);
                gl.clear(gl.COLOR_BUFFER_BIT);
                pixel = drawFullscreenAndRead(gl, prog, 0);
                // u_color is now vec4(0,0,0,0) → transparent black
                expect(pixelClose(pixel, [0, 0, 0, 0])).toBeTruthy();

                destroyTestFBO(gl, fbo);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });
        });

        // ── gl-shader-test.html ────────────────────────────────────────────────
        // "Checks a few things about WebGL Shaders."
        // This test verifies that GEOMETRY_SHADER cannot be created, and that
        // deferred compilation (shaderSource after compileShader) uses the source
        // at link time (not the source present during the last compileShader call).

        await describe('conformance/programs/gl-shader-test', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('creating a GEOMETRY shader should return null', async () => {
                const GEOMETRY_SHADER_ARB = 0x8DD9;
                const shader = gl.createShader(GEOMETRY_SHADER_ARB);
                expect(shader).toBeNull();
            });

            await it('deferred compilation: shader linked with source set after first compile', async () => {
                const fbo = makeTestFBO(gl, 2, 2);

                const vs = compileShader(gl, gl.VERTEX_SHADER,
                    'attribute vec4 vPosition; void main() { gl_Position = vPosition; }');
                const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_GREEN);
                // Set red source AFTER compiling green — link should use red
                gl.shaderSource(fs, FS_RED);

                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.bindAttribLocation(prog, 0, 'vPosition');
                gl.linkProgram(prog);
                gl.useProgram(prog);

                gl.clear(gl.COLOR_BUFFER_BIT);
                const pixel = drawFullscreenAndRead(gl, prog, 0);
                // The uncompiled red source should be used → output is red
                expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();

                destroyTestFBO(gl, fbo);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
            });
        });

        // ── get-active-test.html ───────────────────────────────────────────────
        // Tests getActiveAttrib / getActiveUniform with the "standard" program
        // (2 attribs: a_vertex FLOAT_VEC4, a_normal FLOAT_VEC3; 1 uniform: u_modelViewProjMatrix FLOAT_MAT4)

        await describe('conformance/programs/get-active-test: getActiveAttrib', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getActiveAttrib returns correct info for standard attribs', async () => {
                const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD)!;
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();

                const count = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES) as number;
                expect(count).toBe(2);

                const infos: WebGLActiveInfo[] = [];
                for (let i = 0; i < count; i++) {
                    const info = gl.getActiveAttrib(prog, i);
                    expect(info).not.toBeNull();
                    infos.push(info!);
                }

                const names = infos.map(i => i.name).sort();
                expect(names).toContain('a_vertex');
                expect(names).toContain('a_normal');

                const vertexInfo = infos.find(i => i.name === 'a_vertex')!;
                expect(vertexInfo.type).toBe(gl.FLOAT_VEC4);
                expect(vertexInfo.size).toBe(1);

                const normalInfo = infos.find(i => i.name === 'a_normal')!;
                expect(normalInfo.type).toBe(gl.FLOAT_VEC3);
                expect(normalInfo.size).toBe(1);

                gl.deleteProgram(prog);
            });

            await it('getActiveAttrib with out-of-range index returns null and INVALID_VALUE', async () => {
                const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD)!;
                const count = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES) as number;
                const result = gl.getActiveAttrib(prog, count);
                expect(result).toBeNull();
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.deleteProgram(prog);
            });

            await it('getActiveAttrib with null program throws', async () => {
                expect(() => (gl as any).getActiveAttrib(null, 0)).toThrow();
            });
        });

        await describe('conformance/programs/get-active-test: getActiveUniform', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('getActiveUniform returns correct info for u_modelViewProjMatrix', async () => {
                const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD)!;
                const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
                expect(count).toBeGreaterThan(0);

                let found: WebGLActiveInfo | null = null;
                for (let i = 0; i < count; i++) {
                    const info = gl.getActiveUniform(prog, i);
                    if (info?.name === 'u_modelViewProjMatrix') found = info;
                }
                expect(found).not.toBeNull();
                expect(found!.type).toBe(gl.FLOAT_MAT4);
                expect(found!.size).toBe(1);
                gl.deleteProgram(prog);
            });

            await it('getActiveUniform with out-of-range index returns null and INVALID_VALUE', async () => {
                const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD)!;
                const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
                const result = gl.getActiveUniform(prog, count);
                expect(result).toBeNull();
                expect(gl.getError()).toBe(gl.INVALID_VALUE);
                gl.deleteProgram(prog);
            });

            await it('getActiveUniform with null program throws', async () => {
                expect(() => (gl as any).getActiveUniform(null, 0)).toThrow();
            });
        });

        win.destroy();
    });
};
