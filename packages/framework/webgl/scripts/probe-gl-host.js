// GL host probe for @gjsify/webgl — what would `WebGLBridge` get on THIS machine?
//
// Run it when porting the bridge to a new platform, or when a host renders
// nothing. It configures a bare `Gtk.GLArea` EXACTLY as `WebGLBridge`'s
// constructor does, then reports every number the bridge's behaviour depends on
// and draws a recognisable pattern with `clearColor` + `scissor` + `clear` only —
// no shaders, no vertex buffers — so a blank window can mean the GL/GTK path is
// broken but never "a shader failed to compile".
//
//   gjsify run packages/framework/webgl/scripts/probe-gl-host.js [--seconds N]
//
// Exits non-zero when the GLArea does not realize, so it doubles as a smoke test
// on a machine that HAS a display (CI runners and containers do not, which is why
// this is a script and not a spec — see `html-canvas-element.spec.ts` for the
// scale-factor coverage that CAN run headless).
//
// Pattern (window coordinates): magenta top-left, yellow top-right, cyan
// bottom-left, dark grey bottom-right, white band across the middle.
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import system from 'system';

const args = system.programArgs;
const secondsArg = args.indexOf('--seconds');
const SECONDS = secondsArg >= 0 && args[secondsArg + 1] ? Number(args[secondsArg + 1]) : 4;

// GL enums used below — spelled out so the probe needs no WebGL context object.
const GL = {
    COLOR_BUFFER_BIT: 0x4000,
    SCISSOR_TEST: 0x0c11,
    VERTEX_SHADER: 0x8b31,
    COMPILE_STATUS: 0x8b81,
    VENDOR: 0x1f00,
    RENDERER: 0x1f01,
    VERSION: 0x1f02,
    SHADING_LANGUAGE_VERSION: 0x8b8c,
    MAX_TEXTURE_SIZE: 0x0d33,
};

/** Every shader dialect a WebGL consumer can hand us, smallest legal program each. */
const SHADER_DIALECTS = [
    ['GLSL ES 1.00 (WebGL1)', '#version 100\nvoid main() { gl_Position = vec4(0.0); }\n'],
    ['GLSL ES 3.00 (WebGL2)', '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }\n'],
    ['GLSL 4.10 (desktop)  ', '#version 410 core\nvoid main() { gl_Position = vec4(0.0); }\n'],
];

Gtk.init();

const win = new Gtk.Window({ default_width: 900, default_height: 600, title: '@gjsify/webgl GL host probe' });
const area = new Gtk.GLArea();
// Mirror WebGLBridge's constructor. Keep these three lines in sync with it —
// a probe configured differently answers a different question.
area.set_allowed_apis(Gdk.GLAPI.GL | Gdk.GLAPI.GLES);
area.set_required_version(3, 2);
area.set_has_depth_buffer(true);
area.set_has_stencil_buffer(true);
win.set_child(area);

let reported = false;
let realized = false;

/** Fill one device-pixel rectangle via the scissor box. */
function fill(gl, x, y, w, h, r, g, b) {
    gl.scissor(x, y, w, h);
    gl.clearColor(r, g, b, 1.0);
    gl.clear(GL.COLOR_BUFFER_BIT);
}

function drawPattern(gl, dw, dh) {
    gl.viewport(0, 0, dw, dh);
    gl.enable(GL.SCISSOR_TEST);
    const halfW = Math.floor(dw / 2);
    const halfH = Math.floor(dh / 2);
    // GL's origin is bottom-left, so "top" is the upper half of the framebuffer.
    fill(gl, 0, halfH, halfW, dh - halfH, 1, 0, 1);
    fill(gl, halfW, halfH, dw - halfW, dh - halfH, 1, 1, 0);
    fill(gl, 0, 0, halfW, halfH, 0, 1, 1);
    fill(gl, halfW, 0, dw - halfW, halfH, 0.15, 0.15, 0.15);
    fill(gl, 0, halfH - Math.floor(dh / 20), dw, Math.floor(dh / 10), 1, 1, 1);
    gl.finish();
}

