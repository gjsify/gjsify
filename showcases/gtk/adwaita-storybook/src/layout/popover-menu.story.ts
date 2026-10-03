// Gtk.PopoverMenu — a Gtk.Popover whose contents are a menu model.
// original implementation.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { POPOVER_MENU_ITEMS, popoverMenuMeta } from './popover-menu.meta.js';

/**
 * Story: a Gtk.PopoverMenu over a Gio.Menu with a section, a submenu and accelerators,
 * anchored to a plain button.
 *
 * `GtkPopoverMenu.new_from_model` builds SLIDING submenus by default
 * (gtkpopovermenu.c:786-799), which is the page-swap this element's replica draws; the
 * nested form is the `flags` argument of `new_from_model_full` and is left at the default on
 * purpose, so both renderings show the same shape.
 */
/** A detailed action name GIO parses: a label's spaces would make `g_menu_item_set_detailed_action` abort. */
const actionOf = (label: string): string => `app.${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export class PopoverMenuStory extends StoryWidget {
    private _anchor: Gtk.Button | null = null;
    private _popover: Gtk.PopoverMenu | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPopoverMenu' }, PopoverMenuStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PopoverMenuStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...popoverMenuMeta, component: Gtk.PopoverMenu.$gtype };
    }

    initialize(): void {
        this._anchor = new Gtk.Button({ label: 'Open menu', halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._anchor);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /**
     * The portable menu (ADR 0042) as a `Gio.Menu`: a submenu is a `Gio.Menu` appended
     * under its label, and an accelerator is a display string — nothing here binds a key,
     * exactly as in GTK, where the binding is `gtk_application_set_accels_for_action`.
     *
     * THE HEADING IS THE FIRST SECTION, because `GMenuModel` has no title of its own. The
     * browser element's `menu-title` is that shorthand, and this is the GTK half of the
     * same fact: `gtk_popover_menu_open_submenu`'s "main" page is a `GtkStack` of
     * `GtkMenuSectionBox`es, each of which can carry a label (gtkpopovermenu.c:152-164).
     */
    private _buildMenu(title: string): Gio.Menu {
        const menu = new Gio.Menu();
        // The items that carry no section of their own, kept aside until the title decides
        // whether they stand alone or become the heading's group.
        const loose: string[] = [];
        for (const entry of POPOVER_MENU_ITEMS) {
            if ('submenu' in entry) {
                const submenu = new Gio.Menu();
                for (const item of entry.submenu) submenu.append(item.label, actionOf(item.label));
                menu.append_submenu(entry.label, submenu);
                continue;
            }
            if ('section' in entry) {
                const section = new Gio.Menu();
                for (const item of entry.section) section.append(item.label, actionOf(item.label));
                menu.append_section('Edit', section);
                continue;
            }
            loose.push(entry.label);
        }
        // A heading IS a labelled section — `GMenuModel` has no title, which is exactly why
        // the browser element's `menu-title` is a shorthand for one. With no title the
        // loose items are appended one by one, so the menu reads the same without one.
        if (title.length > 0) {
            const section = new Gio.Menu();
            for (const label of loose) section.append(label, actionOf(label));
            menu.append_section(title, section);
        } else {
            for (const label of loose) menu.append(label, actionOf(label));
        }
        return menu;
    }

    private _apply(): void {
        if (!this._anchor) return;
        // Rebuilt rather than mutated: a `Gio.Menu` is immutable to the popover once shown,
        // and `gtk_popover_menu_set_menu_model` REPLACES the whole stack on every call
        // (gtkpopovermenu.c:838-852).
        const previous = this._popover;
        this._popover = Gtk.PopoverMenu.new_from_model(this._buildMenu(this.args.menuTitle as string));
        this._popover.set_parent(this._anchor);
        previous?.unparent();
        // The four GtkPositionType values, by name, so both renderers read one control.
        const positions: Record<string, Gtk.PositionType> = {
            bottom: Gtk.PositionType.BOTTOM,
            top: Gtk.PositionType.TOP,
            start: Gtk.PositionType.LEFT,
            end: Gtk.PositionType.RIGHT,
        };
        this._popover.position = positions[this.args.position as string] ?? Gtk.PositionType.BOTTOM;
        // `GtkPopover` has no align property: alignment is the parent widget's `halign`, which
        // is why the browser element carries an `align` attribute of its own.
        if (this._anchor) {
            this._anchor.halign = (this.args.align as string) === 'end' ? Gtk.Align.END : Gtk.Align.START;
        }
        this._popover.autohide = this.args.autohide as boolean;
    }
}

GObject.type_ensure(PopoverMenuStory.$gtype);

export const PopoverMenuStories: StoryModule = { stories: [PopoverMenuStory] };
