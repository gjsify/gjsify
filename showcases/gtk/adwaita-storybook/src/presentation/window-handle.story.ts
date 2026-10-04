// Gtk.WindowHandle — a header bar that can be dragged, and the three titlebar clicks.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { windowHandleMeta } from './window-handle.meta.js';

/**
 * Story: a Gtk.WindowHandle around a header bar — the shape a window's titlebar takes.
 */
export class WindowHandleStory extends StoryWidget {
    private _handle: Gtk.WindowHandle | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookWindowHandle' }, WindowHandleStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(WindowHandleStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...windowHandleMeta, component: Gtk.WindowHandle.$gtype };
    }

    initialize(): void {
        const bar = new Adw.HeaderBar();
        bar.set_title_widget(new Adw.WindowTitle({ title: 'Notes' }));
        this._handle = new Gtk.WindowHandle({ child: bar, halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._handle);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        // READ, and cannot be honoured: the action a double click performs is the
        // `gtk-titlebar-double-click` SETTING, resolved by the compositor first
        // (`gdk_toplevel_titlebar_gesture`) and by `Gtk.Settings` where there is no answer
        // (gtkwindowhandle.c:282-333). A widget has no handle on either, so this story cannot
        // set it per instance; the web renderer takes the same value as an attribute, which is
        // the only door a document has.
        void this.args.action;
    }
}

GObject.type_ensure(WindowHandleStory.$gtype);

export const WindowHandleStories: StoryModule = { stories: [WindowHandleStory] };
