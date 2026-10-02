// Gtk.GLArea — the widget whose contents are drawn on a GPU.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { glAreaMeta } from './gl-area.meta.js';

/** 33 ms is about thirty frames a second, the tick GTK's own demos use. */
const TICK_MS = 33;

/**
 * Story: a Gtk.GLArea whose lifecycle is the subject — `::resize` before the first
 * `::render`, `queue_render()` from a tick, and the two flags bound to args.
 *
 * WHAT THIS STORY DOES NOT DRAW, AND WHY. Painting the triangle needs `gi://GL` calls
 * (`glCreateShader`, `glDrawArrays`, …), and a GL binding is not one of this storybook's
 * dependencies — every other story here is widget-shaped, and importing a binding to fill
 * one would make the one GL widget the one that cannot be built. So the area renders
 * nothing and the readout below it shows what the SIGNALS did: the device-pixel viewport
 * from `::resize`, and how many frames `::render` produced. The browser story draws the
 * same triangle for real, because a `<canvas>` has WebGL built in.
 */
export class GLAreaStory extends StoryWidget {
    private _area: Gtk.GLArea | null = null;
    private _readout: Gtk.Label | null = null;
    private _box: Gtk.Box | null = null;
    private _tick = 0;
    private _renders = 0;
    private _viewport = '—';

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGLArea' }, GLAreaStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GLAreaStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...glAreaMeta, component: Gtk.GLArea.$gtype };
    }

    initialize(): void {
        this._area = new Gtk.GLArea({ widthRequest: 240, heightRequest: 160 });
        this._readout = new Gtk.Label({ label: '—' });
        this._readout.add_css_class('dimmed');

        // `::resize` comes BEFORE the first `::render` and on every later allocation: the
        // order a GL program depends on to know its viewport (gtkglarea.c:797-807). The
        // numbers are DEVICE pixels — `w = width * scale` (:761-763).
        this._area.connect('resize', (_area, width: number, height: number) => {
            this._viewport = `${width} × ${height}`;
            this._refresh();
        });
        this._area.connect('render', () => {
            this._renders += 1;
            this._refresh();
        });

        this._box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
        this._box.append(this._area);
        this._box.append(this._readout);
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._stop();
        this._apply();
        this._start();
    }

    private _apply(): void {
        if (!this._area) return;
        // `allowed_apis` REFUSES a realized area (`g_return_if_fail (!realized)`,
        // gtkglarea.c:1242), so it belongs before the first render, not after it.
        this._area.allowed_apis = this.args.allowedApis === 'gles' ? Gdk.GLAPI.GLES : Gdk.GLAPI.GL | Gdk.GLAPI.GLES;
        this._area.auto_render = this.args.autoRender as boolean;
        this._area.has_depth_buffer = this.args.hasDepthBuffer as boolean;
    }

    /**
     * `queue_render()` is how a GL application asks for the next frame (gtkglarea.c:1465):
     * the flag is set and a redraw queued, and `::render` runs on that frame. Nothing here
     * redraws on its own, which is the point — `auto-render` decides whether a draw the
     * element was asked for ends in `::render`, not whether frames appear.
     */
    private _start(): void {
        if (!this._area || !this.args.spinning) return;
        this._tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            this._area?.queue_render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    private _stop(): void {
        if (this._tick === 0) return;
        GLib.source_remove(this._tick);
        this._tick = 0;
    }

    private _refresh(): void {
        if (!this._readout) return;
        this._readout.label = `viewport ${this._viewport} device px · ${this._renders} renders`;
    }
}

GObject.type_ensure(GLAreaStory.$gtype);

export const GLAreaStories: StoryModule = { stories: [GLAreaStory] };
