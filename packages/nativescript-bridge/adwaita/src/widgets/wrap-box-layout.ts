// Wrap-box layout for NativeScript — the pure half.
//
// `Adw.WrapBox` used to have almost no NativeScript counterpart: the port was
// built on NS `WrapLayout`, which exposes exactly three knobs (`orientation`,
// `itemWidth`, `itemHeight`), so `justify`, `align` and `justify-last-line` had
// nowhere to land and this module held the spacing contract alone.
//
// That was the wrong container. NativeScript also ships `FlexboxLayout`, with
// `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignContent`
// and per-child `setFlexGrow` / `setFlexShrink` — the same primitives the
// browser element maps onto. So the widget switched, and everything the browser
// port can express this port can express too, off ONE decision in
// `@gjsify/adwaita-core` rather than a second reading of the C.
//
// What stays NativeScript-specific is the spacing, because `FlexboxLayout` has
// no gap property either (NS `Style` carries no `columnGap`/`rowGap`): the gaps
// come out of the children's margins.
//
// Free of `@nativescript/core` VALUE imports — like `icon-path.ts`,
// `row-press.ts`, `chrome.ts` and `split-view-width.ts` — so the spec suite
// exercises the shipping code rather than a transcription of it. The widget
// class cannot serve that role: it `extends FlexboxLayout`, which evaluates the
// bare `@nativescript/core` specifier at module-eval and is unresolvable
// off-device.
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

/**
 * `Adw.WrapBox:child-spacing` / `:line-spacing` default, in DIPs.
 *
 * Both are `g_param_spec_int (…, 0, G_MAXINT, 0, …)` — adw-wrap-box.c:285-287
 * and :393-395. The port used to default both to 6, so identical markup was
 * looser on a phone than in the browser and an EMPTY wrap box was already 12
 * DIPs tall.
 */
export const DEFAULT_WRAP_BOX_SPACING = ADW_WRAP_BOX_DEFAULT_SPACING;

/**
 * Whether writing `next` over `current` is a change the widget must act on.
 *
 * The comparison happens AFTER the clamp (adw-wrap-box.c:592-593, :930-931), so
 * a negative value written over a spacing of 0 is an early return: it neither
 * reaches the layout nor notifies. On this port the same predicate decides
 * whether every child's margin is rewritten.
 */
export function wrapBoxSpacingChanges(current: number, next: unknown): boolean {
    return normalizeWrapBoxSpacing(next) !== normalizeWrapBoxSpacing(current);
}

/**
 * The uniform margin that gives a `FlexboxLayout` child its share of the gaps.
 *
 * NativeScript has no gap property on any layout — `Style` carries no
 * `columnGap`/`rowGap` — so the inter-item spacing has to come out of the
 * children: half of it on each facing edge adds up to the whole gap between any
 * two neighbours. The margin string is NS's `top right bottom left` shorthand.
 *
 * This is the one place the port is knowingly looser than libadwaita: the halves
 * on the OUTER edges are an inset `Adw.WrapBox` does not have. It is invisible
 * at the default spacing of 0 and bounded by half a gap otherwise, where the
 * alternative — negative margins on the container — is not something the NS CSS
 * subset can be trusted with.
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
 * C offsets the whole line block by `roundf (length_delta * align)` — a
 * continuum. Flexbox has three main-axis positions, so the nearest one is taken;
 * that is the renderer's approximation, not libadwaita's rule, and it is the
 * same one the browser element makes.
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
 * `WRAP_BOX_LINE_VECTORS` — this function only maps its answer onto the knobs NS
 * has, exactly as the browser element maps it onto CSS.
 *
 * Like a flex container, `FlexboxLayout` has ONE `justifyContent` for every
 * line, so it can only carry the COMPLETE-line rule. NativeScript offers no
 * `:only-child` selector and no generated content, so the final-line rule has no
 * container-level expression at all; what it CAN reach is the single-child case,
 * through {@link wrapBoxChildFlex}.
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
 * Two of libadwaita's rules are facts about a child rather than about the box,
 * and a single `justifyContent` has nowhere to put either. A box with exactly
 * ONE child has one line, that line is the LAST one, and its child is alone on
 * it — so it is governed by `justify-last-line`, and `spread` STRETCHES it
 * rather than spreading anything (`n_children > 1` guards the keep-at-minimum
 * branch, adw-wrap-layout.c:338; adw-wrap-box.c:349-352 says so outright).
 *
 * `childCount` is the box's own child count, which is the most a renderer knows
 * without a layout pass: 1 means the lone-child-on-the-final-line case exactly,
 * anything more means at least one complete line.
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
