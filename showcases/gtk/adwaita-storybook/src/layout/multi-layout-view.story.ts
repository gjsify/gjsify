// Adw.MultiLayoutView — one set of children, two arrangements of them.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { multiLayoutViewMeta } from './multi-layout-view.meta.js';

/** The two ids every layout here carries: the content, and the secondary pane. */
const PRIMARY = 'primary';
const SECONDARY = 'secondary';

/** A page with a short list, so the two children are visibly different once they move. */
function page(title: string, rows: readonly (readonly [string, string])[]): Adw.NavigationPage {
    const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
    for (const [name, detail] of rows) list.append(new Adw.ActionRow({ title: name, subtitle: detail }));
    return new Adw.NavigationPage({ title, child: list, tag: title.toLowerCase() });
}

/**
 * One arrangement: a split view whose two panes are SLOTS, so the children land by id.
 *
 * `collapsed` is what makes the second arrangement different — and it is the same pair of
 * children either way, which is the whole point of the widget.
 */
function arrangement(collapsed: boolean): Adw.NavigationSplitView {
    const view = new Adw.NavigationSplitView({ collapsed, minSidebarWidth: 160 });
    view.sidebar = new Adw.LayoutSlot(SECONDARY);
    view.content = new Adw.LayoutSlot(PRIMARY);
    view.set_size_request(420, 220);
    return view;
}

/** Story: the same two pages docked, then the same two pages stacked. */
export class MultiLayoutViewStory extends StoryWidget {
    private _view: Adw.MultiLayoutView | null = null;
    private _details: Adw.NavigationPage | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookMultiLayoutView' }, MultiLayoutViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(MultiLayoutViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...multiLayoutViewMeta, component: Adw.MultiLayoutView.$gtype };
    }

    initialize(): void {
        this._details = page('Message', [
            ['From', 'Adwaita List'],
            ['Subject', 'Resizing the window'],
        ]);
        this._view = new Adw.MultiLayoutView();
        // `add_layout` makes the FIRST layout current (adw-multi-layout-view.c:553), so the
        // wide one goes in first; the name is set before the second is added, because
        // `add_layout` warns on a duplicate and reads the name to do it.
        const wide = new Adw.Layout(arrangement(false));
        wide.name = 'wide';
        this._view.add_layout(wide);
        const narrow = new Adw.Layout(arrangement(true));
        narrow.name = 'narrow';
        this._view.add_layout(narrow);

        this._view.set_child(
            PRIMARY,
            page('Inbox', [
                ['General', '12 unread'],
                ['Starred', '3 threads'],
            ]),
        );
        this._view.set_child(SECONDARY, this._details);

        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view || !this._details) return;
        // `visible` is bound one way, child to slot, so hiding the CHILD is what takes the
        // hole with it.
        this._details.visible = this.args.showDetails as boolean;
        this._view.layout_name = this.args.layoutName as string;
    }
}

GObject.type_ensure(MultiLayoutViewStory.$gtype);

export const MultiLayoutViewStories: StoryModule = { stories: [MultiLayoutViewStory] };
