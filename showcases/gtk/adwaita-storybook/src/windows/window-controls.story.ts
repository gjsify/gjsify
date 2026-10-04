// Gtk.WindowControls — the frame buttons of ONE side, and the window properties each token
// reads. A Gtk.WindowControls outside a Gtk.Window draws NOTHING (gtkwindowcontrols.c:257-264),
// which is why this story is a window rather than a bare widget.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { windowControlsMeta } from './window-controls.meta.js';

/** Story: a Gtk.WindowControls in the titlebar of a real Gtk.Window, driven by args. */
export class WindowControlsStory extends StoryWidget {
    private _window: Gtk.Window | null = null;
    private _controls: Gtk.WindowControls | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookWindowControls' }, WindowControlsStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(WindowControlsStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...windowControlsMeta, component: Gtk.WindowControls.$gtype };
    }

    initialize(): void {
        this._window = new Gtk.Window({ title: 'Documents', default_width: 420, default_height: 220 });
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        box.append(new Gtk.Label({ label: 'The bar draws nothing outside a window.', css_classes: ['dimmed'] }));
        this._window.set_child(box);

        // A window with NO titlebar of its own, so the controls really are the titlebar —
        // which is the shape `update_window_buttons` reads its four window properties for.
        this._controls = new Gtk.WindowControls();
        this._window.set_titlebar(this._controls);

        this.addContent(this._window);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._window || !this._controls) return;
        const side = (this.args.side as string) === 'end' ? Gtk.PackType.END : Gtk.PackType.START;
        this._controls.side = side;
        this._controls.decoration_layout = this.args.decorationLayout as string;
        // `update_window_buttons` (:270-274) reads exactly these four off the root.
        this._window.resizable = this.args.resizable as boolean;
        this._window.maximized = this.args.maximized as boolean;
        this._window.modal = this.args.modal as boolean;
    }
}

GObject.type_ensure(WindowControlsStory.$gtype);

export const WindowControlsStories: StoryModule = { stories: [WindowControlsStory] };
