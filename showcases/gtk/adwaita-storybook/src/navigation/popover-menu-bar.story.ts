// Gtk.PopoverMenuBar — a bar of items that pop up menus.
// original implementation.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { POPOVER_MENU_BAR_ITEMS, popoverMenuBarMeta } from './popover-menu-bar.meta.js';

/**
 * Story: a Gtk.PopoverMenuBar over four submenus.
 *
 * `GtkPopoverMenuBar.new_from_model` (gtkpopovermenubar.c:686-703) is the ONLY way to make
 * one — there is no constructor that takes children — so the model is the whole story. Each
 * item's popover is `GtkPopoverMenu.new_from_model_full (…, GTK_POPOVER_MENU_NESTED)`
 * (:435), pinned below the item with `has-arrow` off, which `tracker_insert` does for us.
 */
export class PopoverMenuBarStory extends StoryWidget {
    private _bar: Gtk.PopoverMenuBar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPopoverMenuBar' }, PopoverMenuBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PopoverMenuBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...popoverMenuBarMeta, component: Gtk.PopoverMenuBar.$gtype };
    }

    initialize(): void {
        this._bar = Gtk.PopoverMenuBar.new_from_model(this._buildMenu());
        this._bar.halign = Gtk.Align.START;
        this._apply();
        this.addContent(this._bar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _buildMenu(): Gio.Menu {
        const menu = new Gio.Menu();
        const entries = this.args.showLast === false ? POPOVER_MENU_BAR_ITEMS.slice(0, 3) : POPOVER_MENU_BAR_ITEMS;
        for (const entry of entries) {
            const submenu = new Gio.Menu();
            for (const item of entry.submenu)
                submenu.append(item.label, `app.${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
            menu.append_submenu(entry.label, submenu);
        }
        return menu;
    }

    private _apply(): void {
        if (!this._bar) return;
        // Every item's popover is pinned `GTK_POS_BOTTOM` by `tracker_insert`, so this is the
        // one thing about it an application actually changes: walk the bar's children and
        // re-point the popover each one owns. `GtkPopoverMenuBarItem` is private, so the
        // popover is reached through the widget tree rather than through a typed accessor.
        const above = this.args.position === 'top';
        for (let child = this._bar.get_first_child(); child !== null; child = child.get_next_sibling()) {
            const popover = (child as unknown as { get_first_child(): Gtk.Popover | null }).get_first_child();
            popover?.set_position(above ? Gtk.PositionType.TOP : Gtk.PositionType.BOTTOM);
        }
    }
}

GObject.type_ensure(PopoverMenuBarStory.$gtype);

export const PopoverMenuBarStories: StoryModule = { stories: [PopoverMenuBarStory] };
