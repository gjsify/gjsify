// The portable menu model as a real `Gio.Menu` (ADR 0042).
//
// This is the half of the model that cannot live in `@gjsify/adwaita-core`: that package
// is headless by contract (ADR 0015) and may not import `gi://`. So the SHAPE is shared
// and the CONSTRUCTION is here, which is also where the claim "the model maps onto
// `Gio.Menu` losslessly" is either true or measurably false.
//
// WHY A DECLARATIVE MENU NEEDED THIS AT ALL. `Adw.SplitButton:menu-model`,
// `Gtk.MenuButton:menu-model` and `Gtk.PopoverMenu:menu-model` take a `GMenuModel`, a
// GObject with no literal spelling — so a Solid, Vue or React tree could not express one
// and the website gallery said so, refusing a snippet for all three widgets. A JSX
// attribute can carry an ARRAY; `coerce` in `props.ts` turns one into the model at the
// ParamSpec seam, so `<adw-split-button menuModel={[…]}/>` is the same write as
// `<gtk-box orientation="vertical"/>`: an authored value the host converts into what
// GObject will store.
//
// EVERY ATTRIBUTE IS WRITTEN, including the ones GTK does not read. `id` is ours and
// `GMenuModel`'s attribute space is open, so it round-trips as an unread attribute
// rather than being dropped — which is what makes {@link fromGioMenu} able to answer
// with the model it was given.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (`## Menu models`, the attribute list)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import type { AdwMenuInput, AdwMenuModel, AdwMenuNode } from '@gjsify/adwaita-core';
import { normalizeMenuModel } from '@gjsify/adwaita-core';

import { err } from './errors.js';

/**
 * An ITEM's attribute names, mapped from the model's camelCase spelling.
 *
 * The model spells them the way TypeScript does and `GMenuModel` spells them the way
 * GIO does; this table is the only place the two meet. `id` carries no rename — it is
 * not a GTK attribute at all, so it is written and read back under its own name.
 *
 * ITEMS ONLY. A section's `display-hint`/`text-direction` and a submenu's
 * `submenu-action`/`gtk-macos-special` are written by their own branches below, because
 * they belong to a different node kind; putting them here would make the table read as
 * "every attribute" while the loop that consumes it only ever sees an item.
 */
const ITEM_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
    label: 'label',
    action: 'action',
    icon: 'icon',
    verbIcon: 'verb-icon',
    accel: 'accel',
    hiddenWhen: 'hidden-when',
    custom: 'custom',
    id: 'id',
};

/**
 * Refuse a detailed action name GIO cannot parse, BEFORE it reaches
 * `g_menu_item_set_detailed_action`.
 *
 * THE MEASUREMENT. `g_menu_item_set_detailed_action` does not return an error for a
 * malformed name — it calls `g_error()`, which is a SIGABRT, uncatchable from JS:
 *
 *     try { new Gio.MenuItem().set_detailed_action('app.x('); } catch (e) { print(e); }
 *     print('still alive');
 *     // GLib-GIO-ERROR **: … has invalid format   exit 134, NEITHER line printed
 *
 * Seven of the thirteen strings in `MENU_DETAILED_ACTION_VECTORS` do it — `'app.x('`,
 * `'win.zoom(qqq)'`, `'app.a b'`, `''`, `'app.x)'`, `'app.x()'`, `'a.b(1,2)'` — and every
 * door into the model is documented as TOTAL: `normalizeMenuModel` type-checks the
 * attribute and stores it, `parseMenuModel` promises a typo cannot take the widget down,
 * and `coerce` accepts whatever a JSX attribute holds. So a one-character slip in a
 * template killed the process instead of drawing a menu.
 *
 * `g_action_parse_detailed_name` is the SAME parser with an error return, so GIO stays
 * the authority and no second grammar is written here — the trap a hand-rolled validator
 * would be, since the `(…)` form's content is arbitrary `GVariant` text. It is the shape
 * `err.missingConstructProp` already documents for `Adw.LayoutSlot`: refuse while a
 * refusal is still reportable.
 */
