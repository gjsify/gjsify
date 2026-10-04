// Adw.ClampScrollable — a clamp around a scrolling child.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { clampScrollableMeta } from './clamp-scrollable.meta.js';

const LINES = Array.from({ length: 24 }, (_, i) => `Line ${i + 1}: held at the clamp's width while it scrolls.`);

/** Story: a Gtk.TextView (a Gtk.Scrollable) inside an Adw.ClampScrollable inside a scrolled window. */
export class ClampScrollableStory extends StoryWidget {
    private _clamp: Adw.ClampScrollable | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookClampScrollable' }, ClampScrollableStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ClampScrollableStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...clampScrollableMeta, component: Adw.ClampScrollable.$gtype };
    }

    initialize(): void {
        const text = new Gtk.TextView({ editable: false, cursorVisible: false, topMargin: 12, bottomMargin: 12 });
        text.buffer.set_text(LINES.join('\n'), -1);

        this._clamp = new Adw.ClampScrollable({
            maximumSize: this.args.maximumSize as number,
            tighteningThreshold: this.args.tighteningThreshold as number,
            child: text,
        });

        const scrolled = new Gtk.ScrolledWindow({ child: this._clamp, widthRequest: 640, heightRequest: 240 });
        this.addContent(scrolled);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._clamp) return;
        this._clamp.maximumSize = this.args.maximumSize as number;
        this._clamp.tighteningThreshold = this.args.tighteningThreshold as number;
    }
}

GObject.type_ensure(ClampScrollableStory.$gtype);

export const ClampScrollableStories: StoryModule = { stories: [ClampScrollableStory] };
