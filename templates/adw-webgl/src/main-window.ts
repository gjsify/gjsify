import GObject from 'gi://GObject?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { WebGLBridge } from '@gjsify/webgl';
import { startScene } from './scene.js';
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

        const glArea = new WebGLBridge();
        glArea.set_hexpand(true);
        glArea.set_vexpand(true);
        glArea.installGlobals();
        this._canvasContainer.append(glArea);

        glArea.onReady((canvas) => {
            canvas.width = glArea.get_allocated_width();
            canvas.height = glArea.get_allocated_height();
            startScene(canvas);
        });
    }
}
