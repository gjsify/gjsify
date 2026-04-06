// Adwaita window for the Canvas 2D fireworks example.
// Uses a Blueprint template for the UI layout and Canvas2DWidget for 2D drawing.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { start, type FireworksDemo } from '../fireworks.js';
import Template from './fireworks-window.blp';

export class FireworksWindow extends Adw.ApplicationWindow {
    declare private _canvasContainer: Gtk.Box;
    declare private _particleCountRow: Adw.SpinRow;
    declare private _autoIntervalRow: Adw.SpinRow;
    declare private _maxBurstRadiusRow: Adw.SpinRow;
    declare private _autoFireworksRow: Adw.SwitchRow;
    declare private _splitView: Adw.OverlaySplitView;
    declare private _sidebarToggleButton: Gtk.ToggleButton;

    static {
        GObject.registerClass({
            GTypeName: 'FireworksWindow',
            Template,
            InternalChildren: [
                'canvasContainer', 'particleCountRow', 'autoIntervalRow',
                'maxBurstRadiusRow', 'autoFireworksRow', 'splitView',
                'sidebarToggleButton',
            ],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        // Set up SpinRow adjustments
        this._particleCountRow.set_adjustment(new Gtk.Adjustment({
            lower: 10, upper: 100, step_increment: 1, value: 30,
        }));

        this._autoIntervalRow.set_adjustment(new Gtk.Adjustment({
            lower: 50, upper: 1000, step_increment: 50, value: 200,
        }));

        this._maxBurstRadiusRow.set_adjustment(new Gtk.Adjustment({
            lower: 50, upper: 300, step_increment: 10, value: 160,
        }));

        // Create and insert Canvas 2D widget
        const canvasWidget = new Canvas2DWidget();
        canvasWidget.set_hexpand(true);
        canvasWidget.set_vexpand(true);
        canvasWidget.installGlobals(); // sets globalThis.requestAnimationFrame
        this._canvasContainer.append(canvasWidget);

        // Initialize fireworks when the 2D context is ready
        canvasWidget.onReady((canvas) => {
            canvas.width = canvasWidget.get_allocated_width();
            canvas.height = canvasWidget.get_allocated_height();

            const demo = start(canvas as any);
            this.connectControls(demo);
        });
    }

    private connectControls(demo: FireworksDemo) {
        this._particleCountRow.connect('notify::value', () => {
            demo.effectController.particleCount = this._particleCountRow.get_value();
        });

        this._autoIntervalRow.connect('notify::value', () => {
            demo.effectController.autoInterval = this._autoIntervalRow.get_value();
        });

        this._maxBurstRadiusRow.connect('notify::value', () => {
            demo.effectController.maxBurstRadius = this._maxBurstRadiusRow.get_value();
        });

        this._autoFireworksRow.connect('notify::active', () => {
            demo.effectController.autoFireworks = this._autoFireworksRow.active;
        });
    }
}
