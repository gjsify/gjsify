// Split-button plumbing for NativeScript — the pure half.
//
// The split button's BEHAVIOUR is headless and lives in `@gjsify/adwaita-core`
// (ADR 0004). What is NativeScript-specific is only the platform seam: there is
// no popover in the NS subset, so the dropdown opens a `Dialogs.action()` sheet,
// which takes a list of STRINGS and reports back the chosen STRING; and the
// action half's icon is an SVG string rather than an icon-theme name.
//
// That round trip is where the port used to lose information. `indexOf(chosen)`
// on the raw labels meant two entries called `Copy` always dispatched the first,
// and an entry called `Cancel` was indistinguishable from dismissing the sheet —
// dismissing it fired a spurious activation of entry 0. A `GMenuModel` addresses
// its items BY POSITION (adw-split-button.c:385-388), so the sheet is fed
// strings that are unique by construction and the answer maps back to exactly
// one position.
//
// This module is deliberately FREE of `@nativescript/core` value imports — like
// `icon-path.ts`, `row-press.ts` and `avatar-color.ts` — so the spec suite can
// exercise the real code off-device. `adw-split-button.ts` cannot serve that
// role: it `extends GridLayout`, which evaluates the bare `@nativescript/core`
// specifier at module-eval and is unresolvable on GJS/Node.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (menubutton arrow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { splitButtonArrowIcon } from '@gjsify/adwaita-core';
import type { AdwMenuEntry, SplitButtonDirection, SplitButtonState } from '@gjsify/adwaita-core';
import { openMenuSymbolic } from '@gjsify/adwaita-icons/actions';
import { panDownSymbolic, panEndSymbolic, panStartSymbolic, panUpSymbolic } from '@gjsify/adwaita-icons/ui';

// Re-exported so `adw-split-button.ts` and its consumers get both halves from
// one place, the way `avatar-color.ts` re-exports `avatarInitials`.
export type { AdwMenuEntry, SplitButtonDirection };

/** Text of the sheet's dismiss button. */
export const MENU_CANCEL_LABEL = 'Cancel';

/**
 * Zero-width space, appended to make a colliding sheet entry unique.
 *
 * Invisible in the platform sheet and not announced by TalkBack/VoiceOver, so
 * two entries that read `Copy` still read `Copy` — they are just no longer the
 * same STRING, which is what lets the answer resolve to one position.
 */
const DISAMBIGUATOR = '\u200B';

/** The libadwaita arrow glyph names mapped to real Adwaita symbolic SVGs. */
const ARROW_SVGS: Readonly<Record<string, string>> = {
    'open-menu-symbolic': openMenuSymbolic,
    'pan-down-symbolic': panDownSymbolic,
    'pan-up-symbolic': panUpSymbolic,
    'pan-start-symbolic': panStartSymbolic,
    'pan-end-symbolic': panEndSymbolic,
};

/**
 * Normalise a menu assigned from XML or app code into entries.
 *
 * A bare `string[]` is accepted because that is what `AdwSplitButton.menu` used
 * to be and what the storybook still passes; it widens to the shared
 * {@link AdwMenuEntry} without breaking a caller.
 */
export function toMenuEntries(value: readonly (string | AdwMenuEntry)[] | null | undefined): AdwMenuEntry[] {
    if (!Array.isArray(value)) return [];
    const entries: AdwMenuEntry[] = [];
    for (const item of value) {
        if (typeof item === 'string') entries.push({ label: item });
        else if (item !== null && typeof item === 'object' && typeof item.label === 'string') entries.push({ ...item });
    }
    return entries;
}

/**
 * The strings handed to `Dialogs.action()`, one per entry and each unique.
 *
 * A label that collides with another entry — or with the dismiss button — gets
 * zero-width spaces appended until it is distinct. Nothing changes on screen;
 * what changes is that {@link resolveMenuChoice} can now tell the entries apart.
 */
export function menuSheetActions(entries: readonly AdwMenuEntry[], cancelLabel: string = MENU_CANCEL_LABEL): string[] {
    // Seeding with the cancel text is what makes a menu entry literally called
    // "Cancel" distinguishable from the user dismissing the sheet.
    const used = new Set<string>([cancelLabel]);
    const actions: string[] = [];
    for (const entry of entries) {
        let candidate = entry.label;
        while (used.has(candidate)) candidate += DISAMBIGUATOR;
        used.add(candidate);
        actions.push(candidate);
    }
    return actions;
}

/**
 * The position the user chose, or `-1` when the sheet was dismissed.
 *
 * Feed it the SAME array {@link menuSheetActions} produced: the strings are
 * unique there, so the lookup is a position and not a guess.
 */
export function resolveMenuChoice(sheetActions: readonly string[], chosen: string | null | undefined): number {
    if (typeof chosen !== 'string') return -1;
    return sheetActions.indexOf(chosen);
}

/** The arrow SVG for a direction, keyed off the core's glyph map. */
export function splitButtonArrowSvg(direction: SplitButtonDirection): string {
    return ARROW_SVGS[splitButtonArrowIcon(direction)] ?? panDownSymbolic;
}

/**
 * Apply `AdwSplitButton.actionIcon = svg` to the content machine.
 *
 * The SVG string IS the icon identity on NativeScript (no icon theme is
 * resolved), so it goes in where GTK puts the icon NAME. Clearing it is the
 * mapping worth having in one place: C offers no "unset the icon", only the
 * side effect of filling another slot (adw-split-button.c:749-771), so an empty
 * SVG clears the content and lets the label half take over again — which is what
 * every caller assigning `actionIcon` from a nullable lookup expects.
 *
 * Lives here rather than in the widget so it is unit-testable off-device: the
 * widget module `extends GridLayout` and cannot be imported on GJS/Node.
 */
export function setActionIcon(state: SplitButtonState, svg: string | null | undefined): void {
    const next = svg ?? '';
    if (next.length > 0) state.setIconName(next);
    else if (state.mode === 'icon') state.setChild(null);
}
