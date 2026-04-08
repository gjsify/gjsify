// GJS/Adwaita window for the Excalibur Jelly Jumper showcase.
// Uses CanvasWebGLWidget (WebGL2) as primary renderer. If WebGL2 is
// unavailable (no GPU), falls back to Canvas2DWidget (Cairo) on startup —
// mirroring the browser's WebGL→Canvas2D fallback path.

import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { CanvasWebGLWidget } from '@gjsify/webgl';
import { Canvas2DWidget } from '@gjsify/canvas2d';
import { startGame, type GameHandle } from '../game.js';
import Template from './jelly-jumper-window.blp';

export class JellyJumperWindow extends Adw.ApplicationWindow {
    declare private _canvasContainer: Gtk.Box;
    declare private _pauseButton: Gtk.Button;

    private _game: GameHandle | null = null;

    static {
        GObject.registerClass({
            GTypeName: 'JellyJumperWindow',
            Template,
            InternalChildren: ['canvasContainer', 'pauseButton'],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });
        this._startWithWidget(false);
    }

    private _startWithWidget(useFallback: boolean): void {
        // Remove any existing widget from the container (fallback restart)
        let child = this._canvasContainer.get_first_child();
        while (child) {
            this._canvasContainer.remove(child);
            child = this._canvasContainer.get_first_child();
        }

        // Derive the bundle directory for file:// asset resolution.
        // import.meta.url points to the bundle file; dirname gives the dist/ dir.
        const bundleDir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
        const baseUrl = 'file://' + bundleDir;

        if (useFallback) {
            // Canvas 2D fallback (CPU/Cairo) — same API surface, no WebGL
            const widget = new Canvas2DWidget();
            widget.set_hexpand(true);
            widget.set_vexpand(true);
            widget.installGlobals();
            this._canvasContainer.append(widget);

            widget.onReady((canvas) => {
                canvas.width = widget.get_allocated_width();
                canvas.height = widget.get_allocated_height();

                widget.onResize((w, h) => {
                    canvas.width = w;
                    canvas.height = h;
                    this._game?.engine.screen.applyResolutionAndViewport();
                });

                startGame(canvas as any, baseUrl)
                    .then(game => { this._game = game; })
                    .catch(err => {
                        console.error('JellyJumper: Canvas 2D fallback also failed:', err?.message ?? err, err?.stack ?? '');
                    });
            });
        } else {
            // Primary path: WebGL2 (GPU)
            const widget = new CanvasWebGLWidget();
            widget.set_hexpand(true);
            widget.set_vexpand(true);
            widget.installGlobals();
            this._canvasContainer.append(widget);

            widget.onReady((canvas) => {
                canvas.width = widget.get_allocated_width();
                canvas.height = widget.get_allocated_height();

                widget.connect('resize', (_w: any, w: number, h: number) => {
                    canvas.width = w;
                    canvas.height = h;
                    this._game?.engine.screen.applyResolutionAndViewport();
                });

                startGame(canvas as any, baseUrl)
                    .then(game => { this._game = game; })
                    .catch(err => {
                        console.error('JellyJumper: WebGL start failed, trying Canvas 2D fallback:', err?.message ?? err, err?.stack ?? '');
                        this._startWithWidget(true);
                    });
            });
        }

        // Pause/Resume button — toggles game state and swaps icon
        this._pauseButton.connect('clicked', () => {
            if (!this._game) return;
            if (this._game.isPaused) {
                this._game.resume();
                this._pauseButton.set_icon_name('media-playback-pause-symbolic');
                this._pauseButton.set_tooltip_text('Pause Game');
            } else {
                this._game.pause();
                this._pauseButton.set_icon_name('media-playback-start-symbolic');
                this._pauseButton.set_tooltip_text('Resume Game');
            }
        });
    }
}
