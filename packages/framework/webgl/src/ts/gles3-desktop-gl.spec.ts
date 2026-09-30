// WebGL 2.0's two GLES 3.0 behaviours a desktop-GL context spells differently,
// against a REAL `Gtk.GLArea` — the two the darwin ledger recorded as open.
//
// Both live in the Vala layer (`src/vala/`), so neither is reachable from
// TypeScript directly; everything below goes through the WebGL surface a consumer
// has, with one deliberate exception named where it is made.
//
//   1. PRIMITIVE_RESTART_FIXED_INDEX. WebGL 2.0 removes the state and "behaves
//      as though it were always enabled": an index equal to the maximum of its
//      data type cuts the primitive. Where the state exists that is one `Enable`
//      — and GLES 3.0 gives it the initial value DISABLED, so it has to be made.
//      Where it does not (macOS caps CGL at desktop GL 4.1 and offers no GLES
//      profile at all) the layer emulates it ANGLE's way, per draw and from the
//      element type.
//   2. The ten ETC2/EAC compressed formats. WebGL 2.0 REMOVES them — the ledger's
//      "mandatory ETC2/EAC" was the GLES 3.0 rule, not WebGL's — and re-offers
//      them through `WEBGL_compressed_texture_etc`, which this package does not
//      implement, so `webgl2.idl` names none of them. Refusing them has to be
//      THIS layer's doing: on the GLES 3.x context a Linux runner gets, every one
//      of the ten is a valid driver format and handing it to GL silently succeeds.
//
// The pixel witness is what makes (1) falsifiable. Two triangles TILE the
// viewport and share only the anti-diagonal, so a pixel in each half says which
// one the driver assembled; the second is built from the restart index. A driver
// without the behaviour paints the far half white, a conformant context leaves it
// the clear colour. It needs a 256-entry vertex buffer and nothing else — the
// restart index for UNSIGNED_BYTE is 255.

import { describe, it, expect, on } from '@gjsify/unit';
import type { WebGL2RenderingContext, WebGLRenderingContext } from '@gjsify/webgl';
import type { OurHTMLCanvasElement } from './html-canvas-element.js';
import { WebGLBridge } from '@gjsify/webgl';
import { makeTestFBO, destroyTestFBO } from './test-utils.js';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

/** `GL_PRIMITIVE_RESTART_FIXED_INDEX`, `GL_PRIMITIVE_RESTART` and
 *  `GL_PRIMITIVE_RESTART_INDEX` — none of them WebGL enums, so spelled out. */
const PRIMITIVE_RESTART_FIXED_INDEX = 0x8f8d;
const GL_PRIMITIVE_RESTART = 0x8f9d;
const GL_PRIMITIVE_RESTART_INDEX = 0x8f9e;
const NUM_FORMATS = 0x86da;

/** The ten ETC2/EAC `internalformat` values, paired with the name WebGL gives
 *  them on the extension object this package does not implement. */
const ETC2_EAC: [number, string][] = [
    [0x9270, 'COMPRESSED_R11_EAC'],
    [0x9271, 'COMPRESSED_SIGNED_R11_EAC'],
    [0x9272, 'COMPRESSED_RG11_EAC'],
    [0x9273, 'COMPRESSED_SIGNED_RG11_EAC'],
    [0x9274, 'COMPRESSED_RGB8_ETC2'],
    [0x9275, 'COMPRESSED_SRGB8_ETC2'],
    [0x9276, 'COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2'],
    [0x9277, 'COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2'],
    [0x9278, 'COMPRESSED_RGBA8_ETC2_EAC'],
    [0x9279, 'COMPRESSED_SRGB8_ALPHA8_ETC2_EAC'],
];

/** One `vec3 position` carries both the clip position and the colour selector,
 *  so the whole fixture is a single attribute — the shape `makeProgram` and
 *  `drawTriangle` in `test-utils` already use, and one less thing between the
 *  spec and the pixels. */
const VS = `#version 300 es
in vec3 position;
out vec3 vColor;
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vColor = vec3(position.z);
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }
`;

/** The largest index UNSIGNED_BYTE can carry, and the vertex that carries it. */
const RESTART_INDEX = 255;
/** 256 entries so the restart index is IN RANGE — an out-of-bounds fetch is
 *  undefined rather than a difference we could read. */
const VERTEX_COUNT = 256;
const SIZE = 128;

