import GObject from 'gi://GObject?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { WebGLBridge } from '@gjsify/webgl';
import { Canvas2DBridge } from '@gjsify/canvas2d';
import { startGame } from './game.js';
import Template from './main-window.blp';

export class MainWindow extends Adw.ApplicationWindow {
    declare private _canvasContainer: Gtk.Box;

    static {
        GObject.registerClass(
            {
                GTypeName: 'MainWindow',
                Template,
                InternalChildren: ['canvasContainer'],
            },
            this,
        );
    }

    constructor(application: Adw.Application) {
        super({ application });
        this._startWithWidget(false);
    }

    private _startWithWidget(useFallback: boolean): void {
        let child = this._canvasContainer.get_first_child();
        while (child) {
            this._canvasContainer.remove(child);
            child = this._canvasContainer.get_first_child();
        }

        const widget = useFallback ? new Canvas2DBridge() : new WebGLBridge();
        widget.set_hexpand(true);
        widget.set_vexpand(true);
        widget.installGlobals();
        this._canvasContainer.append(widget);

        widget.onReady((canvas) => {
            widget.grab_focus();
            canvas.width = widget.get_allocated_width();
            canvas.height = widget.get_allocated_height();
            startGame(canvas).catch((err: Error) => {
                if (useFallback) {
                    console.error('Canvas 2D fallback also failed:', err.message);
                } else {
                    console.error('WebGL start failed, trying Canvas 2D fallback:', err.message);
                    this._startWithWidget(true);
                }
            });
        });
    }
}
