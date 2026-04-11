// Adwaita window for the pixel post-processing example.
// Uses a Blueprint template for the UI layout and CanvasWebGLWidget for WebGL.
// Ported from refs/three/examples/webgl_postprocessing_pixel.html
// Original: MIT license, three.js authors (https://threejs.org)

import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { CanvasWebGLWidget } from '@gjsify/webgl';
import { start, type PixelDemo } from '../three-demo.js';
import Template from './pixel-window.blp';

export class PixelWindow extends Adw.ApplicationWindow {
    declare private _glAreaContainer: Gtk.Box;
    declare private _pixelSizeRow: Adw.SpinRow;
    declare private _normalEdgeRow: Adw.SpinRow;
    declare private _depthEdgeRow: Adw.SpinRow;
    declare private _pixelAlignRow: Adw.SwitchRow;
    declare private _splitView: Adw.OverlaySplitView;
    declare private _sidebarToggleButton: Gtk.ToggleButton;
    declare private _pauseButton: Gtk.Button;

    /** Live demo reference; set once the CanvasWebGLWidget is ready. */
    private _demo: PixelDemo | null = null;

    static {
        GObject.registerClass({
            GTypeName: 'PixelWindow',
            Template,
            InternalChildren: [
                'glAreaContainer', 'pixelSizeRow', 'normalEdgeRow',
                'depthEdgeRow', 'pixelAlignRow', 'splitView',
                'sidebarToggleButton', 'pauseButton',
            ],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        // Set up SpinRow adjustments
        this._pixelSizeRow.set_adjustment(new Gtk.Adjustment({
            lower: 1, upper: 16, step_increment: 1, value: 4,
        }));

        this._normalEdgeRow.set_adjustment(new Gtk.Adjustment({
            lower: 0, upper: 2, step_increment: 0.05, value: 0.3,
        }));
        this._normalEdgeRow.set_digits(2);

        this._depthEdgeRow.set_adjustment(new Gtk.Adjustment({
            lower: 0, upper: 1, step_increment: 0.05, value: 0.4,
        }));
        this._depthEdgeRow.set_digits(2);

        // Create and insert WebGL widget
        const glArea = new CanvasWebGLWidget();
        glArea.set_hexpand(true);
        glArea.set_vexpand(true);
        glArea.installGlobals();
        this._glAreaContainer.append(glArea);

        // Expose GL area dimensions as innerWidth/innerHeight for three.js
        Object.defineProperty(globalThis, 'innerWidth', {
            get: () => glArea.get_allocated_width(),
            configurable: true,
        });
        Object.defineProperty(globalThis, 'innerHeight', {
            get: () => glArea.get_allocated_height(),
            configurable: true,
        });

        // Initialize three.js when GL context is ready
        glArea.onReady((canvas) => {
            glArea.grab_focus();
            // Sync canvas dimensions with GTK widget allocation so the
            // three.js resize check in the animation loop picks up changes
            // (e.g. when the sidebar is toggled).
            const syncSize = (_widget: any, w: number, h: number) => {
                canvas.width = w;
                canvas.height = h;
            };
            canvas.width = glArea.get_allocated_width();
            canvas.height = glArea.get_allocated_height();
            glArea.connect('resize', syncSize);

            const bundleDir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
            const assetBase = `file://${bundleDir}/`;

            this._demo = start(canvas, { assetBase });
            this.connectControls(this._demo);
        });

        // Pause/Resume button — toggles demo state and swaps the icon.
        this._pauseButton.connect('clicked', () => {
            if (!this._demo) return;
            if (this._demo.isPaused) {
                this._demo.resume();
                this._pauseButton.set_icon_name('media-playback-pause-symbolic');
                this._pauseButton.set_tooltip_text('Pause Rendering');
            } else {
                this._demo.pause();
                this._pauseButton.set_icon_name('media-playback-start-symbolic');
                this._pauseButton.set_tooltip_text('Resume Rendering');
            }
        });
    }

    private connectControls(demo: PixelDemo) {
        this._pixelSizeRow.connect('notify::value', () => {
            demo.effectController.pixelSize = this._pixelSizeRow.get_value();
        });

        this._normalEdgeRow.connect('notify::value', () => {
            demo.effectController.normalEdgeStrength = this._normalEdgeRow.get_value();
        });

        this._depthEdgeRow.connect('notify::value', () => {
            demo.effectController.depthEdgeStrength = this._depthEdgeRow.get_value();
        });

        this._pixelAlignRow.connect('notify::active', () => {
            demo.effectController.pixelAlignedPanning = this._pixelAlignRow.active;
        });
    }
}
