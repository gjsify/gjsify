// Ported from refs/webgl/conformance-suites/2.0.0/conformance/context/
//   methods.html, constants-and-properties.html, context-type-test.html
// Original: Copyright (c) 2012 The Khronos Group Inc., MIT License
// Modifications: Uses @gjsify/unit; GTK-backed GL context.
// Note: incorrect-context-object-behaviour.html is not included here — it requires
//   two separate GL contexts which is tracked as Phase 2.

import { describe, it, expect, beforeEach, on } from '@gjsify/unit';
import { WebGLRenderingContext as OurWebGLRenderingContext } from '@gjsify/webgl';
import { createGLSetup } from './setup.js';

const WEBGL_METHODS = [
    'getContextAttributes', 'activeTexture', 'attachShader', 'bindAttribLocation',
    'bindBuffer', 'bindFramebuffer', 'bindRenderbuffer', 'bindTexture',
    'blendColor', 'blendEquation', 'blendEquationSeparate', 'blendFunc',
    'blendFuncSeparate', 'bufferData', 'bufferSubData', 'checkFramebufferStatus',
    'clear', 'clearColor', 'clearDepth', 'clearStencil', 'colorMask',
    'compileShader', 'compressedTexImage2D', 'compressedTexSubImage2D',
    'copyTexImage2D', 'copyTexSubImage2D', 'createBuffer', 'createFramebuffer',
    'createProgram', 'createRenderbuffer', 'createShader', 'createTexture',
    'cullFace', 'deleteBuffer', 'deleteFramebuffer', 'deleteProgram',
    'deleteRenderbuffer', 'deleteShader', 'deleteTexture', 'depthFunc',
    'depthMask', 'depthRange', 'detachShader', 'disable', 'disableVertexAttribArray',
    'drawArrays', 'drawElements', 'enable', 'enableVertexAttribArray', 'finish',
    'flush', 'framebufferRenderbuffer', 'framebufferTexture2D', 'frontFace',
    'generateMipmap', 'getActiveAttrib', 'getActiveUniform', 'getAttachedShaders',
    'getAttribLocation', 'getParameter', 'getBufferParameter', 'getError',
    'getExtension', 'getFramebufferAttachmentParameter', 'getProgramParameter',
    'getProgramInfoLog', 'getRenderbufferParameter', 'getShaderParameter',
    'getShaderInfoLog', 'getShaderPrecisionFormat', 'getShaderSource',
    'getSupportedExtensions', 'getTexParameter', 'getUniform', 'getUniformLocation',
    'getVertexAttrib', 'getVertexAttribOffset', 'hint', 'isBuffer', 'isContextLost',
    'isEnabled', 'isFramebuffer', 'isProgram', 'isRenderbuffer', 'isShader',
    'isTexture', 'lineWidth', 'linkProgram', 'pixelStorei', 'polygonOffset',
    'readPixels', 'renderbufferStorage', 'sampleCoverage', 'scissor', 'shaderSource',
    'stencilFunc', 'stencilFuncSeparate', 'stencilMask', 'stencilMaskSeparate',
    'stencilOp', 'stencilOpSeparate', 'texImage2D', 'texParameterf', 'texParameteri',
    'texSubImage2D', 'uniform1f', 'uniform1fv', 'uniform1i', 'uniform1iv',
    'uniform2f', 'uniform2fv', 'uniform2i', 'uniform2iv', 'uniform3f', 'uniform3fv',
    'uniform3i', 'uniform3iv', 'uniform4f', 'uniform4fv', 'uniform4i', 'uniform4iv',
    'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv', 'useProgram',
    'validateProgram', 'vertexAttrib1f', 'vertexAttrib1fv', 'vertexAttrib2f',
    'vertexAttrib2fv', 'vertexAttrib3f', 'vertexAttrib3fv', 'vertexAttrib4f',
    'vertexAttrib4fv', 'vertexAttribPointer', 'viewport',
];

// Selected constants with their expected numeric values from constants-and-properties.html
const WEBGL_CONSTANTS: [string, number][] = [
    ['DEPTH_BUFFER_BIT', 0x00000100],
    ['STENCIL_BUFFER_BIT', 0x00000400],
    ['COLOR_BUFFER_BIT', 0x00004000],
    ['POINTS', 0x0000],
    ['LINES', 0x0001],
    ['LINE_LOOP', 0x0002],
    ['LINE_STRIP', 0x0003],
    ['TRIANGLES', 0x0004],
    ['TRIANGLE_STRIP', 0x0005],
    ['TRIANGLE_FAN', 0x0006],
    ['ZERO', 0],
    ['ONE', 1],
    ['SRC_COLOR', 0x0300],
    ['SRC_ALPHA', 0x0302],
    ['FUNC_ADD', 0x8006],
    ['ARRAY_BUFFER', 0x8892],
    ['ELEMENT_ARRAY_BUFFER', 0x8893],
    ['STREAM_DRAW', 0x88E0],
    ['STATIC_DRAW', 0x88E4],
    ['DYNAMIC_DRAW', 0x88E8],
    ['FRAGMENT_SHADER', 0x8B30],
    ['VERTEX_SHADER', 0x8B31],
    ['COMPILE_STATUS', 0x8B81],
    ['LINK_STATUS', 0x8B82],
    ['VALIDATE_STATUS', 0x8B83],
    ['FLOAT', 0x1406],
    ['FLOAT_VEC2', 0x8B50],
    ['FLOAT_VEC3', 0x8B51],
    ['FLOAT_VEC4', 0x8B52],
    ['FLOAT_MAT2', 0x8B5A],
    ['FLOAT_MAT3', 0x8B5B],
    ['FLOAT_MAT4', 0x8B5C],
    ['INT', 0x1404],
    ['TEXTURE_2D', 0x0DE1],
    ['TEXTURE_CUBE_MAP', 0x8513],
    ['RGBA', 0x1908],
    ['RGB', 0x1907],
    ['UNSIGNED_BYTE', 0x1401],
    ['UNSIGNED_SHORT', 0x1403],
    ['UNSIGNED_INT', 0x1405],
    ['FRAMEBUFFER', 0x8D40],
    ['RENDERBUFFER', 0x8D41],
    ['DEPTH_COMPONENT16', 0x81A5],
    ['DEPTH_ATTACHMENT', 0x8D00],
    ['COLOR_ATTACHMENT0', 0x8CE0],
    ['FRAMEBUFFER_COMPLETE', 0x8CD5],
    ['NO_ERROR', 0],
    ['INVALID_ENUM', 0x0500],
    ['INVALID_VALUE', 0x0501],
    ['INVALID_OPERATION', 0x0502],
    ['OUT_OF_MEMORY', 0x0505],
];

