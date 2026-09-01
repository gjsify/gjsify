/** @jsxImportSource react */
// `AdwWrapBox` on React Native — libadwaita's line decision, on Yoga's knobs. (On the
// pragma, see `bin.native.tsx`.)
//
// EVERY PROPERTY IS RESOLVED THROUGH `@gjsify/adwaita-core` FIRST, and the normalisers do
// double duty here: they fill in libadwaita's default for an omitted property AND keep a
// value GObject would refuse out of the layout — `childSpacing={-5}` is 0, `align={2}` is
// 1, `naturalLineLength={-7}` is the UNSET sentinel and not a length. The GTK half runs
// the same calls, which is what makes the two answer alike; `wrap-box.gtk.tsx` carries
// the measurement behind the shared rule.
//
// THE MAPPING ONTO FLEX IS THE CORE'S TOO, and that is new in this slice.
// `wrapBoxFlexStyle`/`wrapBoxChildFlex` used to live in
// `@gjsify/adwaita-nativescript`'s `wrap-box-layout.ts`; this would have been the third
// renderer to write out the `align` snap, so they were lifted rather than copied. The
// snap is the part worth naming: C offsets the whole line block by
// `roundf (length_delta * align)`, a continuum, and flexbox has three main-axis
// positions.
//
// THE GAPS ARE REAL GAPS, unlike NativeScript's. `Style` there carries no
// `columnGap`/`rowGap`, so that port pays the spacing out of each child's margins and
// accepts half a gap of inset on the outer edges; React Native has had both gap
// properties since 0.71, so this half writes the gap libadwaita means. Which gap lands on
// which axis flips with `orientation`: `child-spacing` is ALONG the line and
// `line-spacing` is BETWEEN lines, and they are resolved through their OWN units, so they
// can legitimately disagree about the unit.
//
// EACH CHILD IS WRAPPED IN A `View`, because `flex-grow` and `flex-shrink` belong to the
// CHILD and this component does not own its children's styles. NativeScript sets them as
// attached properties (`FlexboxLayout.setFlexGrow`) and the browser publishes a custom
// property its stylesheet reads; neither seam exists here, and `cloneElement` would only
// reach children that forward a `style` prop — which a composite component need not do.
// The wrapper is therefore visible in the tree, and `wrap-box.native.spec.tsx` asserts
// it rather than leaving it as an implementation detail nobody wrote down.
//
// `natural-line-length` IS A MAX SIZE HERE, the same DELIBERATE DEVIATION
// `@gjsify/adwaita-web` records: libadwaita caps the box's NATURAL size request and
// leaves a larger allocation free to happen, and neither CSS nor Yoga has a property that
// caps only the intrinsic contribution. It is the intended use — limiting line length
// inside a popover — either way.

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import {
    ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET,
    normalizeNaturalLineLength,
    normalizeWrapBoxAlign,
    normalizeWrapBoxJustify,
    normalizeWrapBoxLengthUnit,
    normalizeWrapBoxPackDirection,
    normalizeWrapBoxSpacing,
    normalizeWrapPolicy,
    wrapBoxChildFlex,
    wrapBoxFlexStyle,
    wrapBoxLengthToPx,
    type WrapBoxFlexInput,
} from '@gjsify/adwaita-core';

import type { AdwWrapBoxProps } from '../props.js';

/**
 * The wrapper's key.
 *
 * `Children.toArray` has already given every ELEMENT a stable unique key, and passing it
 * on is what keeps a reorder a reorder: an index key would make React reuse the wrapper
 * and re-render the child into it, which is the identity bug the host's shadow tree is
 * about one layer down. A string or a number child has no key, and its index is all there
 * is.
 */
const keyOf = (child: ReactNode, index: number): string =>
    isValidElement(child) && child.key !== null ? child.key : `${index}`;

/** {@link import('./wrap-box.js').AdwWrapBox} on React Native. */
export function AdwWrapBox(props: AdwWrapBoxProps): ReactElement | null {
    const input: WrapBoxFlexInput = {
        orientation: props.orientation === 'vertical' ? 'vertical' : 'horizontal',
        packDirection: normalizeWrapBoxPackDirection(props.packDirection),
        wrapReverse: props.wrapReverse === true,
        justify: normalizeWrapBoxJustify(props.justify),
        justifyLastLine: props.justifyLastLine === true,
        align: normalizeWrapBoxAlign(props.align),
        lineHomogeneous: props.lineHomogeneous === true,
        wrapPolicy: normalizeWrapPolicy(props.wrapPolicy),
    };

    const children = Children.toArray(props.children);
    const container = wrapBoxFlexStyle(input);
    // The PER-CHILD answer, not the container's `childFlexGrow`/`childFlexShrink`. Those
    // describe a child on a COMPLETE line; `wrapBoxChildFlex` also knows the case a
    // container knob cannot carry — one child, therefore one line, therefore the FINAL
    // line — where `justify-last-line` decides and `spread` stretches instead of
    // spreading. Reading them off the container answer would get the single-child box
    // wrong, which is the common box.
    const flex = wrapBoxChildFlex(input, children.length);

    const childGap = wrapBoxLengthToPx(
        normalizeWrapBoxSpacing(props.childSpacing),
        normalizeWrapBoxLengthUnit(props.childSpacingUnit),
    );
    const lineGap = wrapBoxLengthToPx(
        normalizeWrapBoxSpacing(props.lineSpacing),
        normalizeWrapBoxLengthUnit(props.lineSpacingUnit),
    );
    const natural = wrapBoxLengthToPx(
        normalizeNaturalLineLength(props.naturalLineLength),
        normalizeWrapBoxLengthUnit(props.naturalLineLengthUnit),
    );
    const vertical = input.orientation === 'vertical';
    const capped = natural !== ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET;

    const style: ViewStyle = {
        flexDirection: container.flexDirection,
        flexWrap: container.flexWrap,
        justifyContent: container.justifyContent,
        alignContent: container.alignContent,
        // Each child is allocated the FULL cross extent of its line —
        // `h = line_size` in adw-wrap-layout.c:746-751. Yoga's own default, written
        // out because it is libadwaita's rule and not a default to lean on.
        alignItems: 'stretch',
        columnGap: vertical ? lineGap : childGap,
        rowGap: vertical ? childGap : lineGap,
        ...(capped ? (vertical ? { maxHeight: natural } : { maxWidth: natural }) : {}),
    };
    const childStyle: ViewStyle = { flexGrow: flex.flexGrow, flexShrink: flex.flexShrink };

    return (
        <View style={style}>
            {children.map((child, index) => (
                <View key={keyOf(child, index)} style={childStyle}>
                    {child}
                </View>
            ))}
        </View>
    );
}
