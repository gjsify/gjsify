// WebGL behaviour a desktop-GL CORE profile does not provide natively, checked
// end to end on whatever context this host hands out.
//
// On GLES and compatibility profiles (Linux Mesa, CI) the driver answers all of
// this itself; on a core profile (macOS, win32 through GDK) the answers come
// from the emulation in `context/texture-management/legacy-formats.ts`, `hint`
// and `program-lifecycle.ts`. The assertions are WebGL's, so they hold on both
// and catch the emulation diverging from what a native context does.

import { beforeEach, describe, expect, it, on } from '@gjsify/unit';

import type { HTMLCanvasElement as OurHTMLCanvasElement } from '@gjsify/webgl';
import { WebGLBridge } from '@gjsify/webgl';
import { destroyTestFBO, drawTriangle, makeProgram, makeTestFBO, readPixel } from './test-utils.js';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

const VS = [
    'attribute vec2 position;',
    'varying vec2 vUv;',
    'void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }',
].join('\n');
const FS = [
    'precision mediump float;',
    'uniform sampler2D uTex;',
    'varying vec2 vUv;',
    'void main() { gl_FragColor = texture2D(uTex, vUv); }',
].join('\n');
const FS_GREEN = 'precision mediump float;\nvoid main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }';

const VS_300 = ['#version 300 es', 'in vec2 position;', 'void main() { gl_Position = vec4(position, 0.0, 1.0); }'].join(
    '\n',
);
const FS_ARRAY_300 = [
    '#version 300 es',
    'precision mediump float;',
    'precision mediump sampler2DArray;',
    'uniform sampler2DArray uTex;',
    'out vec4 fragColor;',
    'void main() { fragColor = texture(uTex, vec3(0.5, 0.5, 0.0)); }',
].join('\n');

interface Realized {
    area: WebGLBridge;
    win: Gtk.Window;
    gl: WebGLRenderingContext | WebGL2RenderingContext | null;
}

/** Realize a GLArea and return its context — `webgl2` asks the canvas for one explicitly. */
function realize(kind: 'webgl' | 'webgl2'): Realized {
    const loop = new GLib.MainLoop(null, false);
    const win = new Gtk.Window({});
    win.set_default_size(64, 64);
    const area = new WebGLBridge();
    const out: Realized = { area, win, gl: null };
    area.onReady((canvas, gl) => {
        out.gl =
            kind === 'webgl'
                ? gl
                : ((canvas as unknown as OurHTMLCanvasElement).getContext(
                      'webgl2',
                  ) as unknown as WebGL2RenderingContext);
        loop.quit();
    });
    win.set_child(area);
    win.present();
    const giveUp = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
    GLib.source_remove(giveUp);
    area.make_current();
    return out;
}

/** Upload `pixels` as a `size`×`size` texture of `format`, draw it into a 4×4 FBO, return pixel (0,0). */
function sampleUpload(
    gl: WebGLRenderingContext,
    program: WebGLProgram,
    format: GLenum,
    size: number,
    pixels: Uint8Array,
): { pixel: Uint8Array; error: GLenum } {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, size, size, 0, format, gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    const pixel = sampleTexture(gl, program, tex);
    gl.deleteTexture(tex);
    return { pixel, error };
}

