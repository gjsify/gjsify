import GObject from 'gi://GObject?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { startAnimation } from './draw.js';
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

        const canvasWidget = new Canvas2DWidget();
        canvasWidget.set_hexpand(true);
        canvasWidget.set_vexpand(true);
        canvasWidget.installGlobals();
        this._canvasContainer.append(canvasWidget);

        canvasWidget.onReady((canvas) => {
            canvas.width = canvasWidget.get_allocated_width();
            canvas.height = canvasWidget.get_allocated_height();
            startAnimation(canvas);
        });
    }
}
