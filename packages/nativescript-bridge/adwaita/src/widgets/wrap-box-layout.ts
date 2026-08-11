// Wrap-box layout for NativeScript — the pure half.
//
// The widget is a `FlexboxLayout`, whose knobs are the same primitives the browser
// element maps onto, so both ports resolve ONE decision in `@gjsify/adwaita-core`.
// (NS `WrapLayout` has only `orientation`/`itemWidth`/`itemHeight` and cannot express
// `justify`, `align` or `justify-last-line`.) NativeScript-specific here is the
// SPACING: no NS layout has a gap property (`Style` carries no `columnGap`/`rowGap`),
// so the gaps come out of the children's margins.
//
// No `@nativescript/core` VALUE imports, so specs run off-device (AGENTS.md).
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ADW_WRAP_BOX_DEFAULT_SPACING,
    normalizeWrapBoxSpacing,
    resolveWrapBoxLine,
    wrapPolicyFlexShrink,
    type AdwWrapBoxJustify,
    type AdwWrapBoxOrientation,
    type AdwWrapBoxPackDirection,
    type AdwWrapPolicy,
} from '@gjsify/adwaita-core';

export { normalizeWrapBoxSpacing };

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

/** The `FlexboxLayout` knobs a wrap box's properties resolve to. */
export interface WrapBoxFlexStyle {
    /** `FlexboxLayout:flexDirection` — the main axis, reversed for `end-to-start`. */
    flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse';
    /** `FlexboxLayout:flexWrap` — always wrapping; reversed by `wrap-reverse`. */
    flexWrap: 'wrap' | 'wrap-reverse';
    /** `FlexboxLayout:justifyContent` — where a COMPLETE line's leftover goes. */
    justifyContent: 'flex-start' | 'center' | 'flex-end' | 'space-between';
    /** `FlexboxLayout:alignContent` — `line-homogeneous` stretches the lines. */
    alignContent: 'stretch' | 'flex-start';
    /** `FlexboxLayout.setFlexGrow` for a child on a complete line. */
    childFlexGrow: number;
    /** `FlexboxLayout.setFlexShrink` for every child — `wrap-policy`. */
    childFlexShrink: number;
}

/** The widget properties the two resolvers read. */
export interface WrapBoxFlexInput {
    orientation: AdwWrapBoxOrientation;
    packDirection: AdwWrapBoxPackDirection;
    wrapReverse: boolean;
    justify: AdwWrapBoxJustify;
    justifyLastLine: boolean;
    align: number;
    lineHomogeneous: boolean;
    wrapPolicy: AdwWrapPolicy;
}

/**
 * `align` as a `justifyContent` keyword.
 *
 * C offsets the whole line block by `roundf (length_delta * align)` — a continuum.
 * Flexbox has three main-axis positions, so the nearest one is taken: the
 * renderer's approximation, not libadwaita's rule, and the same one the browser
 * element makes.
 */
function alignToJustifyContent(align: number): 'flex-start' | 'center' | 'flex-end' {
    if (align < 0.25) return 'flex-start';
    if (align < 0.75) return 'center';
    return 'flex-end';
}

/**
 * The CONTAINER half of the decision, resolved onto `FlexboxLayout`.
 *
 * The line DECISION is `resolveWrapBoxLine` in `@gjsify/adwaita-core`, held to
 * `WRAP_BOX_LINE_VECTORS`; this function only maps its answer onto the knobs NS has.
 *
 * `FlexboxLayout` has ONE `justifyContent` for every line, so it can only carry the
 * COMPLETE-line rule. NativeScript offers no `:only-child` selector and no generated
 * content, so the final-line rule has no container-level expression at all; the
 * single-child case is reached through {@link wrapBoxChildFlex}.
 */
export function wrapBoxFlexStyle(input: WrapBoxFlexInput): WrapBoxFlexStyle {
    const axis = input.orientation === 'vertical' ? 'column' : 'row';
    const line = resolveWrapBoxLine({
        justify: input.justify,
        justifyLastLine: input.justifyLastLine,
        align: input.align,
        lastLine: false,
        childrenInLine: 2,
    });
    return {
        flexDirection: input.packDirection === 'end-to-start' ? (`${axis}-reverse` as const) : axis,
        flexWrap: input.wrapReverse ? 'wrap-reverse' : 'wrap',
        justifyContent: line.growGaps ? 'space-between' : alignToJustifyContent(line.align),
        alignContent: input.lineHomogeneous ? 'stretch' : 'flex-start',
        childFlexGrow: line.growChildren ? 1 : 0,
        childFlexShrink: wrapPolicyFlexShrink(input.wrapPolicy),
    };
}

/** What one child of the box gets set on it. */
export interface WrapBoxChildFlex {
    /** `FlexboxLayout.setFlexGrow` — whether this child absorbs the line's leftover. */
    flexGrow: number;
    /** `FlexboxLayout.setFlexShrink` — `wrap-policy`, the same for every child. */
    flexShrink: number;
}

/**
 * The PER-CHILD half of the decision, which the container knobs cannot carry.
 *
 * A box with exactly ONE child has one line, that line is the LAST one, and its
 * child is alone on it — so it is governed by `justify-last-line`, and `spread`
 * STRETCHES it rather than spreading anything (C guards the keep-at-minimum branch
 * with `n_children > 1`).
 *
 * `childCount` is the box's own child count, the most a renderer knows without a
 * layout pass: 1 is the lone-child-on-the-final-line case exactly, anything more
 * means at least one complete line.
 */
export function wrapBoxChildFlex(input: WrapBoxFlexInput, childCount: number): WrapBoxChildFlex {
    const alone = childCount === 1;
    const line = resolveWrapBoxLine({
        justify: input.justify,
        justifyLastLine: input.justifyLastLine,
        align: input.align,
        lastLine: alone,
        childrenInLine: alone ? 1 : 2,
    });
    return { flexGrow: line.growChildren ? 1 : 0, flexShrink: wrapPolicyFlexShrink(input.wrapPolicy) };
}
