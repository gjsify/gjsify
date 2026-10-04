// Gtk.TreeExpander — the indent and the arrow in front of a tree row's contents.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import type Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { TREE_EXPANDER_TREE, treeExpanderMeta } from './tree-expander.meta.js';

/**
 * Story: a Gtk.ListView over a Gtk.TreeListModel, each row a Gtk.TreeExpander.
 *
 * The expander is only ever reachable this way — it watches a `GtkTreeListRow`, which
 * only a `GtkTreeListModel` produces — so the story builds the model the widget needs
 * rather than a standalone expander that would have nothing to expand.
 */
export class TreeExpanderStory extends StoryWidget {
    private _view: Gtk.ListView | null = null;
    private _tree: Gtk.TreeListModel | null = null;
    /** The expanders the factory has built, so an arg change reaches the live ones. */
    private readonly _expanders = new Set<Gtk.TreeExpander>();

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookTreeExpander' }, TreeExpanderStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TreeExpanderStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...treeExpanderMeta, component: Gtk.TreeExpander.$gtype };
    }

    initialize(): void {
        const roots = Gtk.StringList.new(Object.keys(TREE_EXPANDER_TREE));
        // `passthrough: false` is what makes the model hand out `GtkTreeListRow`s, which
        // is what the expander watches; the C says so in the widget's own documentation.
        this._tree = Gtk.TreeListModel.new(roots, false, false, (item: GObject.Object) => {
            const children = TREE_EXPANDER_TREE[(item as Gtk.StringObject).string] ?? [];
            return children.length === 0 ? null : (Gtk.StringList.new([...children]) as Gio.ListModel);
        });

        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, item: GObject.Object) => {
            const listItem = item as Gtk.ListItem;
            // The expander owns the keyboard shortcuts, so focus belongs to it and not to
            // the list item around it (gtktreeexpander.c, "Shortcuts and Gestures").
            listItem.focusable = false;
            const expander = new Gtk.TreeExpander();
            expander.child = new Gtk.Label({ xalign: 0 });
            listItem.child = expander;
            this._expanders.add(expander);
        });
        factory.connect('teardown', (_factory, item: GObject.Object) => {
            // Cleanup beside creation: a recycled row's expander is unparented here, and a
            // set that kept it would hand a destroyed widget to the next arg change.
            const child = (item as Gtk.ListItem).child;
            if (child !== null) this._expanders.delete(child as Gtk.TreeExpander);
        });
        factory.connect('bind', (_factory, item: GObject.Object) => {
            const listItem = item as Gtk.ListItem;
            const expander = listItem.child as Gtk.TreeExpander;
            const row = listItem.item as Gtk.TreeListRow;
            expander.listRow = row;
            (expander.child as Gtk.Label).label = (row.item as Gtk.StringObject).string;
            this._applyTo(expander);
        });

        this._view = new Gtk.ListView({ model: Gtk.SingleSelection.new(this._tree), factory, vexpand: true });
        const scroller = new Gtk.ScrolledWindow({ child: this._view, heightRequest: 200, hexpand: true });
        this.addContent(scroller);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /**
     * Apply the args to the ROOT rows and to every expander currently bound.
     *
     * Two halves because the two properties live in two places: `expanded` is the tree
     * row's and survives a row widget being recycled, while `hide-expander` and
     * `indent-for-icon` are the WIDGET's and therefore have to be re-applied to each one
     * the factory has built — which `bind` does for a row that arrives later.
     */
    private _apply(): void {
        if (this._tree === null) return;
        for (let position = 0; position < this._tree.get_n_items(); position++) {
            const row = this._tree.get_row(position);
            if (row !== null && row.depth === 0) row.expanded = this.args.expanded as boolean;
        }
        for (const expander of this._expanders) this._applyTo(expander);
    }

    private _applyTo(expander: Gtk.TreeExpander): void {
        expander.hideExpander = this.args.hideExpander as boolean;
        expander.indentForIcon = this.args.indentForIcon as boolean;
    }
}

GObject.type_ensure(TreeExpanderStory.$gtype);

export const TreeExpanderStories: StoryModule = { stories: [TreeExpanderStory] };
