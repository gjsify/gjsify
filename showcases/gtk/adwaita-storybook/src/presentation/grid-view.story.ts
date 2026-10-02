// Gtk.GridView — the list view's model and factory, reflowed into columns.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { GRID_VIEW_ITEMS, gridViewMeta } from './grid-view.meta.js';

/** Story: a Gtk.GridView over a Gtk.StringList, with both column bounds as args. */
export class GridViewStory extends StoryWidget {
    private _view: Gtk.GridView | null = null;
    private _model: Gtk.StringList | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGridView' }, GridViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GridViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...gridViewMeta, component: Gtk.GridView.$gtype };
    }

    initialize(): void {
        this._model = Gtk.StringList.new([...GRID_VIEW_ITEMS]);

        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, item: GObject.Object) => {
            (item as Gtk.ListItem).child = new Gtk.Label({ xalign: 0.5 });
        });
        factory.connect('bind', (_factory, item: GObject.Object) => {
            const listItem = item as Gtk.ListItem;
            const label = listItem.child as Gtk.Label;
            label.label = (listItem.item as Gtk.StringObject).string;
        });

        this._view = new Gtk.GridView({ factory, vexpand: true });
        const scroller = new Gtk.ScrolledWindow({ child: this._view, heightRequest: 200, hexpand: true });
        this._apply();
        this.addContent(scroller);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view || !this._model) return;
        this._view.model =
            (this.args.selectionMode as string) === 'multiple'
                ? Gtk.MultiSelection.new(this._model)
                : (this.args.selectionMode as string) === 'none'
                  ? Gtk.NoSelection.new(this._model)
                  : Gtk.SingleSelection.new(this._model);
        this._view.minColumns = Math.max(1, this.args.minColumns as number);
        this._view.maxColumns = Math.max(this._view.minColumns, this.args.maxColumns as number);
    }
}

GObject.type_ensure(GridViewStory.$gtype);

export const GridViewStories: StoryModule = { stories: [GridViewStory] };
