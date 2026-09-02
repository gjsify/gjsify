/** @jsxImportSource react */
// `AdwSpinRow` on React Native — `Gtk.Adjustment`'s clamp, run in TypeScript. (On the
// pragma, see `bin.native.tsx`.)
//
// `@gjsify/adwaita-core`'s `SpinState` IS the adjustment: it clamps on EVERY mutation, not
// only on a stepper press, and it re-clamps the value when a BOUND moves under it — which is
// the half a hand-written port drops, because `value` looks like the only thing that
// changes. Both are asserted here and on the GTK half with the same numbers.
//
// `digits` IS THIS FILE'S, BECAUSE THE CORE HAS NO `digits`. `SpinState` is the adjustment
// and an adjustment has no display format; `AdwSpinRow:digits` is a ROW property. So the
// value is formatted here with `toFixed`, and the GTK half hands the same number to the real
// widget — which is why the two suites assert the same STRING, not just the same number.
// `toFixed` and not a hand-rolled truncation: `Adw.SpinRow` renders through
// `gtk_spin_button_set_digits`, which rounds half away from zero, and so does `toFixed`.
//
// THE STEPPERS ARE THE CORE'S `increment`/`decrement`, so a press that would leave the range
// is a no-op with no re-render rather than a value that goes out of bounds and comes back.
// The two buttons stay in the tree and go `disabled` at the ends, which is the shape a suite
// can read — an absent button proves nothing about which end was reached.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import { SpinState } from '@gjsify/adwaita-core';

import type { AdwSpinRowProps } from '../props.js';
import { ADW_ROW_STYLE, AdwRowLabels } from '../row-shell.native.js';

/**
 * The two stepper glyphs.
 *
 * `value-decrease-symbolic`/`value-increase-symbolic` are icon-theme names and this package
 * ships no icon renderer for React Native. U+2212 MINUS SIGN rather than a hyphen, which is
 * what `@gjsify/adwaita-web` draws in the same place; the plus is unambiguous.
 */
const DECREASE_GLYPH = '−';

/** @see {@link DECREASE_GLYPH} */
const INCREASE_GLYPH = '+';

/** {@link import('./spin-row.js').AdwSpinRow} on React Native. */
export function AdwSpinRow({
    title,
    subtitle,
    value,
    lower,
    upper,
    stepIncrement,
    digits,
    onNotifyValue,
}: AdwSpinRowProps): ReactElement | null {
    // SEEDED IN THE INITIALISER, and IN THIS ORDER. The bounds are set before the value,
    // because `setValue` clamps against whatever range is installed at the time — seeding
    // `value` first would clamp it against `SpinState`'s default 0…100 and a row authored
    // `lower={200} upper={300} value={250}` would mount at 100. Measured, and it is the same
    // ordering hazard `spin-row.gtk.tsx` carries about the adjustment.
    const [row] = useState(() => {
        const state = new SpinState();
        if (lower !== undefined) state.setMin(lower);
        if (upper !== undefined) state.setMax(upper);
        if (stepIncrement !== undefined) state.setStep(stepIncrement);
        if (value !== undefined) state.setValue(value);
        return state;
    });
    const [current, setCurrent] = useState(() => row.value);

    useEffect(
        () =>
            row.subscribe((change) => {
                setCurrent(change.value);
                // Programmatic changes report too — `props.ts` carries why, and here it is
                // load-bearing in a second way: a bound that moves under the value produces a
                // change nobody asked for, and a consumer holding the value in its own state
                // has to hear about it or the two drift.
                onNotifyValue?.(change.value);
            }),
        [row, onNotifyValue],
    );

    // One effect per property, in the same order as the initialiser and for the same reason.
    useEffect(() => {
        if (lower !== undefined) row.setMin(lower);
    }, [row, lower]);
    useEffect(() => {
        if (upper !== undefined) row.setMax(upper);
    }, [row, upper]);
    useEffect(() => {
        if (stepIncrement !== undefined) row.setStep(stepIncrement);
    }, [row, stepIncrement]);
    useEffect(() => {
        if (value !== undefined) row.setValue(value);
    }, [row, value]);

    const decrement = useCallback(() => {
        row.decrement();
    }, [row]);
    const increment = useCallback(() => {
        row.increment();
    }, [row]);

    return (
        <Pressable style={ADW_ROW_STYLE} accessibilityRole="adjustable">
            <AdwRowLabels title={title} subtitle={subtitle} />
            <Text>{current.toFixed(digits ?? 0)}</Text>
            <Pressable accessibilityRole="button" disabled={current <= row.min} onPress={decrement}>
                <Text>{DECREASE_GLYPH}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={current >= row.max} onPress={increment}>
                <Text>{INCREASE_GLYPH}</Text>
            </Pressable>
        </Pressable>
    );
}
