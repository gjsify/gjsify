// Split-button plumbing for NativeScript — the pure half.
//
// The split button's BEHAVIOUR is headless and lives in `@gjsify/adwaita-core`
// (ADR 0004). NativeScript-specific is the platform seam: the NS subset has no
// popover, so the dropdown opens a `Dialogs.action()` sheet — which `menu-sheet.ts`
// now owns for BOTH menu-bearing widgets (ADR 0042) — and the action half's icon is an
// SVG string rather than an icon-theme name.
//
// Free of `@nativescript/core` value imports so the spec suite can exercise the real
// code off-device; `adw-split-button.ts` cannot, because `extends GridLayout`
// evaluates the bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { splitButtonArrowIcon } from '@gjsify/adwaita-core';
import type { AdwArrowIcon, SplitButtonDirection, SplitButtonState } from '@gjsify/adwaita-core';
import { openMenuSymbolic } from '@gjsify/adwaita-icons/actions';
import { panDownSymbolic, panEndSymbolic, panStartSymbolic, panUpSymbolic } from '@gjsify/adwaita-icons/ui';

// Re-exported so `adw-split-button.ts` and its consumers get both halves from one place.
export type { SplitButtonDirection };

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
