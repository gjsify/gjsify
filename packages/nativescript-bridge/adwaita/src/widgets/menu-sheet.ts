// A portable menu as a NativeScript action sheet — the pure half (ADR 0042).
//
// `Dialogs.action()` is the only menu surface the NS subset has: a title, a list of
// STRINGS and a cancel button, answering with the chosen STRING. Everything a
// `GMenuModel` carries has to survive that, and this module is where each part of it is
// decided ONCE for both menu-bearing widgets — `AdwSplitButton`'s dropdown and
// `GtkMenuButton` present the same sheet, and before ADR 0042 they had two different
// answers to every question below.
//
// WHAT THE SHEET DOES WITH EACH PART OF THE MODEL:
//
//   · SECTIONS are inlined, in order. A section is a visual grouping GTK draws with a
//     separator, so a flat list loses the RULE and not an item. The sheet draws no
//     separator, so nothing marks the boundary — declared, not hidden.
//   · SUBMENUS open a SECOND SHEET. That keeps "the user opened it" true, which
//     inlining would not, and a second sheet is the platform's own idiom for the same
//     gesture.
//   · An INSENSITIVE item is OMITTED. The platform sheet has no disabled row: a row
//     that can be tapped and does nothing is a worse answer than one that is not
//     offered, and it is the one shape a reader cannot diagnose. `hidden-when` items
//     the model hides are omitted for the same reason, one step earlier.
//   · CHECK and RADIO state is drawn as a leading tick in the LABEL. A DELIBERATE
//     SUBSTITUTION — GTK draws a `check`/`radio` node, and a sheet row is a string —
//     and the one that keeps a radio group readable at all. It is applied before the
//     uniqueness pass below, so the tick is part of the string that comes back.
//   · ICONS, ACCELERATORS and `use-markup` are not drawn: `action()` renders text.
//     They stay in the model for the surfaces that do.
//
// THE ROUND TRIP IS BY POSITION, NOT BY LABEL. `action()` reports a STRING, and two
// menu items may legally share a label — so the strings are made unique by
// construction ({@link menuSheetActions}) and the answer maps back to exactly one row,
// which carries the {@link AdwMenuFlatRow.path} the model addresses it by.
//
// Free of `@nativescript/core` value imports so the spec suite can exercise the real
// code off-device.
//
// Reference: refs/gtk/gtk/gtkpopovermenu.c (what the model carries)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { flattenMenu, menuNodeAt, resolveMenuItemState } from '@gjsify/adwaita-core';
import type { AdwMenuActions, AdwMenuFlatRow, AdwMenuModel, AdwMenuPath } from '@gjsify/adwaita-core';

/** Text of the sheet's dismiss button. */
export const MENU_CANCEL_LABEL = 'Cancel';

/**
 * Zero-width space, appended to make a colliding sheet entry unique. Invisible in the
 * platform sheet and not announced by TalkBack/VoiceOver, so two entries that read
 * `Copy` still read `Copy` while no longer being the same STRING.
 */
const DISAMBIGUATOR = '​';

/** The tick a checked row wears, since a sheet row cannot carry a `check` node. */
const CHECK_MARK = '✓ ';

/** A submenu row is a door, and the platform idiom for one is a trailing chevron. */
const SUBMENU_MARK = ' ›';

/** One row of the sheet: the string presented, and where in the model it came from. */
export interface MenuSheetRow {
    /** The string handed to `action()`, unique within the page. */
    readonly action: string;
    readonly path: AdwMenuPath;
    /** Whether choosing it opens another sheet rather than activating an item. */
    readonly submenu: boolean;
}

/**
 * The rows of ONE page — the model's root, or the submenu at `page`.
 *
 * `cancelLabel` seeds the uniqueness set, which is what makes a menu item literally
 * called "Cancel" distinguishable from the reader dismissing the sheet.
 */
export function menuSheetRows(
    model: AdwMenuModel,
    page: AdwMenuPath = [],
    actions?: AdwMenuActions,
    cancelLabel: string = MENU_CANCEL_LABEL,
): MenuSheetRow[] {
    const node = page.length === 0 ? null : menuNodeAt(model, page);
    const items = node !== null && node.kind !== 'item' ? node.items : model;
    const used = new Set<string>([cancelLabel]);
    const rows: MenuSheetRow[] = [];
    for (const row of flattenMenu(items, page)) {
        const text = sheetLabel(row, actions);
        if (text === null) continue;
        let candidate = text;
        while (used.has(candidate)) candidate += DISAMBIGUATOR;
        used.add(candidate);
        rows.push({ action: candidate, path: row.path, submenu: row.node.kind === 'submenu' });
    }
    return rows;
}

