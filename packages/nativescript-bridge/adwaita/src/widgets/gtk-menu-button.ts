// GtkMenuButton — the Adwaita-styled GTK menu button for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1), which this file's own
// FIDELITY note already stated: "libadwaita has no menu button of its own; it styles the
// GTK one".
//
// A flat icon button (extends {@link AdwImageButton}) that, when tapped, opens a
// native `action()` menu built from {@link GtkMenuButton.menuItems} and emits
// `menuItemActivated` with the chosen item. Mirrors `Gtk.MenuButton` used with a
// `Gio.Menu` model — the app/primary-menu pattern in an Adwaita header bar
// (`open-menu-symbolic` → About / Preferences / Quit …). libadwaita has no menu
// button of its own; it styles the GTK one.
//
// FIDELITY: approximated for the popover. `Gtk.MenuButton` shows an in-app popover
// menu; the NS subset has no popover, so the button opens the platform `action()`
// sheet (the same substitution `AdwSplitButton` / `AdwComboRow` make). The flat
// rounded-square icon-button shape + press feedback are inherited from
// {@link AdwImageButton} and are faithful.
//
// Reference: refs/gtk/gtk/gtkmenubutton.c (GtkMenuButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (menubutton)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwMenuEntry } from '@gjsify/adwaita-core';
import { action, type EventData } from '@nativescript/core';
import { AdwImageButton } from './adw-image-button.js';

/** Event name emitted when a menu item is chosen. */
export const MENU_ITEM_ACTIVATED = 'menuItemActivated';

/**
 * One entry in an {@link GtkMenuButton}'s menu — `@gjsify/adwaita-core`'s
 * {@link AdwMenuEntry}, under the name this widget has always used.
 *
 * It used to be a THIRD declaration of the same shape (the browser element had a
 * second, and the core the original), and this one was missing `icon` — so a menu
 * written for one renderer was not the same object on the other. The browser side
 * adopted the core type in #1191; this is its twin.
 */
export type AdwMenuItem = AdwMenuEntry;

/** Payload of the {@link MENU_ITEM_ACTIVATED} event. */
export interface MenuItemActivatedEventData extends EventData {
    /** The chosen item's id (or its label when no id was given). */
    id: string;
    /** The chosen item's label. */
    label: string;
    /** The chosen item's index in {@link GtkMenuButton.menuItems}. */
    index: number;
}

export class GtkMenuButton extends AdwImageButton {
    private _items: AdwMenuItem[] = [];
    private _menuTitle = '';

    constructor() {
        super();
        // Keep the AdwImageButton base styling; add a marker class for any tweaks.
        this.className = `${this.className} adw-menu-button`.trim();
        this.addEventListener('tap', () => {
            void this._openMenu();
        });
    }

    /** The menu items (opened as a native `action()` sheet on tap). */
    get menuItems(): AdwMenuItem[] {
        return this._items;
    }

    set menuItems(value: AdwMenuItem[]) {
        this._items = Array.isArray(value) ? value : [];
    }

    /** Optional title shown atop the native menu sheet. */
    get menuTitle(): string {
        return this._menuTitle;
    }

    set menuTitle(value: string) {
        this._menuTitle = value ?? '';
    }

    private async _openMenu(): Promise<void> {
        if (this._items.length === 0) return;
        const labels = this._items.map((it) => it.label);
        const chosen = await action({
            title: this._menuTitle || undefined,
            cancelButtonText: 'Cancel',
            actions: labels,
        });
        const index = labels.indexOf(chosen);
        if (index < 0) return; // Cancel / dismissed.
        const item = this._items[index];
        const data: MenuItemActivatedEventData = {
            eventName: MENU_ITEM_ACTIVATED,
            object: this,
            id: item.id ?? item.label,
            label: item.label,
            index,
        };
        this.notify(data);
    }
}
