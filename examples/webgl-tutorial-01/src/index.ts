// https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Getting_started_with_WebGL
// https://github.com/mdn/dom-examples/tree/main/webgl-examples/tutorial/sample1

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { GjsifyHTMLCanvasElement, WebGLRenderingContext } from '@gjsify/webgl';

let app: Gtk.Application;

let rendered = false;

function render(glarea: Gtk.GLArea, gl: WebGLRenderingContext) {

    if (!rendered) {
        console.log("initial render");
        rendered = true;
        const ctx = glarea.get_context();
        console.error('Context: ' +
            `${ctx.get_required_version()} ES ${ctx.get_use_es()}`);
    }

    var error = glarea.get_error ();
    if(error !== null) {
        console.error (error.message);
        return false;
    }

    // Set clear color to black, fully opaque
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    // Clear the color buffer with specified clear color
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;

}

function tick(glarea: Gtk.GLArea) {
    glarea.queue_render();
    return true;
}

function activate(app: Gtk.Application) {
    console.log("activate");
    const win = new Gtk.ApplicationWindow(app);
    win.set_default_size(800, 600);
    const glarea = new Gtk.GLArea();

    glarea.set_use_es(true);
    glarea.set_required_version(3, 2);

    let gl: WebGLRenderingContext;
    glarea.connect('render', () => {
        if(!gl) {
            const canvas = new GjsifyHTMLCanvasElement(glarea);
            gl = canvas.getContext("webgl");
        }
        glarea.make_current();
        render(glarea, gl);
        return true;
    });
    
    win.set_child(glarea);
    win.present();
    // GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 1000, () => tick(glarea));
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => tick(glarea));
}

function main() {
    console.log("main");
    app = new Gtk.Application({
        application_id: 'gjsify.examples.webgl-tutorial-01',
        flags: Gio.ApplicationFlags.FLAGS_NONE,
    });
    app.connect('activate', activate);
    app.run([]);
}

main();
