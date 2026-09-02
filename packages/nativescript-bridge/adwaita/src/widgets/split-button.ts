// Split-button plumbing for NativeScript — the pure half.
//
// The split button's BEHAVIOUR is headless and lives in `@gjsify/adwaita-core`
// (ADR 0004). NativeScript-specific is the platform seam: the NS subset has no
// popover, so the dropdown opens a `Dialogs.action()` sheet, which takes a list of
// STRINGS and reports back the chosen STRING; and the action half's icon is an SVG
// string rather than an icon-theme name.
//
// A `GMenuModel` addresses its items BY POSITION, so that string round trip must not
// lose information: the sheet is fed strings unique by construction
// ({@link menuSheetActions}) and the answer maps back to exactly one position.
//
// Free of `@nativescript/core` value imports so the spec suite can exercise the real
// code off-device; `adw-split-button.ts` cannot, because `extends GridLayout`
// evaluates the bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { splitButtonArrowIcon } from '@gjsify/adwaita-core';
import type { AdwArrowIcon, AdwMenuEntry, SplitButtonDirection, SplitButtonState } from '@gjsify/adwaita-core';
import { openMenuSymbolic } from '@gjsify/adwaita-icons/actions';
import { panDownSymbolic, panEndSymbolic, panStartSymbolic, panUpSymbolic } from '@gjsify/adwaita-icons/ui';

// Re-exported so `adw-split-button.ts` and its consumers get both halves from one place.
export type { AdwMenuEntry, SplitButtonDirection };

/** Text of the sheet's dismiss button. */
export const MENU_CANCEL_LABEL = 'Cancel';

/**
 * Zero-width space, appended to make a colliding sheet entry unique. Invisible in the
 * platform sheet and not announced by TalkBack/VoiceOver, so two entries that read
 * `Copy` still read `Copy` while no longer being the same STRING.
 */
const DISAMBIGUATOR = '\u200B';

/**
 * The libadwaita arrow glyph names mapped to real Adwaita symbolic SVGs. Keyed by
 * {@link AdwArrowIcon} and therefore TOTAL: which glyph a direction gets is decided in
 * core, and a glyph with no SVG here is a compile error rather than a fallback arrow.
 */
export const ARROW_SVGS: Readonly<Record<AdwArrowIcon, string>> = {
    'open-menu-symbolic': openMenuSymbolic,
    'pan-down-symbolic': panDownSymbolic,
    'pan-up-symbolic': panUpSymbolic,
    'pan-start-symbolic': panStartSymbolic,
    'pan-end-symbolic': panEndSymbolic,
};

/**
 * Normalise a menu assigned from XML or app code into entries. A bare `string[]` is
 * accepted (the storybook passes one) and widens to the shared {@link AdwMenuEntry}.
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
 * The strings handed to `Dialogs.action()`, one per entry and each unique: a label
 * that collides with another entry — or with the dismiss button — gets zero-width
 * spaces appended until it is distinct, so {@link resolveMenuChoice} can tell them
 * apart.
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
 * The position the user chose, or `-1` when the sheet was dismissed. Feed it the SAME
 * array {@link menuSheetActions} produced, or the lookup is a guess.
 */
export function resolveMenuChoice(sheetActions: readonly string[], chosen: string | null | undefined): number {
    if (typeof chosen !== 'string') return -1;
    return sheetActions.indexOf(chosen);
}

/** The arrow SVG for a direction; the split button's `none` is the down caret, not a hamburger. */
export function splitButtonArrowSvg(direction: SplitButtonDirection): string {
    return ARROW_SVGS[splitButtonArrowIcon(direction)];
}

/**
 * Apply `AdwSplitButton.iconName = svg` to the content machine. The SVG string IS
 * the icon identity on NativeScript, so it goes where GTK puts the icon NAME.
 *
 * C offers no "unset the icon", only the side effect of filling another slot, so an
 * empty SVG clears the content and lets the label half take over again — what a
 * caller assigning `iconName` from a nullable lookup expects.
 */
export function setActionIcon(state: SplitButtonState, svg: string | null | undefined): void {
    const next = svg ?? '';
    if (next.length > 0) state.setIconName(next);
    else if (state.mode === 'icon') state.setChild(null);
}