function requireDetailedAction(detailed: string, label: string): void {
    try {
        Gio.Action.parse_detailed_name(detailed);
    } catch (error) {
        throw err.badDetailedAction(label, detailed, error instanceof Error ? error.message : String(error));
    }
}

/** One node as a `Gio.MenuItem`, links included. */
function itemOf(node: AdwMenuNode): Gio.MenuItem {
    const item = new Gio.MenuItem();
    if (node.kind === 'item') {
        // `set_detailed_action` PARSES the string — `app.view::list` becomes the action
        // plus its target — which is exactly why the model carries one string rather
        // than an action and a separately encoded `GVariant`. It also ABORTS the process
        // on a name it cannot parse, so the guard runs first.
        if (node.action !== undefined) {
            requireDetailedAction(node.action, node.label);
            item.set_detailed_action(node.action);
        }
        for (const [key, attribute] of Object.entries(ITEM_ATTRIBUTE_NAMES)) {
            const value = (node as unknown as Record<string, unknown>)[key];
            // `action` is set through `set_detailed_action` above, which also writes the
            // `target` attribute; writing it again as a plain string would overwrite the
            // parsed pair with the unparsed text.
            if (key === 'action' || typeof value !== 'string') continue;
            item.set_attribute_value(attribute, GLib.Variant.new_string(value));
        }
        if (node.useMarkup === true) {
            // GTK reads `use-markup` with `g_menu_item_get_attribute (…, "&s", NULL)`,
            // so its VALUE is unread and only its presence counts — but it must still be
            // a string, or the read fails and the flag is lost.
            item.set_attribute_value('use-markup', GLib.Variant.new_string('true'));
        }
        return item;
    }

    const child = buildGioMenu(node.items);
    if (node.kind === 'section') {
        item.set_section(child);
        if (node.label !== undefined) item.set_label(node.label);
        if (node.displayHint !== undefined) {
            item.set_attribute_value('display-hint', GLib.Variant.new_string(node.displayHint));
        }
        if (node.textDirection !== undefined) {
            item.set_attribute_value('text-direction', GLib.Variant.new_string(node.textDirection));
        }
        return item;
    }

    item.set_submenu(child);
    item.set_label(node.label);
    if (node.icon !== undefined) item.set_attribute_value('icon', GLib.Variant.new_string(node.icon));
    if (node.submenuAction !== undefined) {
        item.set_attribute_value('submenu-action', GLib.Variant.new_string(node.submenuAction));
    }
    if (node.macosSpecial !== undefined) {
        item.set_attribute_value('gtk-macos-special', GLib.Variant.new_string(node.macosSpecial));
    }
    return item;
}

/**
 * A portable menu model as a live `Gio.Menu`.
 *
 * Accepts the AUTHORED form as well as the normalised one, so a JSX attribute needs no
 * conversion step of its own: `normalizeMenuModel` is idempotent, which is what makes
 * the two safe to take through one door.
 */
export function buildGioMenu(input: AdwMenuInput | AdwMenuModel): Gio.Menu {
    const menu = new Gio.Menu();
    for (const node of normalizeMenuModel(input as AdwMenuInput)) menu.append_item(itemOf(node));
    return menu;
}

/**
 * Whether a value is a portable menu model rather than a `GMenuModel`.
 *
 * An ARRAY, and nothing else. `Gio.MenuModel` is a GObject and never an array, so the
 * test cannot confuse the two — and a caller passing a real `Gio.Menu` (the imperative
 * path every existing GJS application uses) keeps passing it straight through.
 */
export const isPortableMenu = (value: unknown): value is AdwMenuInput => Array.isArray(value);

/** A string-typed attribute of one item, or `undefined`. */
function attr(model: Gio.MenuModel, index: number, name: string): string | undefined {
    const value = model.get_item_attribute_value(index, name, GLib.VariantType.new('s'));
    return value === null ? undefined : value.get_string()[0];
}

/**
 * Reassemble the DETAILED action name GIO split into `action` + `target`.
 *
 * `set_detailed_action` parses on the way in, so nothing on a `GMenuModel` holds the
 * text the model was written with; this is the inverse, and it is what makes the round
 * trip below lossless for a targeted action rather than only for a bare one. A string
 * target takes the `::` form and every other `GVariant` its text form, which is exactly
 * how `g_action_print_detailed_name` chooses.
 */