/** One row's text, or `null` when the sheet must not offer it at all. */
function sheetLabel(row: AdwMenuFlatRow, actions?: AdwMenuActions): string | null {
    if (row.node.kind === 'submenu') return `${row.node.label}${SUBMENU_MARK}`;
    const state = resolveMenuItemState(row.node, actions);
    if (!state.visible || !state.sensitive) return null;
    return state.toggled ? `${CHECK_MARK}${row.node.label}` : row.node.label;
}

/** Just the strings, in order — what `action()` takes. */
export const menuSheetActions = (rows: readonly MenuSheetRow[]): string[] => rows.map((row) => row.action);

/**
 * The row the reader chose, or `null` when the sheet was dismissed. Feed it the SAME
 * rows {@link menuSheetRows} produced, or the lookup is a guess.
 */
export function resolveMenuChoice(
    rows: readonly MenuSheetRow[],
    chosen: string | null | undefined,
): MenuSheetRow | null {
    if (typeof chosen !== 'string') return null;
    return rows.find((row) => row.action === chosen) ?? null;
}

/** What a caller supplies so this module never imports `@nativescript/core`. */
export type MenuSheetPresenter = (options: {
    title?: string;
    cancelButtonText: string;
    actions: string[];
}) => Promise<string | undefined>;

/**
 * Present the menu, descending into submenus, and answer with the chosen item's PATH.
 *
 * The loop is what makes a submenu a real submenu on a surface that has only one list:
 * choosing a submenu row presents that submenu's rows, with the submenu's own label as
 * the sheet title so the reader can see where they are. A dismissal at any depth ends
 * the interaction — there is no "back" button on a platform sheet, and inventing one as
 * a row would be a menu entry the model does not have.
 */
export async function presentMenuSheet(
    present: MenuSheetPresenter,
    model: AdwMenuModel,
    options: { title?: string; actions?: AdwMenuActions; cancelLabel?: string } = {},
): Promise<AdwMenuPath | null> {
    const cancelLabel = options.cancelLabel ?? MENU_CANCEL_LABEL;
    let page: AdwMenuPath = [];
    let title = options.title;
    // A model can nest as deeply as its author wrote it; the loop follows the reader,
    // and each pass either descends one level or ends.
    for (;;) {
        const rows = menuSheetRows(model, page, options.actions, cancelLabel);
        if (rows.length === 0) return null;
        const chosen = await present({
            title: title !== undefined && title.length > 0 ? title : undefined,
            cancelButtonText: cancelLabel,
            actions: menuSheetActions(rows),
        });
        const row = resolveMenuChoice(rows, chosen);
        if (row === null) return null;
        if (!row.submenu) return row.path;
        page = row.path;
        const node = menuNodeAt(model, page);
        title = node !== null && node.kind === 'submenu' ? node.label : undefined;
    }
}

/**
 * Refuse a JSON STRING where a menu model belongs, loudly.
 *
 * NativeScript's `Builder` assigns an XML attribute straight onto the property, so a
 * `menuModel="[…]"` in a view file lands here as a string. The model does not accept one
 * — the gallery probe that would have to prove the XML door compares a read-back by
 * IDENTITY, which no structured value satisfies — and left to `normalizeMenuModel` a
 * string is simply "not an array", so the author would get an EMPTY menu and no
 * diagnostic at all.
 *
 * A door that is shut may not also be silent. This is the sentence that says which.
 */
export function refuseMenuString(value: unknown, widget: string): void {
    if (typeof value !== 'string') return;
    throw new TypeError(
        `${widget}.menuModel takes a menu model, not the string ${JSON.stringify(value.slice(0, 40))}. ` +
            `NativeScript's XML Builder writes an attribute straight onto the property, so a ` +
            `menuModel="…" in a view file arrives here as text — which this port deliberately does not ` +
            `parse (ADR 0042). Assign the model from code, or keep this menu on a surface whose ` +
            `attribute door is open.`,
    );
}
