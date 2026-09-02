// Adw.ComboRow — a boxed-list row presenting a drop-down backed by a string list.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { COMBO_ROW_OPTIONS, comboRowMeta } from './combo-row.meta.js';

/** Story: Adw.ComboRow inside a boxed list, selecting from a Gtk.StringList. */
export class ComboRowStory extends StoryWidget {
    private _row: Adw.ComboRow | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookComboRow' }, ComboRowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ComboRowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...comboRowMeta, component: Adw.ComboRow.$gtype };
    }

    initialize(): void {
        this._row = new Adw.ComboRow({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
            model: new Gtk.StringList({ strings: [...COMBO_ROW_OPTIONS] }),
            selected: this.args.selected as number,
        });

        const group = new Adw.PreferencesGroup();
        group.add(this._row);

        const clamp = new Adw.Clamp({ maximumSize: 400, child: group });
        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._row) return;
        this._row.title = this.args.title as string;
        this._row.subtitle = this.args.subtitle as string;
        this._row.selected = this.args.selected as number;
    }
}

GObject.type_ensure(ComboRowStory.$gtype);

export const ComboRowStories: StoryModule = { stories: [ComboRowStory] };
