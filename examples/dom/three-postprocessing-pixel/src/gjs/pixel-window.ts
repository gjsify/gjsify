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

    static {
        GObject.registerClass({
            GTypeName: 'PixelWindow',
            Template,
            InternalChildren: [
                'glAreaContainer', 'pixelSizeRow', 'normalEdgeRow',
                'depthEdgeRow', 'pixelAlignRow',
            ],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        // Set up SpinRow adjustments
        this._pixelSizeRow.set_adjustment(new Gtk.Adjustment({
            lower: 1, upper: 16, step_increment: 1, value: 6,
        }));

        this._normalEdgeRow.set_adjustment(new Gtk.Adjustment({
            lower: 0, upper: 2, step_increment: 0.05, value: 0.3,
        }));

        this._depthEdgeRow.set_adjustment(new Gtk.Adjustment({
            lower: 0, upper: 1, step_increment: 0.05, value: 0.4,
        }));

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
            const bundleDir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
            const assetBase = `file://${bundleDir}/`;

            const demo = start(canvas, { assetBase });
            this.connectControls(demo);
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
