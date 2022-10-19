import '@gjsify/types/index';
import Gtk from '@gjsify/types/Gtk-4.0';
import GLib from '@gjsify/types/GLib-2.0';
// import GObject from ''@gjsify/types/GObject';
import Gio from '@gjsify/types/Gio-2.0';
//import Gwebgl from 'gi://Gwebgl';
//const WebGLRenderingContext = Gwebgl.WebGLRenderingContext;
import { GjsifyHTMLCanvasElement, GjsifyWebGLRenderingContextSimple } from '@gjsify/webgl';

let app: Gtk.Application;

let rendered = false;

function render(glarea: Gtk.GLArea, gl: WebGLRenderingContext) {

    if (!rendered) {
        print("initial render");
        rendered = true;
        const ctx = glarea.get_context();
        printerr('Context: ' +
            `${ctx.get_required_version()} ES ${ctx.get_use_es()}`);
    }

    // Set clear color to black, fully opaque
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    // Clear the color buffer with specified clear color
    gl.clear(gl.COLOR_BUFFER_BIT);

}

function tick(glarea: Gtk.GLArea) {
    glarea.queue_render();
    return true;
}

function activate(app: Gtk.Application) {
    print("activate");
    const win = Gtk.ApplicationWindow.new(app);
    win.set_default_size(800, 600);
    const glarea = Gtk.GLArea.new();
    // glarea.set_use_es(true);

    let gl: WebGLRenderingContext & GjsifyWebGLRenderingContextSimple;
    glarea.connect('render', () => {
        if(!gl) {
            const canvas = new GjsifyHTMLCanvasElement(glarea);
            gl = canvas.getContext("webgl");
        }
        render(glarea, gl);
        return true;
    });
    glarea.connect('create-context', () => {
        console.log("create-context");
        try {
            const surface = glarea.get_native().get_surface();
            const ctx = surface.create_gl_context();
            ctx.set_debug_enabled(true);
            ctx.set_use_es(1);
            ctx.set_required_version(2, 0);

            return ctx;
        } catch (e) {
            console.error(e);
            return null;
        }
    });
    
    win.set_child(glarea);
    win.present();
    // GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 1000, () => tick(glarea));
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => tick(glarea));
}

function main() {
    print("main");
    app = Gtk.Application.new('gjsify.examples.webgl-tutorial-01', Gio.ApplicationFlags.FLAGS_NONE);
    app.connect('activate', activate);
    app.run([]);
}

main();