function detailedAction(model: Gio.MenuModel, index: number): string | undefined {
    const name = attr(model, index, 'action');
    if (name === undefined) return undefined;
    const target = model.get_item_attribute_value(index, 'target', null);
    if (target === null) return name;
    const type = target.get_type_string();
    return type === 's' ? `${name}::${target.get_string()[0]}` : `${name}(${target.print(false)})`;
}

/**
 * A `GMenuModel` back as a portable model — the inverse of {@link buildGioMenu}.
 *
 * IT EXISTS TO MAKE THE LOSSLESS CLAIM MEASURABLE. ADR 0042 says the model maps onto
 * `Gio.Menu` with nothing left over; a builder alone cannot show that, because whatever
 * it drops is dropped in silence. `conformance/menu.ts` drives every vector through
 * `buildGioMenu` and back through this function and compares, so a forgotten attribute
 * fails a test naming it instead of disappearing from a popup nobody re-opened.
 *
 * It reads what GTK reads plus `id`, so an application's OWN extra attributes do not
 * survive the round trip — stated rather than implied: this is not a general
 * `GMenuModel` serialiser, it is the inverse of the builder above.
 *
 * TWO EDGES A HAND-BUILT `Gio.Menu` CAN REACH AND THE MODEL CANNOT, both matching GTK
 * rather than diverging from it:
 *
 *   · an item carrying BOTH links reads as a SECTION and its submenu is not walked.
 *     `GtkMenuTracker` decides the same way (`gtkmenutracker.c:317-352`): it tests
 *     `G_MENU_LINK_SECTION` first and
 *     recurses, so the submenu link is unreachable there too.
 *   · a non-string `label` reads as `''`. `attr()` asks for type `s`; so does
 *     `g_menu_item_get_attribute (item, "label", "&s", …)`, which fails the same way and
 *     leaves GTK drawing an unlabelled row.
 */
export function fromGioMenu(model: Gio.MenuModel): AdwMenuModel {
    const nodes: AdwMenuNode[] = [];
    for (let index = 0; index < model.get_n_items(); index += 1) {
        const section = model.get_item_link(index, Gio.MENU_LINK_SECTION);
        const submenu = model.get_item_link(index, Gio.MENU_LINK_SUBMENU);
        const label = attr(model, index, 'label');
        if (section !== null) {
            const node: Record<string, unknown> = { kind: 'section', items: fromGioMenu(section) };
            if (label !== undefined) node.label = label;
            const hint = attr(model, index, 'display-hint');
            if (hint !== undefined) node.displayHint = hint;
            const direction = attr(model, index, 'text-direction');
            if (direction !== undefined) node.textDirection = direction;
            nodes.push(node as unknown as AdwMenuNode);
            continue;
        }
        if (submenu !== null) {
            const node: Record<string, unknown> = { kind: 'submenu', label: label ?? '', items: fromGioMenu(submenu) };
            for (const [key, name] of [
                ['icon', 'icon'],
                ['submenuAction', 'submenu-action'],
                ['macosSpecial', 'gtk-macos-special'],
            ] as const) {
                const value = attr(model, index, name);
                if (value !== undefined) node[key] = value;
            }
            nodes.push(node as unknown as AdwMenuNode);
            continue;
        }
        // The key ORDER matches `normalizeMenuModel`'s, so a comparison that stringifies
        // is comparing menus rather than insertion order.
        const item: Record<string, unknown> = { kind: 'item', label: label ?? '' };
        const action = detailedAction(model, index);
        if (action !== undefined) item.action = action;
        for (const [key, name] of [
            ['icon', 'icon'],
            ['verbIcon', 'verb-icon'],
            ['accel', 'accel'],
            ['hiddenWhen', 'hidden-when'],
            ['custom', 'custom'],
            ['id', 'id'],
        ] as const) {
            const value = attr(model, index, name);
            if (value !== undefined) item[key] = value;
        }
        if (attr(model, index, 'use-markup') !== undefined) item.useMarkup = true;
        nodes.push(item as unknown as AdwMenuNode);
    }
    return nodes;
}
