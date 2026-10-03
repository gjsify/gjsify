// Gtk.Viewport — a column in a window that clips it, with the focus behaviour bound to args.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { viewportMeta } from './viewport.meta.js';

/** Story: a Gtk.Viewport over a column of labels and a focusable button at its end. */
export class ViewportStory extends StoryWidget {
    private _viewport: Gtk.Viewport | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookViewport' }, ViewportStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ViewportStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...viewportMeta, component: Gtk.Viewport.$gtype };
    }

    initialize(): void {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        for (let i = 1; i <= 16; i++) {
            box.append(new Gtk.Label({ label: `Row ${i}` }));
        }
        // The one widget whose focus a viewport acts on, so the property has something to
        // reveal: with it off, tabbing to the button leaves it below the edge.
        box.append(new Gtk.Button({ label: 'Focus me', halign: Gtk.Align.START }));
        this._viewport = new Gtk.Viewport({
            child: box,
            min_content_height: 240,
            halign: Gtk.Align.CENTER,
        });
        this._apply();
        this.addContent(this._viewport);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._viewport) return;
        this._viewport.set_scroll_to_focus(this.args.scrollToFocus as boolean);
    }
}

GObject.type_ensure(ViewportStory.$gtype);

export const ViewportStories: StoryModule = { stories: [ViewportStory] };
