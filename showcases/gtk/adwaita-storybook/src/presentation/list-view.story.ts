// Gtk.ListView — one row per model item, each built by a factory.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { LIST_VIEW_ITEMS, listViewMeta } from './list-view.meta.js';

/** Story: a Gtk.ListView over a Gtk.StringList, with the selection model chosen by an arg. */
export class ListViewStory extends StoryWidget {
    private _view: Gtk.ListView | null = null;
    private _model: Gtk.StringList | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookListView' }, ListViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ListViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...listViewMeta, component: Gtk.ListView.$gtype };
    }

    initialize(): void {
        this._model = Gtk.StringList.new([...LIST_VIEW_ITEMS]);

        // `setup` builds the row widget and `bind` fills it — the pair GTK keeps apart so
        // it can RECYCLE rows while scrolling.
        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, item: GObject.Object) => {
            (item as Gtk.ListItem).child = new Gtk.Label({ xalign: 0 });
        });
        factory.connect('bind', (_factory, item: GObject.Object) => {
            const listItem = item as Gtk.ListItem;
            const label = listItem.child as Gtk.Label;
            label.label = (listItem.item as Gtk.StringObject).string;
        });

        this._view = new Gtk.ListView({ factory, vexpand: true });
        const scroller = new Gtk.ScrolledWindow({ child: this._view, heightRequest: 200, hexpand: true });
        this._apply();
        this.addContent(scroller);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view || !this._model) return;
        this._view.model = this._selectionModel(this._model);
        this._view.showSeparators = this.args.showSeparators as boolean;
        this._view.singleClickActivate = this.args.singleClickActivate as boolean;
    }

    /** The three models a `GtkListView:model` may be, under the nicks the story shares. */
    private _selectionModel(model: Gtk.StringList): Gtk.SelectionModel {
        switch (this.args.selectionMode as string) {
            case 'multiple':
                return Gtk.MultiSelection.new(model);
            case 'none':
                return Gtk.NoSelection.new(model);
            default:
                return Gtk.SingleSelection.new(model);
        }
    }
}

GObject.type_ensure(ListViewStory.$gtype);

export const ListViewStories: StoryModule = { stories: [ListViewStory] };
