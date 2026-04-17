// Adwaita window for the LDraw loader example.
// Uses a Blueprint template for the UI layout and WebGLBridge for WebGL.
// Ported from refs/three/examples/webgl_loader_ldraw.html
// Original: MIT license, three.js authors (https://threejs.org)
// This software uses the LDraw Parts Library (http://www.ldraw.org), CC BY 2.0.

import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { WebGLBridge } from '@gjsify/webgl';
import { start, MODEL_LIST, DEFAULT_MODEL_INDEX, type LDrawDemo } from '../three-demo.js';
import Template from './ldraw-window.blp';

export class LDrawWindow extends Adw.ApplicationWindow {
    declare private _glAreaContainer: Gtk.Box;
    declare private _modelRow: Adw.ComboRow;
    declare private _flatColorsRow: Adw.SwitchRow;
    declare private _mergeModelRow: Adw.SwitchRow;
    declare private _smoothNormalsRow: Adw.SwitchRow;
    declare private _buildingStepRow: Adw.SpinRow;
    declare private _displayLinesRow: Adw.SwitchRow;
    declare private _conditionalLinesRow: Adw.SwitchRow;

    static {
        GObject.registerClass({
            GTypeName: 'LDrawWindow',
            Template,
            InternalChildren: [
                'glAreaContainer', 'modelRow', 'flatColorsRow', 'mergeModelRow',
                'smoothNormalsRow', 'buildingStepRow', 'displayLinesRow', 'conditionalLinesRow',
            ],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        // Model ComboRow
        this._modelRow.set_model(Gtk.StringList.new(MODEL_LIST.map(m => m.name)));
        this._modelRow.set_selected(DEFAULT_MODEL_INDEX);

        // Building step SpinRow (initial range, updated on model load)
        this._buildingStepRow.set_adjustment(new Gtk.Adjustment({
            lower: 0, upper: 0, step_increment: 1, value: 0,
        }));

        // Create and insert WebGL widget
        const glArea = new WebGLBridge();
        glArea.set_hexpand(true);
        glArea.set_vexpand(true);
        glArea.installGlobals();
        this._glAreaContainer.append(glArea);

        Object.defineProperty(globalThis, 'innerWidth', {
            get: () => glArea.get_allocated_width(),
            configurable: true,
        });
        Object.defineProperty(globalThis, 'innerHeight', {
            get: () => glArea.get_allocated_height(),
            configurable: true,
        });

        glArea.onReady((canvas) => {
            // Resolve asset base to file:// URI relative to the GJS bundle location
            const bundleDir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
            const assetBase = `file://${bundleDir}/`;

            const demo = start(canvas, { assetBase }, (numSteps) => {
                // Update building step range on model load
                const adj = this._buildingStepRow.get_adjustment();
                adj.set_upper(numSteps - 1);
                adj.set_value(numSteps - 1);
            });
            this.connectControls(demo);
        });
    }

    private connectControls(demo: LDrawDemo) {
        this._modelRow.connect('notify::selected', () => {
            demo.effectController.modelIndex = this._modelRow.selected;
            demo.reloadObject(true);
        });

        this._flatColorsRow.connect('notify::active', () => {
            demo.effectController.flatColors = this._flatColorsRow.active;
            demo.reloadObject(false);
        });

        this._mergeModelRow.connect('notify::active', () => {
            demo.effectController.mergeModel = this._mergeModelRow.active;
            demo.reloadObject(false);
        });

        this._smoothNormalsRow.connect('notify::active', () => {
            demo.effectController.smoothNormals = this._smoothNormalsRow.active;
            demo.reloadObject(false);
        });

        this._buildingStepRow.connect('notify::value', () => {
            demo.effectController.buildingStep = this._buildingStepRow.get_value();
            demo.updateVisibility();
        });

        this._displayLinesRow.connect('notify::active', () => {
            demo.effectController.displayLines = this._displayLinesRow.active;
            demo.updateVisibility();
        });

        this._conditionalLinesRow.connect('notify::active', () => {
            demo.effectController.conditionalLines = this._conditionalLinesRow.active;
            demo.updateVisibility();
        });
    }
}
