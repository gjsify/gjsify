// Adwaita window for the Canvas 2D fireworks example.
// Uses a Blueprint template for the UI layout and Canvas2DBridge for 2D drawing.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { Canvas2DBridge } from '@gjsify/canvas2d';
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
    declare private _pauseButton: Gtk.Button;

    /** Live demo reference; set once the Canvas2DBridge is ready. */
    private _demo: FireworksDemo | null = null;

    static {
        GObject.registerClass({
            GTypeName: 'FireworksWindow',
            Template,
            InternalChildren: [
                'canvasContainer', 'particleCountRow', 'autoIntervalRow',
                'maxBurstRadiusRow', 'autoFireworksRow', 'splitView',
                'sidebarToggleButton', 'pauseButton',
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
        const canvasWidget = new Canvas2DBridge();
        canvasWidget.set_hexpand(true);
        canvasWidget.set_vexpand(true);
        canvasWidget.installGlobals(); // sets globalThis.requestAnimationFrame
        this._canvasContainer.append(canvasWidget);

        // Initialize fireworks when the 2D context is ready
        canvasWidget.onReady((canvas) => {
            canvasWidget.grab_focus();
            canvas.width = canvasWidget.get_allocated_width();
            canvas.height = canvasWidget.get_allocated_height();

            this._demo = start(canvas as any);
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