/** Inside the real triangle (clip (-0.5, -0.5) — the lower-left quadrant). */
const LOWER_LEFT = [32, 32];
/** Only the restart-index triangle can reach it (clip (0.5, 0.5)). */
const UPPER_RIGHT = [96, 96];
const CLEAR_BLUE = '0,0,255,255';
/** The real triangle's colour: `position.z` 0 → black. */
const REAL_PIXEL = '0,0,0,255';

/** Spin the main loop until `done()` or `timeoutMs`; returns whether `done()` held. */
function spinUntil(done: () => boolean, timeoutMs = 10000): boolean {
    const ctx = GLib.MainContext.default();
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    const wakeup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
    while (!done() && GLib.get_monotonic_time() < deadline) ctx.iteration(true);
    GLib.source_remove(wakeup);
    return done();
}

/**
 * The Gwebgl binding under the context — the one reader that bypasses this
 * package's JS shadow state. Needed for `GL_PRIMITIVE_RESTART_INDEX`, which is
 * not a WebGL pname and so has no WebGL-side answer at all.
 */
function nativeGl2(gl: WebGL2RenderingContext): { getParameteri(pname: number): number } {
    return (gl as unknown as { _native2: { getParameteri(pname: number): number } })._native2;
}

/**
 * Does this context have the GLES 3.0 state itself?
 *
 * The rule the spec states, read from the CONTEXT: GLES has it, and so does a
 * desktop context carrying `ARB_ES3_compatibility` (core from GL 4.3). Not the OS —
 * Mesa on win32 reports `4.6 (Compatibility Profile)` and has it, while macOS's
 * GL 4.1 has neither GLES nor the extension.
 */
function hasFixedRestartIndexState(gl: WebGL2RenderingContext): boolean {
    const version = String(gl.getParameter(gl.VERSION));
    if (version.startsWith('OpenGL ES ')) return true;
    const major = Number(version.split('.')[0]);
    const minor = Number(version.split('.')[1]);
    if (major > 4 || (major === 4 && minor >= 3)) return true;
    return gl.getSupportedExtensions().includes('GL_ARB_ES3_compatibility');
}

/** Element type → the largest index it can carry, i.e. what a restart cuts at. */
function maxIndexOf(type: number): number {
    if (type === 0x1405 /* UNSIGNED_INT */) return 0xffffffff;
    if (type === 0x1403 /* UNSIGNED_SHORT */) return 0xffff;
    return 0xff;
}