function reportShaderDialects(gl) {
    for (const [label, source] of SHADER_DIALECTS) {
        const shader = gl.createShader(GL.VERTEX_SHADER);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const ok = gl.getShaderParameter(shader, GL.COMPILE_STATUS) === 1;
        const log = (gl.getShaderInfoLog(shader) || '').trim().replace(/\n/g, ' | ');
        console.log(`  ${label}  ${ok ? 'COMPILES' : 'FAILS'}${log ? `  ${log}` : ''}`);
        gl.deleteShader(shader);
    }
}

async function report() {
    if (reported) return;
    reported = true;

    const ctx = area.get_context();
    const err = area.get_error();
    realized = err === null && ctx !== null;

    console.log(`display backend:     ${Gdk.Display.get_default().constructor.$gtype.name}`);
    console.log(`glarea error:        ${err ? err.message : 'none'}`);
    if (!realized) {
        // The failure this probe exists for: a GLES-ONLY request on a host with
        // no GLES profile (macOS/CGL) leaves the GLArea permanently in error.
        console.log('glarea did NOT realize — no context, nothing can render.');
        return;
    }
    const [major, minor] = ctx.get_version();
    const api = ctx.get_api() === Gdk.GLAPI.GLES ? 'GLES' : 'GL (desktop)';
    console.log(`gdk context:         ${ctx.constructor.$gtype.name}`);
    console.log(`negotiated api:      ${api} ${major}.${minor}`);
    // Both `glInvalidateFramebuffer` and `glInvalidateSubFramebuffer` arrived in
    // desktop GL 4.3 / GLES 3.0 and libepoxy ABORTS the process on a missing
    // entry point, so the Vala side gates them on this number.
    console.log(`GL >= 4.3 (invalidateFramebuffer reachable): ${major * 10 + minor >= 43}`);

    const scale = area.get_scale_factor();
    const w = area.get_allocated_width();
    const h = area.get_allocated_height();
    console.log(`widget scale factor: ${scale}`);
    // The two numbers the bridge must keep apart: GTK pre-scales a
    // DrawingArea's Cairo context but NOT a GLArea's framebuffer, so the GL
    // side reports the DEVICE size as `canvas.width`/`gl.drawingBufferWidth`
    // while `clientWidth` stays logical. `clientWidth * devicePixelRatio ===
    // canvas.width` is what makes an unmodified Three.js viewport cover the
    // whole framebuffer.
    console.log(`allocation (logical, what clientWidth must report):   ${w}x${h}`);
    console.log(`framebuffer (device, what canvas.width must report):  ${w * scale}x${h * scale}`);
    if (scale === 1) {
        // Stated explicitly because it is the reason this bug class shipped: at
        // scale factor 1 a bridge reporting the ALLOCATION as `canvas.width` is
        // indistinguishable from a correct one.
        console.log('  NOTE: scale factor is 1 — this host cannot falsify the HiDPI drawing-buffer bug.');
    }

    let Gwebgl;
    try {
        Gwebgl = (await import('gi://Gwebgl?version=0.1')).default;
    } catch (e) {
        console.log(`Gwebgl typelib not loadable (${e.message}) — install @gjsify/webgl for this platform.`);
        return;
    }
    area.make_current();
    const gl = new Gwebgl.WebGLRenderingContext({});
    const str = (e) => {
        const v = gl.getParameterx(e);
        return v ? v.deepUnpack() : '(null)';
    };
    console.log(`GL_VENDOR:           ${str(GL.VENDOR)}`);
    console.log(`GL_RENDERER:         ${str(GL.RENDERER)}`);
    console.log(`GL_VERSION:          ${str(GL.VERSION)}`);
    console.log(`GLSL version:        ${str(GL.SHADING_LANGUAGE_VERSION)}`);
    console.log(`MAX_TEXTURE_SIZE:    ${gl.getParameteri(GL.MAX_TEXTURE_SIZE)}`);
    console.log('shader dialects:');
    reportShaderDialects(gl);
    drawPattern(gl, w * scale, h * scale);
    console.log(`gl.getError() after the pattern: 0x${gl.getError().toString(16)}`);
    console.log(`--- pattern drawn; window stays up for ${SECONDS}s ---`);
}

area.connect('render', () => {
    void report();
    return true;
});

win.present();

const loop = GLib.MainLoop.new(null, false);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, SECONDS) * 1000, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();

system.exit(realized ? 0 : 1);
