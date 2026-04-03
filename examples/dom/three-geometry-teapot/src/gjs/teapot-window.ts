// Adwaita window for the three.js teapot example.
// Uses a Blueprint template for the UI layout and CanvasWebGLWidget for WebGL.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { CanvasWebGLWidget } from '@gjsify/webgl';
import { start, TESS_VALUES, SHADING_VALUES, DEFAULT_TESS_INDEX, DEFAULT_SHADING_INDEX, type TeapotDemo } from '../three-demo.js';
import Template from './teapot-window.blp';

export class TeapotWindow extends Adw.ApplicationWindow {
    declare private _glAreaContainer: Gtk.Box;
    declare private _tessRow: Adw.ComboRow;
    declare private _lidRow: Adw.SwitchRow;
    declare private _bodyRow: Adw.SwitchRow;
    declare private _bottomRow: Adw.SwitchRow;
    declare private _fitLidRow: Adw.SwitchRow;
    declare private _nonblinnRow: Adw.SwitchRow;
    declare private _shadingRow: Adw.ComboRow;

    static {
        GObject.registerClass({
            GTypeName: 'TeapotWindow',
            Template,
            InternalChildren: [
                'glAreaContainer', 'tessRow', 'lidRow', 'bodyRow',
                'bottomRow', 'fitLidRow', 'nonblinnRow', 'shadingRow',
            ],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        // Set up ComboRow models
        this._tessRow.set_model(Gtk.StringList.new(TESS_VALUES.map(String)));
        this._tessRow.set_selected(DEFAULT_TESS_INDEX);

        this._shadingRow.set_model(Gtk.StringList.new([...SHADING_VALUES]));
        this._shadingRow.set_selected(DEFAULT_SHADING_INDEX);

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
            const ctx = glArea.get_context()!;
            print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ${ctx.get_version().join('.')}`);

            const demo = start(canvas);
            this.connectControls(demo);
        });
    }

    private connectControls(demo: TeapotDemo) {
        this._tessRow.connect('notify::selected', () => {
            demo.effectController.newTess = TESS_VALUES[this._tessRow.selected];
            demo.render();
        });

        this._shadingRow.connect('notify::selected', () => {
            demo.effectController.newShading = SHADING_VALUES[this._shadingRow.selected];
            demo.render();
        });

        this._lidRow.connect('notify::active', () => {
            demo.effectController.lid = this._lidRow.active;
            demo.render();
        });

        this._bodyRow.connect('notify::active', () => {
            demo.effectController.body = this._bodyRow.active;
            demo.render();
        });

        this._bottomRow.connect('notify::active', () => {
            demo.effectController.bottom = this._bottomRow.active;
            demo.render();
        });

        this._fitLidRow.connect('notify::active', () => {
            demo.effectController.fitLid = this._fitLidRow.active;
            demo.render();
        });

        this._nonblinnRow.connect('notify::active', () => {
            demo.effectController.nonblinn = this._nonblinnRow.active;
            demo.render();
        });
    }
}
