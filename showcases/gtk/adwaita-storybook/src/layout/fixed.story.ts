// Gtk.Fixed — children at pixel positions.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { fixedMeta } from './fixed.meta.js';

/** Story: two labels in a Gtk.Fixed, both moved to the offsets the args carry. */
export class FixedStory extends StoryWidget {
    private _fixed: Gtk.Fixed | null = null;
    private _first: Gtk.Label | null = null;
    private _second: Gtk.Label | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookFixed' }, FixedStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(FixedStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...fixedMeta, component: Gtk.Fixed.$gtype };
    }

    initialize(): void {
        this._fixed = new Gtk.Fixed();
        this._first = new Gtk.Label({ label: 'at (x, y)' });
        this._second = new Gtk.Label({ label: 'at (x + 96, y + 40)' });
        this._fixed.put(this._first, 0, 0);
        this._fixed.put(this._second, 0, 0);
        this._apply();
        this.addContent(this._fixed);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._fixed || !this._first || !this._second) return;
        const x = this.args.offsetX as number;
        const y = this.args.offsetY as number;
        // `move` rather than `put`: both children are already in this fixed, and GTK's
        // `gtk_fixed_move` is the method that only relocates.
        this._fixed.move(this._first, x, y);
        this._fixed.move(this._second, x + 96, y + 40);
    }
}

GObject.type_ensure(FixedStory.$gtype);

export const FixedStories: StoryModule = { stories: [FixedStory] };
