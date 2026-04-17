// Excalibur canvas→WebGL texture pipeline tests.
//
// Excalibur renders text (and other 2D graphics) to an offscreen Canvas2D element
// via fillText, then uploads the canvas as a WebGL texture via gl.texImage2D.
// This is the critical pipeline for: coin counter, labels, font rendering.
//
// Our implementation handles HTMLCanvasElement sources in texImage2D via
// extractImageData() → getContext('2d').getImageData() → Uint8Array upload.
// These tests verify that pipeline end-to-end under a real WebGL context.
//
// Reference pipeline (excalibur.development.js ~9970, ~10138):
//   FontTextInstance._bitmap = document.createElement("canvas")
//   ctx = _bitmap.getContext("2d"); ctx.fillText(...)
//   ex.drawImage(_bitmap, ...) → textureLoader.load(_bitmap) → gl.texImage2D(target, level, RGBA, RGBA, UNSIGNED_BYTE, _bitmap)

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/dom-elements/register';
import '@gjsify/canvas2d';
import { WebGLBridge } from '@gjsify/webgl';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

export default async () => {
    await on('Display', async () => {
        Gtk.init();

        await describe('Canvas2D → WebGL texture pipeline', async () => {

            await it('texImage2D with Canvas2D element as source — no GL error', async () => {
                // This is the exact path Excalibur uses for all text rendering.
                // If this fails, labels/coin-counter will be invisible even if fillText works.
                const loop = new GLib.MainLoop(null, false);
                const win = new Gtk.Window({});
                win.set_default_size(100, 100);
                const widget = new WebGLBridge();
                widget.installGlobals();

                let error: unknown = null;
                let glError = -1;

                const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                    loop.quit();
                    return GLib.SOURCE_REMOVE;
                });

                widget.onReady((canvas) => {
                    GLib.source_remove(giveUpId);
                    try {
                        const gl = (canvas as any).getContext('webgl2') as WebGL2RenderingContext;

                        // Simulate Excalibur's FontTextInstance offscreen canvas
                        const offscreen = document.createElement('canvas') as HTMLCanvasElement;
                        offscreen.width = 64;
                        offscreen.height = 32;
                        const ctx2d = offscreen.getContext('2d') as CanvasRenderingContext2D;
                        ctx2d.fillStyle = 'white';
                        ctx2d.fillRect(0, 0, 64, 32);
                        ctx2d.fillStyle = 'black';
                        ctx2d.font = '20px sans-serif';
                        ctx2d.fillText('3', 10, 25);

                        // Upload canvas to WebGL texture — the exact call Excalibur makes
                        const tex = gl.createTexture();
                        gl.bindTexture(gl.TEXTURE_2D, tex);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen as any);
                        glError = gl.getError();
                        gl.deleteTexture(tex);
                    } catch (e) {
                        error = e;
                    }
                    loop.quit();
                });

                win.set_child(widget);
                win.present();
                loop.run();
                win.destroy();

                if (error) throw error;
                // gl.NO_ERROR = 0
                expect(glError).toBe(0);
            });

            await it('texImage2D canvas upload produces non-transparent texture pixels', async () => {
                // Verifies that Cairo→GdkPixbuf→WebGL pixel transfer preserves actual pixel data.
                // A fully-transparent texture would mean the conversion is broken.
                const loop = new GLib.MainLoop(null, false);
                const win = new Gtk.Window({});
                win.set_default_size(100, 100);
                const widget = new WebGLBridge();
                widget.installGlobals();

                let error: unknown = null;
                let hasNonZeroPixel = false;

                const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                    loop.quit();
                    return GLib.SOURCE_REMOVE;
                });

                widget.onReady((canvas) => {
                    GLib.source_remove(giveUpId);
                    try {
                        const gl = (canvas as any).getContext('webgl2') as WebGL2RenderingContext;

                        // Draw a solid red square to the offscreen canvas
                        const W = 4, H = 4;
                        const offscreen = document.createElement('canvas') as HTMLCanvasElement;
                        offscreen.width = W;
                        offscreen.height = H;
                        const ctx2d = offscreen.getContext('2d') as CanvasRenderingContext2D;
                        ctx2d.fillStyle = 'rgba(255, 0, 0, 1.0)';
                        ctx2d.fillRect(0, 0, W, H);

                        // Upload and read back via framebuffer
                        const tex = gl.createTexture();
                        gl.bindTexture(gl.TEXTURE_2D, tex);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen as any);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

                        const fb = gl.createFramebuffer();
                        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
                        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

                        const pixels = new Uint8Array(W * H * 4);
                        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                        // At least one pixel must have non-zero red or alpha
                        hasNonZeroPixel = pixels.some(v => v > 0);

                        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                        gl.deleteFramebuffer(fb);
                        gl.deleteTexture(tex);
                    } catch (e) {
                        error = e;
                    }
                    loop.quit();
                });

                win.set_child(widget);
                win.present();
                loop.run();
                win.destroy();

                if (error) throw error;
                // If this fails: Cairo ARGB → GdkPixbuf → WebGL conversion is broken
                expect(hasNonZeroPixel).toBe(true);
            });

            await it('WebGL2 context supports GLSL ES 3.00 (needed for OutlineMaterial)', async () => {
                // The coin counter label uses OutlineMaterial (#version 300 es + textureSize()).
                // If GLSL ES 3.0 is unsupported, the material fails silently and the label vanishes.
                const loop = new GLib.MainLoop(null, false);
                const win = new Gtk.Window({});
                win.set_default_size(100, 100);
                const widget = new WebGLBridge();
                widget.installGlobals();

                let error: unknown = null;
                let glslVersion = '';
                let shaderCompiles = false;

                const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                    loop.quit();
                    return GLib.SOURCE_REMOVE;
                });

                widget.onReady((canvas) => {
                    GLib.source_remove(giveUpId);
                    try {
                        const gl = (canvas as any).getContext('webgl2') as WebGL2RenderingContext;
                        glslVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string;

                        // Compile the OutlineMaterial fragment shader verbatim
                        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
                        gl.shaderSource(fs, `#version 300 es
                            precision mediump float;
                            uniform sampler2D u_graphic;
                            in vec2 v_uv;
                            out vec4 fragColor;
                            void main() {
                                vec2 aspect = 1.0 / vec2(textureSize(u_graphic, 0));
                                fragColor = texture(u_graphic, v_uv);
                            }
                        `);
                        gl.compileShader(fs);
                        shaderCompiles = gl.getShaderParameter(fs, gl.COMPILE_STATUS) as boolean;
                        if (!shaderCompiles) {
                            error = new Error('Shader compile failed: ' + gl.getShaderInfoLog(fs));
                        }
                        gl.deleteShader(fs);
                    } catch (e) {
                        error = e;
                    }
                    loop.quit();
                });

                win.set_child(widget);
                win.present();
                loop.run();
                win.destroy();

                if (error) throw error;
                // GLSL version string must mention ES 3 (e.g. "OpenGL ES GLSL ES 3.00")
                expect(glslVersion).toMatch(/3\./);
                expect(shaderCompiles).toBe(true);
            });

        });
    });
};
