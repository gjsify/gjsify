import '@gjsify/types/index';
import { System } from '@gjsify/types/Gjs';
import Gtk from '@gjsify/types/Gtk-4.0';
import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';
import GdkPixbuf from '@gjsify/types/GdkPixbuf-2.0';
import { GjsifyHTMLCanvasElement, WebGLRenderingContext } from '@gjsify/webgl';

import { main } from './webgl-demo.js';

let canvas: GjsifyHTMLCanvasElement | null = null;
let renderTag: number | null = null;
let animationTag: number | null = null;
let renderCallback: FrameRequestCallback | null = null;

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

function onActivate(app: Gtk.Application, firstRenderCb: (canvas: GjsifyHTMLCanvasElement, gl: WebGLRenderingContext, image: GdkPixbuf.Pixbuf) => void ) {
    try {
        const dir = GLib.path_get_dirname(System.programInvocationName);
        const filename = GLib.build_filenamev([dir, '..', 'cubetexture.png']);

        const image = GdkPixbuf.Pixbuf.new_from_file(filename);
        const win = Gtk.ApplicationWindow.new(app);
        win.set_default_size(800, 600);
        const glarea = new Gtk.GLArea();

        glarea.set_has_depth_buffer(true);
        glarea.set_use_es(true);
        glarea.set_required_version(3, 2);
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
                firstRenderCb(canvas, gl, image);
            } catch (e) {
                logError(e);
            }
            return true;
        });
        glarea.set_size_request(800, 600);
        win.set_child(glarea);
        win.present();

    } catch (e) {
        logError(e);
    }
}

// This doesn't return until the app quits because it calls app.run(). Instead
// the supplied cb is called with a GtkGLArea and a WebGLRenderingContext. The
// callback should render the first frame, then call requestAnimationFrame as
// appropriate.
export function startApp(id: string, cb: (canvas: GjsifyHTMLCanvasElement, gl: WebGLRenderingContext, image: GdkPixbuf.Pixbuf) => void) {
    const app = Gtk.Application.new('gjsify.examples.webgl-tutorial-07.' + id, 
        Gio.ApplicationFlags.FLAGS_NONE);
    app.connect('activate', () => {
        onActivate(app, cb);
    });
    app.run(null);
}

function onFirstRender(canvas: GjsifyHTMLCanvasElement, gl: WebGLRenderingContext, image: GdkPixbuf.Pixbuf) {
    const ctx = canvas._getGlArea().get_context()
    print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ` +
        ctx.get_version().join('.'));
    main(canvas, gl, image);
}

function alert(message) {
    printerr('alert: ' + message);
}

globalThis.requestAnimationFrame = requestAnimationFrame;
globalThis.alert = alert;
startApp('demo', onFirstRender);
