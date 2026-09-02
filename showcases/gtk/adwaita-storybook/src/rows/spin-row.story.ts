// Adw.SpinRow — a boxed-list row embedding a spin button over an adjustment.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { spinRowMeta } from './spin-row.meta.js';

/** Story: Adw.SpinRow inside a boxed list, driven by a Gtk.Adjustment. */
export class SpinRowStory extends StoryWidget {
    private _row: Adw.SpinRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookSpinRow' }, SpinRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(SpinRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...spinRowMeta, component: Adw.SpinRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.SpinRow({
            title: this.args.title as string,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                value: this.args.value as number,
                stepIncrement: 1,
                pageIncrement: 10,
            }),
            digits: this.args.digits as number,
        });

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.value = this.args.value as number;
        this._row.digits = this.args.digits as number;
    }
}

GObject.type_ensure(SpinRowStory.$gtype);

export const SpinRowStories: StoryModule = { stories: [SpinRowStory] };
