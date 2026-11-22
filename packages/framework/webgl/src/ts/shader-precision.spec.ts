// Fragment `mediump` precision, against a REAL Gtk.GLArea context.
//
// A desktop browser (ANGLE) gives `precision mediump float` full fp32, so a
// sprite shader that remaps a texture coordinate lands every texel edge on its
// pixel. Mesa can lower `mediump` to fp16 (11-bit mantissa); at a 1024-wide
// target that moves a coordinate by up to half a texel, which showed up as
// texel edges one device pixel off at an integer zoom. The shader below gets
// the exact fractional position of every pixel centre from an interpolated
// varying: at fp32 it is 0.5 ± 1/64, at fp16 it is anything.

import { describe, it, expect, on } from '@gjsify/unit';

import type { HTMLCanvasElement as OurHTMLCanvasElement } from '@gjsify/webgl';
import { WebGLBridge } from '@gjsify/webgl';
import { makeProgram, drawTriangle, makeTestFBO, destroyTestFBO } from './test-utils.js';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

const WIDTH = 1024;

const VS = `#version 300 es
in vec2 position;
out float v_u;
void main() {
    v_u = position.x * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

const fs = (precision: string) => `#version 300 es
${precision}
in float v_u;
out vec4 outColor;
void main() {
    outColor = vec4(fract(v_u * ${WIDTH}.0), 0.0, 0.0, 1.0);
}`;

export default async () => {
    await on('Gl', async () => {
        Gtk.init();
        let glArea!: WebGLBridge;
        let gl2!: WebGL2RenderingContext;
        const readyLoop = new GLib.MainLoop(null, false);
        const win = new Gtk.Window({});
        win.set_default_size(200, 200);
        glArea = new WebGLBridge();
        glArea.onReady((c) => {
            gl2 = (c as unknown as OurHTMLCanvasElement).getContext('webgl2') as WebGL2RenderingContext;
            readyLoop.quit();
        });
        win.set_child(glArea);
        win.present();
        const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            readyLoop.quit();
            return GLib.SOURCE_REMOVE;
        });
        readyLoop.run();
        GLib.source_remove(giveUpId);
        if (!gl2) {
            console.warn('WebGL2 context not available — skipping shader precision tests');
            win.destroy();
            return;
        }
        glArea.make_current();

        /** Worst distance of the red channel from 0.5 over the row, in 1/255 units. */
        const worstError = (precision: string): number => {
            glArea.make_current();
            const fbo = makeTestFBO(gl2, WIDTH, 1);
            const program = makeProgram(gl2, VS, fs(precision));
            gl2.useProgram(program);
            drawTriangle(gl2);
            const row = new Uint8Array(WIDTH * 4);
            gl2.readPixels(0, 0, WIDTH, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, row);
            destroyTestFBO(gl2, fbo);
            let worst = 0;
            for (let x = 0; x < WIDTH; x++) worst = Math.max(worst, Math.abs(row[x * 4] - 127.5));
            return worst;
        };

        await describe('fragment float precision', async () => {
            await it('runs mediump at the precision of highp, as a browser on desktop GL does', async () => {
                const high = worstError('precision highp float;');
                expect(worstError('precision mediump float;')).toBeLessThan(high + 1);
            });

            await it('promotes a mediump qualifier on a single variable too', async () => {
                const source = `#version 300 es
precision lowp float;
in mediump float v_u;
out vec4 outColor;
void main() { outColor = vec4(fract(v_u * ${WIDTH}.0), 0.0, 0.0, 1.0); }`;
                glArea.make_current();
                const fbo = makeTestFBO(gl2, WIDTH, 1);
                gl2.useProgram(makeProgram(gl2, VS.replace('out float', 'out mediump float'), source));
                drawTriangle(gl2);
                const row = new Uint8Array(WIDTH * 4);
                gl2.readPixels(0, 0, WIDTH, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, row);
                destroyTestFBO(gl2, fbo);
                let worst = 0;
                for (let x = 0; x < WIDTH; x++) worst = Math.max(worst, Math.abs(row[x * 4] - 127.5));
                expect(worst).toBeLessThan(2);
            });

            await it('reports the precision that actually runs', async () => {
                const fmt = (type: number) => gl2.getShaderPrecisionFormat(gl2.FRAGMENT_SHADER, type)!;
                expect(fmt(gl2.MEDIUM_FLOAT).precision).toBe(fmt(gl2.HIGH_FLOAT).precision);
            });
        });
    });
};
