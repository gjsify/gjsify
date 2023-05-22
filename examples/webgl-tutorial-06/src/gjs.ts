// WORKAROUND: for error "EventTarget is undefined"
import '@gjsify/deno-runtime/globals';
import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { Image as GjsifyImage } from '@gjsify/html-image-element';
import { GjsifyHTMLCanvasElement } from '@gjsify/webgl';
import { start } from './webgl-demo.js';

const mainloop = imports.mainloop;

let renderTag: number | null = null;
let animationTag: number | null = null;
let renderCallback: FrameRequestCallback | null = null;
let canvas: GjsifyHTMLCanvasElement | null = null;

export function alert(...args: any[]) {
    console.error('alert: ', ...args);
}

export function requestAnimationFrame(cb: FrameRequestCallback) {
    renderCallback = cb;
    if (animationTag === null && canvas) {
        animationTag = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (animationTag) {
                GLib.source_remove(animationTag);
                animationTag = null;
            }
            if (renderTag === null) {
                renderTag = canvas._getGlArea().connect('render', () => {
                    if (renderTag !== null) {
                        canvas._getGlArea().disconnect(renderTag);
                        renderTag = null;
                    }
                    if (renderCallback) {
                        renderCallback(GLib.get_monotonic_time() / 1000);
                        return true;
                    }
                    return false;
                });
            }
            canvas._getGlArea().queue_render();
            return false;
        });
    }
    return 0;
}

function onActivate(app: Gtk.Application, firstRenderCb: (canvas: GjsifyHTMLCanvasElement) => void) {
    const win = new Gtk.ApplicationWindow(app);
    win.set_default_size(800, 600);
    const glarea = new Gtk.GLArea();

    glarea.connect('unrealize', () => {
        if (renderTag !== null) {
            glarea.disconnect(renderTag);
            renderTag = null;
        }
        if (animationTag !== null) {
            GLib.source_remove(animationTag);
            animationTag = null;
        }
        canvas = null;
    });

    const renderId = glarea.connect('render', () => {
        try {            
            glarea.disconnect(renderId);
            glarea.make_current();
            canvas = new GjsifyHTMLCanvasElement(glarea);
            const gl = canvas.getContext("webgl");
            firstRenderCb(canvas);
        } catch (e) {
            logError(e);
        }
        return true;
    });

    glarea.set_use_es(true);
    glarea.set_has_depth_buffer(true);
    glarea.set_has_stencil_buffer(true);
    glarea.set_required_version(3, 2);
    
    win.set_child(glarea);
    win.present();

    glarea.queue_render();
}

function onFirstRender(canvas: GjsifyHTMLCanvasElement) {
    const ctx = canvas._getGlArea().get_context()
    print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ` +
        ctx.get_version().join('.'));
        start(canvas);
}

function main() {
    Gtk.init();
    const app = new Gtk.Application({
        application_id: 'gjsify.examples.webgl-tutorial-06',
        flags: Gio.ApplicationFlags.FLAGS_NONE,
    });
    app.connect('activate', () => {
        onActivate(app, onFirstRender);
    });
    app.run([]);
    mainloop.run("");
}

globalThis.alert = alert;
globalThis.requestAnimationFrame = requestAnimationFrame;
// TODO move this to web globals
globalThis.Image = GjsifyImage as any as typeof Image;

main();
