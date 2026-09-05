/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwSpinRow` on GTK — the real `Adw.SpinRow`. The adjustment does the clamping. (On the
// pragma, see `bin.gtk.tsx`.)
//
// `SpinState` IS NOT USED HERE, for the reason `clamp.gtk.tsx` gives about `clampAllocate`:
// a real `Gtk.Adjustment` is right there, and clamping twice would give the row two
// authorities for its own value.
//
// THE ADJUSTMENT IS MEMOISED, and it is the same measurement `combo-row.gtk.tsx` carries
// about its model: gtk-host writes a property only when the prop changes, and a freshly
// constructed `Gtk.Adjustment` is a new value every render, so an unmemoised one would be
// re-set on every parent re-render and take the value back to whatever was authored. The key
// is the six numbers, not the object identity — and they are six because the authored value
// arrives as ONE portable `AdwAdjustment` now (ADR 0047), normalised by the core rather than
// defaulted here.
//
// THIS FILE IS WHERE THE PORTABLE VALUE BECOMES A REAL `Gtk.Adjustment`. That edge belongs
// here and not in `@gjsify/adwaita-core`, which imports no `gi://` and runs on a phone.
//
// `value` IS ON THE ADJUSTMENT AND NOT ON THE ROW, and the order is the reason.
// `Adw.SpinRow:value` forwards to the adjustment and is clamped by whatever range that
// adjustment currently has — and a `Gtk.Adjustment` constructed without one is 0…0. Writing
// the value as a row property therefore has a window in which the range is not yet the
// authored one, and gtk-host gives no ordering guarantee between two props of the same
// element. Constructing the adjustment with its value closes the window instead of relying on
// an order. `preferences.gtk.spec.tsx` asserts a value authored BELOW the range comes back at
// the bound, which is the assertion that would fail if the range arrived late.

import Gtk from 'gi://Gtk?version=4.0';
import type Adw from 'gi://Adw?version=1';
import { useCallback, useMemo, useRef, type ReactElement } from 'react';

import { ADW_ADJUSTMENT_DEFAULTS, clampAdjustmentValue, normalizeAdjustment } from '@gjsify/adwaita-core';

import type { AdwSpinRowProps } from '../props.js';

/**
 * The defaults both halves fall back to — re-exported from `@gjsify/adwaita-core`, which is
 * where they moved with the value they describe (ADR 0047).
 *
 * Kept exported under this name because the spec asserts the two halves against ONE table
 * rather than each against its own literals. They are not libadwaita's: a bare
 * `Gtk.Adjustment` is 0…0 with a step of 0, which is a spin row that cannot move.
 */
export const ADW_SPIN_ROW_DEFAULTS = ADW_ADJUSTMENT_DEFAULTS;

/** {@link import('./spin-row.js').AdwSpinRow} on GTK. */
export function AdwSpinRow({
    title,
    subtitle,
    value,
    adjustment,
    digits,
    onNotifyValue,
}: AdwSpinRowProps): ReactElement | null {
    const row = useRef<Adw.SpinRow | null>(null);

    // The core fills the authored subset out to six numbers, so this file no longer picks a
    // default per field. The value is clamped HERE rather than left to the constructor: a
    // `Gtk.Adjustment` clamps its own value against whatever range is installed when the
    // property is written, and `g_object_new` gives no order between two of them — so a
    // value authored below the range is clamped by the CORE, which both halves share, and
    // the two suites can assert the same number.
    const range = normalizeAdjustment(adjustment);
    const current = clampAdjustmentValue(range, value ?? range.value);

    const adjusted = useMemo(
        () =>
            new Gtk.Adjustment({
                lower: range.lower,
                upper: range.upper,
                stepIncrement: range.stepIncrement,
                pageIncrement: range.pageIncrement,
                pageSize: range.pageSize,
                value: current,
            }),
        [range.lower, range.upper, range.stepIncrement, range.pageIncrement, range.pageSize, current],
    );

    const notifyValue = useCallback(() => {
        const widget = row.current;
        if (widget !== null) onNotifyValue?.(widget.value);
    }, [onNotifyValue]);

    return (
        <adw-spin-row
            ref={row}
            title={title}
            subtitle={subtitle}
            adjustment={adjusted}
            digits={digits}
            onNotifyValue={onNotifyValue === undefined ? undefined : notifyValue}
        />
    );
}
