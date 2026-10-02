// Gtk.ListBox — one row per child you append, with GTK's four selection modes.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { LIST_BOX_ROWS, listBoxMeta } from './list-box.meta.js';

/** Story: a Gtk.ListBox of GtkListBoxRow children, the selection mode chosen by an arg. */
export class ListBoxStory extends StoryWidget {
    private _box: Gtk.ListBox | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookListBox' }, ListBoxStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ListBoxStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...listBoxMeta, component: Gtk.ListBox.$gtype };
    }

    initialize(): void {
        this._box = new Gtk.ListBox({ hexpand: true });
        // `gtk_list_box_append()` WRAPS whatever it is given in a GtkListBoxRow, so the rows
        // are built here — the one thing the markup form has to spell and this cannot.
        for (const title of LIST_BOX_ROWS) {
            this._box.append(new Gtk.ListBoxRow({ child: new Gtk.Label({ label: title, xalign: 0 }) }));
        }
        this._apply();
        const scroller = new Gtk.ScrolledWindow({ child: this._box, heightRequest: 200 });
        this.addContent(scroller);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box) return;
        this._box.selection_mode = this._selectionMode();
        this._box.show_separators = this.args.showSeparators as boolean;
        // The ParamSpec default is TRUE (gtklistbox.c:543) — the opposite of GtkListView's
        // `single-click-activate` — so a false arg is the only thing that changes it.
        this._box.activate_on_single_click = this.args.activateOnSingleClick as boolean;
        this._box.tab_behavior = this.args.tabBehavior as Gtk.ListTabBehavior;
    }

    /** The four `Gtk.SelectionMode` values, under the nicks the shared metadata spells. */
    private _selectionMode(): Gtk.SelectionMode {
        switch (this.args.selectionMode as string) {
            case 'multiple':
                return Gtk.SelectionMode.MULTIPLE;
            case 'browse':
                return Gtk.SelectionMode.BROWSE;
            case 'none':
                return Gtk.SelectionMode.NONE;
            default:
                return Gtk.SelectionMode.SINGLE;
        }
    }
}

GObject.type_ensure(ListBoxStory.$gtype);

export const ListBoxStories: StoryModule = { stories: [ListBoxStory] };
