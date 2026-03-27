// GJS/GTK4 entry point for three-geometry-cube example.
// Adapted from examples/gtk/webgl-tutorial-07/src/gjs.ts

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { WebGLArea } from '@gjsify/webgl';
// globalThis.Image is set automatically by @gjsify/dom-elements (imported transitively via @gjsify/webgl)
import { start } from './three-demo.js';

// Minimal browser globals required by three.js
globalThis.alert = (...args: any[]) => console.error('alert:', ...args);
(globalThis as any).devicePixelRatio = 1;
// three.js checks `typeof self !== 'undefined'` to set its animation context;
// without this, WebGLAnimation.context stays null and requestAnimationFrame fails.
(globalThis as any).self = globalThis;

const app = new Gtk.Application({
    application_id: 'gjsify.examples.three-geometry-cube',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);

    // Expose window dimensions that three.js may read for aspect ratio
    Object.defineProperty(globalThis, 'innerWidth', {
        get: () => win.get_width(),
        configurable: true,
    });
    Object.defineProperty(globalThis, 'innerHeight', {
        get: () => win.get_height(),
        configurable: true,
    });

    const glArea = new WebGLArea();
    glArea.installGlobals(); // sets globalThis.requestAnimationFrame

    glArea.onWebGLReady((canvas) => {
        const ctx = glArea.get_context()!;
        print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ${ctx.get_version().join('.')}`);
        start(canvas as any);
    });

    win.set_child(glArea);
    win.present();
});

app.run([]);
