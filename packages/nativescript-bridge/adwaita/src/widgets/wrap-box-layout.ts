// Wrap-box layout for NativeScript — the pure half.
//
// The widget is a `FlexboxLayout`, whose knobs are the same primitives the browser
// element maps onto, so every port resolves ONE decision in `@gjsify/adwaita-core`.
// (NS `WrapLayout` has only `orientation`/`itemWidth`/`itemHeight` and cannot express
// `justify`, `align` or `justify-last-line`.) The MAPPING onto those knobs —
// `wrapBoxFlexStyle`/`wrapBoxChildFlex` — is in the core too and is only re-exported
// here: it used to live in this file, and `@gjsify/adwaita-react-native` would have
// been the third renderer to write out the same `align` snap. What is genuinely
// NativeScript-specific is the SPACING: no NS layout has a gap property (`Style`
// carries no `columnGap`/`rowGap`), so the gaps come out of the children's margins,
// where the browser and React Native both write a real gap.
//
// No `@nativescript/core` VALUE imports, so specs run off-device (AGENTS.md).
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ADW_WRAP_BOX_DEFAULT_SPACING,
    normalizeWrapBoxSpacing,
    wrapBoxChildFlex,
    wrapBoxFlexStyle,
    type WrapBoxChildFlex,
    type WrapBoxFlexInput,
    type WrapBoxFlexStyle,
} from '@gjsify/adwaita-core';

export { normalizeWrapBoxSpacing, wrapBoxChildFlex, wrapBoxFlexStyle };
export type { WrapBoxChildFlex, WrapBoxFlexInput, WrapBoxFlexStyle };

/** `Adw.WrapBox:child-spacing` / `:line-spacing` default, in DIPs. Both are 0 in C. */
export const DEFAULT_WRAP_BOX_SPACING = ADW_WRAP_BOX_DEFAULT_SPACING;

/**
 * Whether writing `next` over `current` is a change the widget must act on.
 *
 * The comparison happens AFTER the clamp, so a negative value written over a
 * spacing of 0 is an early return: it neither reaches the layout nor notifies. Here
 * the same predicate decides whether every child's margin is rewritten.
 */
export function wrapBoxSpacingChanges(current: number, next: unknown): boolean {
    return normalizeWrapBoxSpacing(next) !== normalizeWrapBoxSpacing(current);
}

/**
 * The uniform margin that gives a `FlexboxLayout` child its share of the gaps.
 *
 * Half the spacing on each facing edge adds up to the whole gap between any two
 * neighbours. The margin string is NS's `top right bottom left` shorthand.
 *
 * Knowingly looser than libadwaita: the halves on the OUTER edges are an inset
 * `Adw.WrapBox` does not have. Invisible at the default spacing of 0 and bounded by
 * half a gap otherwise; the alternative is negative margins on the container, which
 * the NS CSS subset cannot be trusted with.
 */
export function wrapBoxChildMargin(childSpacing: number, lineSpacing: number): string {
    const alongLine = normalizeWrapBoxSpacing(childSpacing) / 2;
    const betweenLines = normalizeWrapBoxSpacing(lineSpacing) / 2;
    return `${betweenLines} ${alongLine} ${betweenLines} ${alongLine}`;
}
