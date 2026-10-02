// Gtk.Window — a toplevel, its titlebar, and the properties that decide what the frame shows.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { windowMeta } from './window.meta.js';

/** Story: a real Gtk.Window whose frame properties are all driven by args. */
export class WindowStory extends StoryWidget {
    private _window: Gtk.Window | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookWindow' }, WindowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(WindowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...windowMeta, component: Gtk.Window.$gtype };
    }

    initialize(): void {
        this._window = new Gtk.Window({ default_width: 460, default_height: 280 });

        // `decorated: false` DROPS the titlebar outright (gtkwindow.c:1014), so the story
        // keeps the bar in the TREE and lets the property decide whether it is seen.
        const bar = new Gtk.HeaderBar();
        this._window.set_titlebar(bar);

        const body = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12,
            margin_start: 12,
        });
        body.append(new Gtk.Label({ label: 'The frame above is a Gtk.HeaderBar.', css_classes: ['dimmed'] }));
        this._window.set_child(body);

        this.addContent(this._window);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._window) return;
        this._window.title = this.args.title as string;
        this._window.decorated = this.args.decorated as boolean;
        this._window.deletable = this.args.deletable as boolean;
        this._window.resizable = this.args.resizable as boolean;
        this._window.maximized = this.args.maximized as boolean;
        this._window.modal = this.args.modal as boolean;
        this._window.hide_on_close = this.args.hideOnClose as boolean;
    }
}

GObject.type_ensure(WindowStory.$gtype);

export const WindowStories: StoryModule = { stories: [WindowStory] };