export default async () => {
    await on('Gl', async () => {
        Gtk.init();

        const win = new Gtk.Window({ default_width: SIZE, default_height: SIZE });
        const area = new WebGLBridge();
        win.set_child(area);

        let gl: WebGL2RenderingContext | null = null;
        area.onReady((canvas, _webgl1: WebGLRenderingContext) => {
            // The bridge hands over its WebGL 1 context; WebGL 2 is asked of the
            // canvas, exactly as a consumer would.
            gl = (canvas as unknown as OurHTMLCanvasElement).getContext('webgl2') as unknown as WebGL2RenderingContext;
        });
        win.present();
        spinUntil(() => gl !== null);
        expect(gl).not.toBeNull();
        const context = gl!;
        // Everything below runs OUTSIDE GTK's `render` signal, and a GLArea's
        // context is only current inside it: without this every GL call is a
        // silent no-op that `getError()` still reports as clean, so a draw that
        // drew nothing is indistinguishable from one that drew.
        area.make_current();
        const nativeState = hasFixedRestartIndexState(context);

        //
        // ── Fixture: two triangles tiling the viewport ────────────────────────
        //
        // Vertices 0/1/2 are the real (black) triangle, 3/4/255 the white one.
        // NO vertex is shared between them: a shared one would interpolate the
        // colour and read as a blend, which is neither answer.
        const vertices = new Float32Array(VERTEX_COUNT * 3);
        const put = (index: number, x: number, y: number, white: number) => {
            vertices[index * 3] = x;
            vertices[index * 3 + 1] = y;
            vertices[index * 3 + 2] = white;
        };
        put(0, -1, -1, 0);
        put(1, 1, -1, 0);
        put(2, -1, 1, 0);
        put(3, 1, -1, 1);
        put(4, -1, 1, 1);
        put(RESTART_INDEX, 1, 1, 1);

        // An FBO of our own is what makes the framebuffer readable at all outside
        // GTK's `render` signal — GtkGLArea's own FBO is not (see test-utils).
        const target = makeTestFBO(context, SIZE, SIZE);

        const program = context.createProgram()!;
        const vs = context.createShader(context.VERTEX_SHADER)!;
        context.shaderSource(vs, VS);
        context.compileShader(vs);
        const fs = context.createShader(context.FRAGMENT_SHADER)!;
        context.shaderSource(fs, FS);
        context.compileShader(fs);
        expect(context.getShaderParameter(vs, context.COMPILE_STATUS)).toBeTruthy();
        expect(context.getShaderParameter(fs, context.COMPILE_STATUS)).toBeTruthy();
        context.attachShader(program, vs);
        context.attachShader(program, fs);
        context.bindAttribLocation(program, 0, 'position');
        context.linkProgram(program);
        expect(context.getProgramParameter(program, context.LINK_STATUS)).toBeTruthy();
        context.useProgram(program);

        const vertexBuffer = context.createBuffer()!;
        context.bindBuffer(context.ARRAY_BUFFER, vertexBuffer);
        context.bufferData(context.ARRAY_BUFFER, vertices, context.STATIC_DRAW);
        context.enableVertexAttribArray(0);
        context.vertexAttribPointer(0, 3, context.FLOAT, false, 3 * 4, 0);

        const indexBuffer = context.createBuffer()!;

        /** Clear to blue and draw both triangles from `indices`. */
        const drawBothTriangles = (indices: ArrayBufferView, type: number) => {
            context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
            context.bufferData(context.ELEMENT_ARRAY_BUFFER, indices, context.STATIC_DRAW);
            context.clearColor(0, 0, 1, 1);
            context.clear(context.COLOR_BUFFER_BIT);
            context.drawElements(context.TRIANGLES, 6, type, 0);
            context.finish();
            expect(context.getError()).toBe(context.NO_ERROR);
        };

        /** `GL_PRIMITIVE_RESTART_INDEX` read through GL, which returns it SIGNED
         *  — `glGetIntegerv` has no unsigned form, so 0xFFFFFFFF arrives as -1. */
        const restartIndex = (): number => nativeGl2(context).getParameteri(GL_PRIMITIVE_RESTART_INDEX) >>> 0;

        const pixelAt = (x: number, y: number): number[] => {
            const out = new Uint8Array(4);
            context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, out);
            return Array.from(out);
        };

        await describe('WebGL2 primitive restart is always enabled', async () => {
            await it('cuts the primitive at the restart index instead of drawing it', async () => {
                // The real triangle is the witness that the DRAW happened at all: a
                // blank frame would satisfy "the far half is untouched" just as well.
                drawBothTriangles(new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_BYTE);
                // A white pixel in the far half (255,255,255,255 — `position.z` 1) is the restart
                // NOT happening, which a conformant context never paints.
                expect(pixelAt(...LOWER_LEFT).join(',')).toBe(REAL_PIXEL);
                expect(pixelAt(...UPPER_RIGHT).join(',')).toBe(CLEAR_BLUE);
            });

            await it('reaches the instanced draw path too', async () => {
                // A SEPARATE native entry point (`glDrawElementsInstanced`, which is
                // what three.js' `InstancedMesh` reaches) and a separate WebGL 2
                // method, so it is its own draw with its own restart index — the
                // first version of this left it at whatever the last draw set.
                context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
                context.bufferData(
                    context.ELEMENT_ARRAY_BUFFER,
                    new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]),
                    context.STATIC_DRAW,
                );
                context.clearColor(0, 0, 1, 1);
                context.clear(context.COLOR_BUFFER_BIT);
                context.drawElementsInstanced(context.TRIANGLES, 6, context.UNSIGNED_BYTE, 0, 2);
                context.finish();
                expect(context.getError()).toBe(context.NO_ERROR);
                expect(pixelAt(...LOWER_LEFT).join(',')).toBe(REAL_PIXEL);
                expect(pixelAt(...UPPER_RIGHT).join(',')).toBe(CLEAR_BLUE);
                if (!nativeState) expect(restartIndex()).toBe(maxIndexOf(context.UNSIGNED_BYTE));
            });

            await it('takes the restart index from the element type of each draw', async () => {
                // Per draw, because one index buffer can be drawn as more than one
                // type and the comparison value is a function of the type. Read
                // through the native pname: `GL_PRIMITIVE_RESTART_INDEX` is not a
                // WebGL query, so there is no other way to see it.
                const before = restartIndex();
                for (const [indices, type] of [
                    [new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_BYTE],
                    [new Uint16Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_SHORT],
                    [new Uint32Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_INT],
                ] as const) {
                    drawBothTriangles(indices, type);
                    const after = restartIndex();
                    if (nativeState) {
                        // This context HAS the state, so the layer must not touch the
                        // desktop-GL emulation state on it at all.
                        expect(after).toBe(before);
                    } else {
                        expect(after).toBe(maxIndexOf(type));
                    }
                }
            });

            await it('enables PRIMITIVE_RESTART only where the state is emulated', async () => {
                drawBothTriangles(new Uint8Array([0, 1, 2, RESTART_INDEX, 3, 4]), context.UNSIGNED_BYTE);
                const enabled = nativeGl2(context).getParameteri(GL_PRIMITIVE_RESTART) === 1;
                expect(enabled).toBe(!nativeState);
            });

            await it('refuses Enable/Disable of the state WebGL 2.0 removed', async () => {
                // "Not supported in WebGL 2.0" is an `INVALID_ENUM`, and WebGL 1.0
                // has no such enum either, so both contexts answer it the same way.
                // Leaving it to the driver answers it on the hosts that reject the
                // enum and not on the ones that do not — and those are the ones
                // where the state would otherwise be a consumer's to switch off.
                const raw = context as unknown as {
                    enable(cap: number): void;
                    disable(cap: number): void;
                };
                raw.enable(PRIMITIVE_RESTART_FIXED_INDEX);
                expect(context.getError()).toBe(context.INVALID_ENUM);
                raw.disable(PRIMITIVE_RESTART_FIXED_INDEX);
                expect(context.getError()).toBe(context.INVALID_ENUM);
            });
        });

        await describe('WebGL2 does not expose ETC2/EAC compressed formats', async () => {
            await it('advertises none of them in COMPRESSED_TEXTURE_FORMATS', async () => {
                const formats = context.getParameter(context.COMPRESSED_TEXTURE_FORMATS) as Uint32Array | number[];
                const advertised = Array.from(formats as ArrayLike<number>);
                for (const [format] of ETC2_EAC) {
                    expect(advertised).not.toContain(format);
                }
            });

            await it('names none of them on the context', async () => {
                // The names belong to the `WEBGL_compressed_texture_etc` extension
                // object, so a consumer cannot even name them — only pass the number.
                const named = context as unknown as Record<string, unknown>;
                for (const [, name] of ETC2_EAC) {
                    expect(named[name]).toBeUndefined();
                }
            });

            await it('does not offer the extension that would re-expose them', async () => {
                expect(context.getSupportedExtensions()).not.toContain('WEBGL_compressed_texture_etc');
            });

            await it('refuses every one of them with INVALID_ENUM on upload', async () => {
                const texture = context.createTexture()!;
                context.bindTexture(context.TEXTURE_2D, texture);
                const data = new Uint8Array(64);
                for (const [format] of ETC2_EAC) {
                    context.compressedTexImage2D(context.TEXTURE_2D, 0, format, 4, 4, 0, data);
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                    context.compressedTexSubImage2D(context.TEXTURE_2D, 0, 0, 0, 4, 4, format, data);
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                    context.compressedTexImage3D(
                        context.TEXTURE_2D,
                        0,
                        format,
                        4,
                        4,
                        4,
                        0,
                        0 /* imageSize, ignored by the native side */,
                        data,
                    );
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                    context.compressedTexSubImage3D(
                        context.TEXTURE_2D,
                        0,
                        0,
                        0,
                        0,
                        4,
                        4,
                        4,
                        format,
                        0 /* imageSize, ignored by the native side */,
                        data,
                    );
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                }
            });

            await it('refuses to describe them with getInternalformatParameter', async () => {
                // The other way the number leaks: the driver answers for any enum it
                // knows, so a GLES 3.x host reports the ten — and their properties —
                // for a format WebGL 2.0 does not expose.
                for (const [format] of ETC2_EAC) {
                    context.getInternalformatParameter(context.TEXTURE_2D, format, NUM_FORMATS);
                    expect(context.getError()).toBe(context.INVALID_ENUM);
                }
            });
        });

        context.bindFramebuffer(context.FRAMEBUFFER, null);
        destroyTestFBO(context, target);
        win.destroy();
    });
};
