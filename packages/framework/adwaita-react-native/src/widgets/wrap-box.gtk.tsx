/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwWrapBox` on GTK — the real `Adw.WrapBox`. (The pragma above is required of every
// platform module; the reason is in `bin.gtk.tsx`.)
//
// THE PROPERTIES GO THROUGH THE CORE'S NORMALISERS FIRST, for the reason `clamp.gtk.tsx`
// measured on `maximum-size`: GObject gives one out-of-range value more than one answer.
// `child-spacing` is `g_param_spec_int (…, 0, G_MAXINT, 0, …)` and `align` is
// `g_param_spec_float (…, 0, 1, 0, …)`, so a negative spacing fails
// `g_param_value_validate` on an UPDATE and leaves the property alone while GObject
// CLAMPS the same value at construction — one authored value, two meanings inside one
// half. Normalising first means the widget only ever sees a value inside the range, so
// there is nothing left for GObject to refuse and nothing left for the two halves to
// disagree about.
//
// AN OMITTED PROPERTY IS NOT NORMALISED, and that is the same rule and the same reason as
// `clamp.gtk.tsx`'s: it must leave the real `Adw.WrapBox` on the INSTALLED libadwaita's
// default rather than pinning it to `@gjsify/adwaita-core`'s transcription of it, so a
// drift between the two is visible instead of silent.
//
// THE THREE BOOLEANS ARE PASSED THROUGH UNTOUCHED: `justify-last-line`,
// `line-homogeneous` and `wrap-reverse` are `g_param_spec_boolean`, which has no range to
// fall outside of, and the prop type admits nothing else.
//
// THE CHILD POLICY WAS MISSING FROM gtk-host UNTIL THIS WIDGET, and the fix went there
// rather than here: `adw-wrap-box` was in the generated tag table with no curated
// placement rule, so it could be created and never filled (`uncurated-placement` on the
// first child). It is now `ordered` over `append`/`insert_child_after`/`remove` in
// `descriptors/adw.ts`, measured on libadwaita 1.9.3.

import type { ReactElement } from 'react';

import {
    normalizeNaturalLineLength,
    normalizeWrapBoxAlign,
    normalizeWrapBoxJustify,
    normalizeWrapBoxLengthUnit,
    normalizeWrapBoxPackDirection,
    normalizeWrapBoxSpacing,
    normalizeWrapPolicy,
} from '@gjsify/adwaita-core';

import type { AdwWrapBoxProps } from '../props.js';

/**
 * An authored value as GObject would have to store it, or `undefined` for "not authored".
 *
 * One helper rather than fourteen ternaries, and the `undefined` branch is the part that
 * matters: it is what keeps an omitted property on the installed libadwaita's default.
 */
const authored = <Value, Stored>(value: Value | undefined, normalize: (value: Value) => Stored): Stored | undefined =>
    value === undefined ? undefined : normalize(value);

/** {@link import('./wrap-box.js').AdwWrapBox} on GTK. */
export function AdwWrapBox({
    children,
    childSpacing,
    childSpacingUnit,
    lineSpacing,
    lineSpacingUnit,
    align,
    justify,
    justifyLastLine,
    lineHomogeneous,
    naturalLineLength,
    naturalLineLengthUnit,
    packDirection,
    wrapReverse,
    wrapPolicy,
    orientation,
}: AdwWrapBoxProps): ReactElement | null {
    return (
        <adw-wrap-box
            child-spacing={authored(childSpacing, normalizeWrapBoxSpacing)}
            child-spacing-unit={authored(childSpacingUnit, normalizeWrapBoxLengthUnit)}
            line-spacing={authored(lineSpacing, normalizeWrapBoxSpacing)}
            line-spacing-unit={authored(lineSpacingUnit, normalizeWrapBoxLengthUnit)}
            align={authored(align, normalizeWrapBoxAlign)}
            justify={authored(justify, normalizeWrapBoxJustify)}
            justify-last-line={justifyLastLine}
            line-homogeneous={lineHomogeneous}
            natural-line-length={authored(naturalLineLength, normalizeNaturalLineLength)}
            natural-line-length-unit={authored(naturalLineLengthUnit, normalizeWrapBoxLengthUnit)}
            pack-direction={authored(packDirection, normalizeWrapBoxPackDirection)}
            wrap-reverse={wrapReverse}
            wrap-policy={authored(wrapPolicy, normalizeWrapPolicy)}
            orientation={orientation}
        >
            {children}
        </adw-wrap-box>
    );
}