export default async () => {
    await on('Display', async () => {

        const setup = createGLSetup();
        if (!setup) {
            console.warn('WebGL context not available — skipping conformance/context tests');
            return;
        }
        const { gl, glArea, win } = setup;
        glArea.make_current();

        // ── methods.html ──────────────────────────────────────────────────────
        // "This test ensures that the WebGL context has all the methods in the spec."

        await describe('conformance/context/methods: all WebGL methods present', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('all standard WebGL methods are functions on the context', async () => {
                const missing: string[] = [];
                for (const method of WEBGL_METHODS) {
                    if (typeof (gl as any)[method] !== 'function') {
                        missing.push(method);
                    }
                }
                if (missing.length > 0) {
                    throw new Error(`Missing WebGL methods: ${missing.join(', ')}`);
                }
            });
        });

        // ── constants-and-properties.html ─────────────────────────────────────
        // "This test ensures that the WebGL context has all the constants."

        await describe('conformance/context/constants-and-properties: constant values', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('all sampled WebGL constants have the correct numeric value', async () => {
                const wrong: string[] = [];
                for (const [name, expected] of WEBGL_CONSTANTS) {
                    const actual = (gl as any)[name];
                    if (actual !== expected) {
                        wrong.push(`${name}: expected ${expected}, got ${actual}`);
                    }
                }
                if (wrong.length > 0) {
                    throw new Error(`Wrong constant values:\n${wrong.join('\n')}`);
                }
            });

            await it('WebGLRenderingContext class constant values match instance constants', async () => {
                const wrong: string[] = [];
                for (const [name, expected] of WEBGL_CONSTANTS) {
                    const classVal = (OurWebGLRenderingContext as any)[name];
                    if (classVal !== undefined && classVal !== expected) {
                        wrong.push(`${name}: expected ${expected}, got ${classVal}`);
                    }
                }
                if (wrong.length > 0) {
                    throw new Error(`Wrong class constant values:\n${wrong.join('\n')}`);
                }
            });
        });

        // ── context-type-test.html ────────────────────────────────────────────
        // "Tests that the WebGL context interacts correctly with the canvas tag."

        await describe('conformance/context/context-type-test', async () => {
            beforeEach(async () => { glArea.make_current(); });

            await it('WebGLRenderingContext should exist in globalThis', async () => {
                expect(typeof (globalThis as any).WebGLRenderingContext !== 'undefined').toBeTruthy();
            });

            await it('gl should be an instance of WebGLRenderingContext', async () => {
                expect(gl instanceof OurWebGLRenderingContext).toBeTruthy();
            });

            await it('getContextAttributes returns an object', async () => {
                const attrs = gl.getContextAttributes();
                expect(attrs).not.toBeNull();
                expect(typeof attrs).toBe('object');
            });

            await it('isContextLost returns false initially', async () => {
                expect(gl.isContextLost()).toBe(false);
            });

            await it('canvas property points to the HTMLCanvasElement', async () => {
                expect(gl.canvas).not.toBeNull();
                expect(typeof (gl.canvas as any).getContext).toBe('function');
            });

            await it('drawingBufferWidth and drawingBufferHeight are positive integers', async () => {
                expect(gl.drawingBufferWidth).toBeGreaterThan(0);
                expect(gl.drawingBufferHeight).toBeGreaterThan(0);
                expect(Number.isInteger(gl.drawingBufferWidth)).toBeTruthy();
                expect(Number.isInteger(gl.drawingBufferHeight)).toBeTruthy();
            });

            await it('getSupportedExtensions returns an array of strings', async () => {
                const exts = gl.getSupportedExtensions();
                expect(Array.isArray(exts)).toBeTruthy();
                for (const ext of exts!) {
                    expect(typeof ext).toBe('string');
                }
            });

            await it('getParameter(VENDOR) and getParameter(RENDERER) return strings', async () => {
                const vendor = gl.getParameter(gl.VENDOR);
                const renderer = gl.getParameter(gl.RENDERER);
                const version = gl.getParameter(gl.VERSION);
                const shadingLang = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
                expect(typeof vendor).toBe('string');
                expect(typeof renderer).toBe('string');
                expect(typeof version).toBe('string');
                expect(typeof shadingLang).toBe('string');
            });
        });

        win.destroy();
    });
};