/** Draw `tex` into a 4×4 FBO and return pixel (0,0). */
function sampleTexture(gl: WebGLRenderingContext, program: WebGLProgram, tex: WebGLTexture): Uint8Array {
    // makeTestFBO binds (and then unbinds) its own colour texture, so `tex` is bound after it.
    const fbo = makeTestFBO(gl, 4, 4);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.clearColor(0.5, 0.5, 0.5, 0.5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
    drawTriangle(gl);
    const pixel = readPixel(gl, 0, 0);
    destroyTestFBO(gl, fbo);
    return pixel;
}

const rgba = (p: Uint8Array): number[] => Array.from(p);

export default async () => {
    await on('Gl', async () => {
        Gtk.init();

        await describe('core-profile gaps: WebGL1', async () => {
            const { gl: ctx, win, area } = realize('webgl');
            if (!ctx) {
                console.warn('WebGL context not available after 10s — skipping tests');
                win.destroy();
                return;
            }
            const gl = ctx as WebGLRenderingContext;
            const program = makeProgram(gl, VS, FS);

            beforeEach(async () => {
                area.make_current();
                gl.activeTexture(gl.TEXTURE0);
                gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
                gl.getError();
            });

            await it('samples ALPHA as (0, 0, 0, a)', async () => {
                const { pixel, error } = sampleUpload(gl, program, gl.ALPHA, 2, new Uint8Array([200, 200, 200, 200]));
                expect(error).toBe(gl.NO_ERROR);
                expect(rgba(pixel)).toStrictEqual([0, 0, 0, 200]);
            });

            await it('samples LUMINANCE as (l, l, l, 1)', async () => {
                const { pixel, error } = sampleUpload(gl, program, gl.LUMINANCE, 2, new Uint8Array([90, 90, 90, 90]));
                expect(error).toBe(gl.NO_ERROR);
                expect(rgba(pixel)).toStrictEqual([90, 90, 90, 255]);
            });

            await it('samples LUMINANCE_ALPHA as (l, l, l, a)', async () => {
                const la = new Uint8Array([60, 180, 60, 180, 60, 180, 60, 180]);
                const { pixel, error } = sampleUpload(gl, program, gl.LUMINANCE_ALPHA, 2, la);
                expect(error).toBe(gl.NO_ERROR);
                expect(rgba(pixel)).toStrictEqual([60, 60, 60, 180]);
            });

            await it('texSubImage2D writes both LUMINANCE_ALPHA channels', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.LUMINANCE_ALPHA,
                    1,
                    1,
                    0,
                    gl.LUMINANCE_ALPHA,
                    gl.UNSIGNED_BYTE,
                    null,
                );
                gl.texSubImage2D(
                    gl.TEXTURE_2D,
                    0,
                    0,
                    0,
                    1,
                    1,
                    gl.LUMINANCE_ALPHA,
                    gl.UNSIGNED_BYTE,
                    new Uint8Array([30, 240]),
                );
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(rgba(sampleTexture(gl, program, tex))).toStrictEqual([30, 30, 30, 240]);
                gl.deleteTexture(tex);
            });

            await it('re-specifying a LUMINANCE texture as RGBA samples plain RGBA', async () => {
                // The swizzle is texture state; it must not outlive the image it was for.
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.LUMINANCE,
                    1,
                    1,
                    0,
                    gl.LUMINANCE,
                    gl.UNSIGNED_BYTE,
                    new Uint8Array([7]),
                );
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA,
                    1,
                    1,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    new Uint8Array([10, 20, 30, 40]),
                );
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(rgba(sampleTexture(gl, program, tex))).toStrictEqual([10, 20, 30, 40]);
                gl.deleteTexture(tex);
            });

            await it('copyTexImage2D takes the framebuffer alpha into ALPHA and LUMINANCE_ALPHA', async () => {
                // (0.2, 0.4, 0.6, 0.8) → (51, 102, 153, 204): luminance is the red channel.
                const expected: Array<[GLenum, number[]]> = [
                    [gl.ALPHA, [0, 0, 0, 204]],
                    [gl.LUMINANCE, [51, 51, 51, 255]],
                    [gl.LUMINANCE_ALPHA, [51, 51, 51, 204]],
                ];
                for (const [format, want] of expected) {
                    const src = makeTestFBO(gl, 2, 2);
                    gl.clearColor(0.2, 0.4, 0.6, 0.8);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    const tex = gl.createTexture()!;
                    gl.bindTexture(gl.TEXTURE_2D, tex);
                    gl.copyTexImage2D(gl.TEXTURE_2D, 0, format, 0, 0, 2, 2, 0);
                    expect(gl.getError()).toBe(gl.NO_ERROR);
                    destroyTestFBO(gl, src);
                    expect(rgba(sampleTexture(gl, program, tex))).toStrictEqual(want);
                    gl.deleteTexture(tex);
                }
            });

            await it('copyTexSubImage2D updates an ALPHA texture from the framebuffer alpha', async () => {
                const src = makeTestFBO(gl, 1, 1);
                gl.clearColor(1, 1, 1, 0.4); // alpha 102
                gl.clear(gl.COLOR_BUFFER_BIT);
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, 1, 1, 0, gl.ALPHA, gl.UNSIGNED_BYTE, new Uint8Array([0]));
                gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, 1, 1);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                destroyTestFBO(gl, src);
                expect(rgba(sampleTexture(gl, program, tex))).toStrictEqual([0, 0, 0, 102]);
                gl.deleteTexture(tex);
            });

            await it('refuses a sub-upload in another format than the legacy image', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.LUMINANCE,
                    1,
                    1,
                    0,
                    gl.LUMINANCE,
                    gl.UNSIGNED_BYTE,
                    new Uint8Array([90]),
                );
                expect(gl.getError()).toBe(gl.NO_ERROR);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.ALPHA, gl.UNSIGNED_BYTE, new Uint8Array([7]));
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([7, 7, 7, 7]));
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                expect(rgba(sampleTexture(gl, program, tex))).toStrictEqual([90, 90, 90, 255]);
                gl.deleteTexture(tex);
            });

            await it('a legacy-format texture is no complete color attachment', async () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, 2, 2, 0, gl.ALPHA, gl.UNSIGNED_BYTE, null);
                const fb = gl.createFramebuffer()!;
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
                expect(gl.checkFramebufferStatus(gl.FRAMEBUFFER)).not.toBe(gl.FRAMEBUFFER_COMPLETE);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.deleteFramebuffer(fb);
                gl.deleteTexture(tex);
                gl.getError();
            });

            await it('GENERATE_MIPMAP_HINT starts at DONT_CARE and reports what hint() set', async () => {
                expect(gl.getParameter(gl.GENERATE_MIPMAP_HINT)).toBe(gl.DONT_CARE);
                gl.hint(gl.GENERATE_MIPMAP_HINT, gl.NICEST);
                expect(gl.getError()).toBe(gl.NO_ERROR);
                expect(gl.getParameter(gl.GENERATE_MIPMAP_HINT)).toBe(gl.NICEST);
                gl.hint(gl.GENERATE_MIPMAP_HINT, gl.DONT_CARE);
                expect(gl.getError()).toBe(gl.NO_ERROR);
            });

            await it('refuses a second shader of the same stage', async () => {
                const prog = gl.createProgram()!;
                const fs1 = gl.createShader(gl.FRAGMENT_SHADER)!;
                const fs2 = gl.createShader(gl.FRAGMENT_SHADER)!;
                gl.attachShader(prog, fs1);
                gl.attachShader(prog, fs2);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                expect(gl.getAttachedShaders(prog)?.length).toBe(1);
                gl.deleteProgram(prog);
                gl.deleteShader(fs1);
                gl.deleteShader(fs2);
            });

            await it('a program without a fragment shader fails to link, use and validate', async () => {
                const vs = gl.createShader(gl.VERTEX_SHADER)!;
                gl.shaderSource(vs, VS);
                gl.compileShader(vs);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.linkProgram(prog);
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(false);
                expect((gl.getProgramInfoLog(prog) ?? '').length).toBeGreaterThan(0);

                const current = makeProgram(gl, VS, FS_GREEN);
                gl.useProgram(current);
                gl.getError();
                gl.useProgram(prog);
                expect(gl.getError()).toBe(gl.INVALID_OPERATION);
                // The refused call leaves the current program in place.
                expect(gl.getParameter(gl.CURRENT_PROGRAM)).toBe(current);

                gl.validateProgram(prog);
                expect(gl.getProgramParameter(prog, gl.VALIDATE_STATUS)).toBe(false);

                gl.useProgram(null);
                gl.deleteProgram(current);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            await it('a link WebGL refuses keeps an error queued before it', async () => {
                const vs = gl.createShader(gl.VERTEX_SHADER)!;
                gl.shaderSource(vs, VS);
                gl.compileShader(vs);
                const prog = gl.createProgram()!;
                gl.attachShader(prog, vs);
                gl.getError();
                gl.hint(0x1234, gl.NICEST); // queues INVALID_ENUM
                gl.linkProgram(prog);
                expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBe(false);
                expect(gl.getError()).toBe(gl.INVALID_ENUM);
                gl.deleteProgram(prog);
                gl.deleteShader(vs);
            });

            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            gl.deleteProgram(program);
            win.destroy();
        });

        await describe('core-profile gaps: WebGL2', async () => {
            const { gl: ctx, win, area } = realize('webgl2');
            if (!ctx) {
                console.warn('WebGL2 context not available after 10s — skipping tests');
                win.destroy();
                return;
            }
            const gl2 = ctx as WebGL2RenderingContext;
            const gl = gl2 as unknown as WebGLRenderingContext;

            beforeEach(async () => {
                area.make_current();
                gl2.pixelStorei(gl2.UNPACK_ALIGNMENT, 1);
                gl2.getError();
            });

            await it('samples an unsized LUMINANCE_ALPHA texImage2D as (l, l, l, a)', async () => {
                const program = makeProgram(gl, VS, FS);
                const la = new Uint8Array([60, 180, 60, 180, 60, 180, 60, 180]);
                const { pixel, error } = sampleUpload(gl, program, gl2.LUMINANCE_ALPHA, 2, la);
                expect(error).toBe(gl2.NO_ERROR);
                expect(rgba(pixel)).toStrictEqual([60, 60, 60, 180]);
                gl2.deleteProgram(program);
            });

            await it('samples an unsized ALPHA texImage3D array layer as (0, 0, 0, a)', async () => {
                const program = makeProgram(gl, VS_300, FS_ARRAY_300);
                expect(gl2.getProgramParameter(program, gl2.LINK_STATUS)).toBe(true);
                const tex = gl2.createTexture()!;
                gl2.bindTexture(gl2.TEXTURE_2D_ARRAY, tex);
                gl2.texImage3D(
                    gl2.TEXTURE_2D_ARRAY,
                    0,
                    gl2.ALPHA,
                    1,
                    1,
                    1,
                    0,
                    gl2.ALPHA,
                    gl2.UNSIGNED_BYTE,
                    new Uint8Array([77]),
                );
                expect(gl2.getError()).toBe(gl2.NO_ERROR);
                gl2.texParameteri(gl2.TEXTURE_2D_ARRAY, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
                gl2.texParameteri(gl2.TEXTURE_2D_ARRAY, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
                const fbo = makeTestFBO(gl, 4, 4);
                gl2.clearColor(0.5, 0.5, 0.5, 0.5);
                gl2.clear(gl2.COLOR_BUFFER_BIT);
                gl2.useProgram(program);
                drawTriangle(gl);
                const pixel = readPixel(gl, 0, 0);
                destroyTestFBO(gl, fbo);
                expect(rgba(pixel)).toStrictEqual([0, 0, 0, 77]);
                gl2.deleteTexture(tex);
                gl2.deleteProgram(program);
            });

            await it('copyTexSubImage3D takes the framebuffer alpha into an ALPHA array layer', async () => {
                const program = makeProgram(gl, VS_300, FS_ARRAY_300);
                const tex = gl2.createTexture()!;
                gl2.bindTexture(gl2.TEXTURE_2D_ARRAY, tex);
                gl2.texImage3D(
                    gl2.TEXTURE_2D_ARRAY,
                    0,
                    gl2.ALPHA,
                    1,
                    1,
                    1,
                    0,
                    gl2.ALPHA,
                    gl2.UNSIGNED_BYTE,
                    new Uint8Array([0]),
                );
                gl2.texParameteri(gl2.TEXTURE_2D_ARRAY, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
                gl2.texParameteri(gl2.TEXTURE_2D_ARRAY, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
                const src = makeTestFBO(gl, 1, 1);
                gl2.clearColor(1, 1, 1, 0.4); // alpha 102
                gl2.clear(gl2.COLOR_BUFFER_BIT);
                gl2.bindTexture(gl2.TEXTURE_2D_ARRAY, tex);
                gl2.copyTexSubImage3D(gl2.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 0, 0, 1, 1);
                expect(gl2.getError()).toBe(gl2.NO_ERROR);
                destroyTestFBO(gl, src);
                const fbo = makeTestFBO(gl, 4, 4);
                gl2.clearColor(0.5, 0.5, 0.5, 0.5);
                gl2.clear(gl2.COLOR_BUFFER_BIT);
                gl2.useProgram(program);
                drawTriangle(gl);
                const pixel = readPixel(gl, 0, 0);
                destroyTestFBO(gl, fbo);
                expect(rgba(pixel)).toStrictEqual([0, 0, 0, 102]);
                gl2.deleteTexture(tex);
                gl2.deleteProgram(program);
            });

            await it('an unsized LUMINANCE texture is no complete color attachment', async () => {
                const tex = gl2.createTexture()!;
                gl2.bindTexture(gl2.TEXTURE_2D, tex);
                gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.LUMINANCE, 2, 2, 0, gl2.LUMINANCE, gl2.UNSIGNED_BYTE, null);
                const fb = gl2.createFramebuffer()!;
                gl2.bindFramebuffer(gl2.FRAMEBUFFER, fb);
                gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, tex, 0);
                expect(gl2.checkFramebufferStatus(gl2.FRAMEBUFFER)).toBe(gl2.FRAMEBUFFER_INCOMPLETE_ATTACHMENT);
                gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, null, 0);
                gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
                gl2.deleteFramebuffer(fb);
                gl2.deleteTexture(tex);
                gl2.getError();
            });

            await it('refuses TEXTURE_SWIZZLE_* and keeps a failed texStorage2D from resetting one', async () => {
                const tex = gl2.createTexture()!;
                gl2.bindTexture(gl2.TEXTURE_2D_ARRAY, tex);
                gl2.texParameteri(gl2.TEXTURE_2D_ARRAY, 0x8e42 /* TEXTURE_SWIZZLE_R */, gl2.ONE);
                expect(gl2.getError()).toBe(gl2.INVALID_ENUM);
                gl2.deleteTexture(tex);

                const program = makeProgram(gl, VS, FS);
                const lum = gl2.createTexture()!;
                gl2.bindTexture(gl2.TEXTURE_2D, lum);
                gl2.texImage2D(
                    gl2.TEXTURE_2D,
                    0,
                    gl2.LUMINANCE,
                    1,
                    1,
                    0,
                    gl2.LUMINANCE,
                    gl2.UNSIGNED_BYTE,
                    new Uint8Array([90]),
                );
                gl2.texStorage2D(gl2.TEXTURE_2D, 1, gl2.ALPHA, 1, 1); // unsized: refused
                expect(gl2.getError()).not.toBe(gl2.NO_ERROR);
                expect(rgba(sampleTexture(gl, program, lum))).toStrictEqual([90, 90, 90, 255]);
                gl2.deleteTexture(lum);
                gl2.deleteProgram(program);
            });

            gl2.pixelStorei(gl2.UNPACK_ALIGNMENT, 4);
            win.destroy();
        });
    });
};
