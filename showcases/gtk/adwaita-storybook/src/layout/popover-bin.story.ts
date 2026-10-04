// Gtk.PopoverBin — one child, and a popover to present from it.
// original implementation.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { POPOVER_BIN_ITEMS, popoverBinMeta } from './popover-bin.meta.js';

/**
 * Story: a Gtk.PopoverBin wrapping a list row, with `handle-input` on so a right click (or a
 * long press on a touchscreen) opens the menu, and a plain click selects the row as usual.
 *
 * The bin's own `menu.popup` action (gtkpopoverbin.c:381) is what the browser rendering
 * exposes as a `popup()` method and a `menu.popup` event, so both reach the same surface a
 * gesture reaches.
 */
export class PopoverBinStory extends StoryWidget {
    private _bin: Gtk.PopoverBin | null = null;
    private _list: Gtk.ListBox | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPopoverBin' }, PopoverBinStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PopoverBinStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...popoverBinMeta, component: Gtk.PopoverBin.$gtype };
    }

    initialize(): void {
        this._list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.SINGLE });
        for (const label of ['Documents', 'Downloads', 'Pictures']) {
            this._list.append(new Gtk.ListBoxRow({ child: new Gtk.Label({ label }) }));
        }
        this._bin = new Gtk.PopoverBin({ child: this._list });
        this._apply();
        this.addContent(this._bin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _buildMenu(): Gio.Menu {
        const menu = new Gio.Menu();
        for (const item of POPOVER_BIN_ITEMS)
            menu.append(item.label, `app.${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
        return menu;
    }

    private _apply(): void {
        if (!this._bin) return;
        // `gtk_popover_bin_set_menu_model` builds the popover from the model and pins it to
        // GTK_POS_BOTTOM (gtkpopoverbin.c:474-500) — there is nothing to position by hand.
        this._bin.menuModel = this._buildMenu();
        this._bin.handleInput = this.args.handleInput as boolean;
    }
}

GObject.type_ensure(PopoverBinStory.$gtype);

export const PopoverBinStories: StoryModule = { stories: [PopoverBinStory] };
