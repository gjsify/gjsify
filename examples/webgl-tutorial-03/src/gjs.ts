import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { GjsifyHTMLCanvasElement, WebGLRenderingContext } from '@gjsify/webgl';
import { start } from './webgl-demo.js';

const mainloop = imports.mainloop;

let isFirstRenderCall = true;

function render(glarea: Gtk.GLArea) {
    if(isFirstRenderCall) {
        console.log("first render call");
        glarea.make_current();
        const canvas = new GjsifyHTMLCanvasElement(glarea);
        start(canvas);
    }
    isFirstRenderCall = false;
}

function activate(app: Gtk.Application) {
    const win = new Gtk.ApplicationWindow(app);
    win.set_default_size(800, 600);
    const glarea = new Gtk.GLArea();

    glarea.set_use_es(true);
    glarea.set_has_depth_buffer(true);
    glarea.set_has_stencil_buffer(true);

    // glarea.set_required_version(3, 2);

    // glarea.connect('realize', () => {
    //     console.log("realize");

    //     return true;
    // })

    glarea.connect('render', () => {
        render(glarea);
        return true;
    });
    
    win.set_child(glarea);
    win.present();
}

function main() {
    console.log("main");
    Gtk.init();
    const app = new Gtk.Application({
        application_id: 'gjsify.examples.webgl-tutorial-01',
        flags: Gio.ApplicationFlags.FLAGS_NONE,
    });
    app.connect('activate', activate);
    app.run([]);
    mainloop.run("");
}

main();
