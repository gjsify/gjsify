// Adwaita window for the three.js teapot example.
// Uses a Blueprint template for the UI layout and WebGLBridge for WebGL.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { WebGLBridge } from '@gjsify/webgl';
import {
    start,
    TESS_VALUES,
    SHADING_VALUES,
    DEFAULT_TESS_INDEX,
    DEFAULT_SHADING_INDEX,
    type TeapotDemo,
} from '../three-demo.js';
import Template, { type Children, GTypeName, InternalChildren } from './teapot-window.blp';

// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: GJS installs the internal children (ADR 0087)
export interface TeapotWindow extends Children {}
export class TeapotWindow extends Adw.ApplicationWindow {
    /** Live demo reference; set once the WebGLBridge is ready. */
    private _demo: TeapotDemo | null = null;

    static {
        GObject.registerClass(
            {
                GTypeName,
                Template,
                InternalChildren,
            },
            this,
        );
    }

    constructor(application: Adw.Application) {
        super({ application });

        // Set up ComboRow models
        this._tessRow.set_model(Gtk.StringList.new(TESS_VALUES.map(String)));
        this._tessRow.set_selected(DEFAULT_TESS_INDEX);

        this._shadingRow.set_model(Gtk.StringList.new([...SHADING_VALUES]));
        this._shadingRow.set_selected(DEFAULT_SHADING_INDEX);

        // Create and insert WebGL widget
        const glArea = new WebGLBridge();
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
            const ctx = glArea.get_context()!;
            print(`Context version: OpenGL${ctx.get_use_es() ? ' ES' : ''} ${ctx.get_version().join('.')}`);

            this._demo = start(canvas);
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
