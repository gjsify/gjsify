// Adw.ComboRow — a boxed-list row presenting a drop-down backed by a string list.
// original implementation.

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Boxed Lists/Combo Row',
            description: 'Adw.ComboRow — a preferences row with an inline drop-down backed by a Gtk.StringList.',
            component: Adw.ComboRow.$gtype,
            controls: [
                { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Accent colour' },
                {
                    name: 'subtitle',
                    label: 'Subtitle',
                    type: ControlType.TEXT,
                    defaultValue: 'Used to highlight selected items',
                },
                {
                    name: 'selected',
                    label: 'Selected',
                    type: ControlType.NUMBER,
                    min: 0,
                    max: 4,
                    step: 1,
                    defaultValue: 1,
                },
            ],
        };
    }

    initialize(): void {
        this._row = new Adw.ComboRow({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
            model: new Gtk.StringList({ strings: ['Blue', 'Teal', 'Green', 'Orange', 'Purple'] }),
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
