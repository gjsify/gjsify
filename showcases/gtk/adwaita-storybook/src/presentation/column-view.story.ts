// Gtk.ColumnView — a list view with a header and one cell per column.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { COLUMN_VIEW_ITEMS, columnViewMeta } from './column-view.meta.js';

/**
 * Story: a Gtk.ColumnView of two columns over a Gtk.StringList of labels.
 *
 * The model is a string list, as the browser rendering's is, so both draw the same two
 * fields: the Name column shows the string and the Code column the two-letter id the
 * story holds beside it. A richer item type would need a GObject per row, which is the
 * authoring step the portable list exists to avoid.
 */
export class ColumnViewStory extends StoryWidget {
    private _view: Gtk.ColumnView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookColumnView' }, ColumnViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ColumnViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...columnViewMeta, component: Gtk.ColumnView.$gtype };
    }

    initialize(): void {
        const model = Gtk.StringList.new(COLUMN_VIEW_ITEMS.map((item) => item.label));
        this._view = new Gtk.ColumnView({ model: Gtk.SingleSelection.new(model), vexpand: true });
        this._view.append_column(this._column('Name', (item) => item.label));
        this._view.append_column(this._column('Code', (item) => item.value));

        const scroller = new Gtk.ScrolledWindow({ child: this._view, heightRequest: 200, hexpand: true });
        this._apply();
        this.addContent(scroller);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view) return;
        this._view.showRowSeparators = this.args.showRowSeparators as boolean;
        this._view.showColumnSeparators = this.args.showColumnSeparators as boolean;
        this._view.reorderable = this.args.reorderable as boolean;
    }

    /** One column, with the factory that reads the field this column draws. */
    private _column(title: string, read: (item: { value: string; label: string }) => string): Gtk.ColumnViewColumn {
        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, item: GObject.Object) => {
            (item as Gtk.ListItem).child = new Gtk.Label({ xalign: 0 });
        });
        factory.connect('bind', (_factory, item: GObject.Object) => {
            const listItem = item as Gtk.ListItem;
            const label = listItem.child as Gtk.Label;
            const text = (listItem.item as Gtk.StringObject).string;
            const entry = COLUMN_VIEW_ITEMS.find((candidate) => candidate.label === text);
            label.label = entry === undefined ? text : read(entry);
        });
        return new Gtk.ColumnViewColumn({ title, factory, expand: true });
    }
}

GObject.type_ensure(ColumnViewStory.$gtype);

export const ColumnViewStories: StoryModule = { stories: [ColumnViewStory] };
