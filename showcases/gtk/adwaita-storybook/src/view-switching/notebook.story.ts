// Gtk.Notebook — the older page container, which brings its own tab bar.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { NOTEBOOK_PAGES, notebookMeta } from './notebook.meta.js';

/** The `GtkPositionType` nicks this story offers (gtknotebook.c:1113-1117). */
const POSITIONS: Readonly<Record<string, Gtk.PositionType>> = {
    top: Gtk.PositionType.TOP,
    bottom: Gtk.PositionType.BOTTOM,
    left: Gtk.PositionType.LEFT,
    right: Gtk.PositionType.RIGHT,
};

/** Story: a three-page Gtk.Notebook whose tab strip moves with `tab-pos`. */
export class NotebookStory extends StoryWidget {
    private _notebook: Gtk.Notebook | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookNotebook' }, NotebookStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(NotebookStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...notebookMeta, component: Gtk.Notebook.$gtype };
    }

    initialize(): void {
        this._notebook = new Gtk.Notebook({ vexpand: true, widthRequest: 480, heightRequest: 320 });

        for (const page of NOTEBOOK_PAGES) {
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                halign: Gtk.Align.CENTER,
                valign: Gtk.Align.CENTER,
                spacing: 6,
            });
            box.append(new Gtk.Label({ label: page.label || page.name, cssClasses: ['title-4'] }));
            box.append(new Gtk.Label({ label: page.body, cssClasses: ['title-2'] }));

            // `append_page_menu` rather than `append_page`: a GtkNotebookPage is a GObject
            // whose tab-label AND menu-label are two properties, and only the `_menu` form
            // takes both (gtknotebook.c:5871-5884). The third page passes `null` for the
            // tab label, which is what makes C number it "Page 3" instead of drawing no
            // tab at all (`gtk_notebook_update_labels`, gtknotebook.c:4353-4373).
            const label = page.label ? new Gtk.Label({ label: page.label }) : null;
            const menu = new Gtk.Label({ label: page.label || page.name });
            this._notebook.append_page_menu(box, label, menu, -1);
        }

        this._apply();
        this.addContent(this._notebook);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._notebook) return;
        // The ORDER is the C's own: `tab_pos` is read by the layout, so it goes first, and
        // `show-border` last because it is a style class either way (gtknotebook.c:6134).
        this._notebook.tab_pos = POSITIONS[this.args.tabPos as string] ?? Gtk.PositionType.TOP;
        this._notebook.show_tabs = this.args.showTabs as boolean;
        this._notebook.enable_popup = this.args.enablePopup as boolean;
        this._notebook.show_border = this.args.showBorder as boolean;
    }
}

GObject.type_ensure(NotebookStory.$gtype);

export const NotebookStories: StoryModule = { stories: [NotebookStory] };
