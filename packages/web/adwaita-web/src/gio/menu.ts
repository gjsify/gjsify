// `Gio.Menu` and `Gio.MenuItem` — the AUTHORING DOOR onto the portable menu model.
//
// WHAT WAS MISSING, AND WHERE IT SHOWED. The VALUE has been shared since ADR 0042: every
// surface's `menuModel` takes `AdwMenuInput` and `normalizeMenuModel` reduces it. What no
// surface had was the name an author reaches for, so a menu written for GJS
// (`new Gio.Menu()` + `menu.append(label, action)`) had to be RETYPED as an array to reach
// this port, and the array spelling cannot carry an action name at all.
//
// THIS FILE IS THE SECOND COPY, and it says so rather than pretending otherwise:
// `@gjsify/adwaita-nativescript` carries the identical class. Pure data with no DOM in it
// belongs in `@gjsify/adwaita-core` beside `menu.ts`, which is the model's own home and the
// one place both ports already import — the lift is a file move plus two re-export lines,
// and it is the fix, not a nicety.
//
// WHY IT IS AN `Array` SUBCLASS rather than a builder with a `toModel()`. `menuModel`
// already accepts an array, and `normalizeMenuModel` gates on `Array.isArray` — which is
// TRUE for a subclass. So `menuModel: menu` and `menuModel: [...]` are the SAME WRITE, no
// widget learns a second input shape, and no conversion step exists to forget. A builder
// with its own accessor would have made every `menuModel` setter branch on the type, which
// is the divergence moved rather than removed.
//
// WHAT IT IS NOT. `GMenuModel` is an abstract observable with `get_n_items()`,
// `items_changed` and attribute iteration; none of that is here, and this class is
// deliberately not a stand-in for it. It is the four `g_menu_append*` entry points, which
// is what BUILDING a menu takes.
//
// Reference: @girs/gio-2.0 — `Gio.Menu.append`, `.append_item`, `.append_section`,
// `.append_submenu`; `Gio.MenuItem.new(label, detailed_action)`.
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

import type { AdwMenuEntryInput, AdwMenuItemInput, AdwMenuSectionInput } from '@gjsify/adwaita-core';

/**
 * One menu item, built the way `g_menu_item_new` builds one.
 *
 * IT IS ITSELF A PORTABLE ENTRY — `implements AdwMenuItemInput` — so `append_item` pushes
 * the instance and `normalizeMenuModel` reads its fields like any authored object. A
 * separate internal shape would need a conversion the model does not ask for.
 *
 * Both halves are nullable, as they are in C: `g_menu_item_new(NULL, NULL)` is legal and
 * produces an item carrying neither, which {@link normalizeMenuModel} drops rather than
 * drawing an empty, unactionable row.
 */
export class MenuItem implements AdwMenuItemInput {
    /** The user-visible string; ABSENT rather than `undefined` when the item has none. */
    label?: string;

    /** The DETAILED action name — `app.save-as`, `app.view::list` (ADR 0042 § divergence 2). */
    action?: string;

    constructor(label: string | null = null, detailedAction: string | null = null) {
        this.set_label(label);
        this.set_detailed_action(detailedAction);
    }

    /** `g_menu_item_set_label`. `null` REMOVES the attribute, which is what C does. */
    set_label(label: string | null): void {
        if (label === null) delete this.label;
        else this.label = label;
    }

    /** `g_menu_item_set_detailed_action`, and `null` is `g_menu_item_set_action_and_target(…, NULL)`. */
    set_detailed_action(detailedAction: string | null): void {
        if (detailedAction === null) delete this.action;
        else this.action = detailedAction;
    }
}

/**
 * A menu under construction — `Gio.Menu`'s four append entry points over the portable model.
 *
 * `new Menu()` is empty, as `g_menu_new()` is. Every `append*` puts one entry on the end,
 * and the instance IS the value a `menuModel` property takes.
 */
export class Menu extends Array<AdwMenuEntryInput> {
    /** `g_menu_append` — the convenience C implements as `menu_item_new` + `append_item`. */
    append(label: string | null, detailedAction: string | null = null): void {
        this.append_item(new MenuItem(label, detailedAction));
    }

    /** `g_menu_append_item`. */
    append_item(item: MenuItem): void {
        this.push(item);
    }

    /**
     * `g_menu_append_section` — the `section` LINK, whose items are drawn inline with a
     * separator rather than behind a further click.
     *
     * The label is optional in C and stays optional here: a section with none is a plain
     * group, and writing `label: null` onto the entry would be an attribute the model
     * then has to ignore.
     */
    append_section(label: string | null, section: readonly AdwMenuEntryInput[]): void {
        const entry: AdwMenuSectionInput = { section };
        if (label !== null) (entry as { label?: string }).label = label;
        this.push(entry);
    }

    /** `g_menu_append_submenu` — the `submenu` LINK: a nested menu the user opens. */
    append_submenu(label: string | null, submenu: readonly AdwMenuEntryInput[]): void {
        this.push({ label: label ?? '', submenu });
    }
}
