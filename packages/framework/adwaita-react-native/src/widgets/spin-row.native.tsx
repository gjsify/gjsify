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
// widget — which is why the two suites assert a rendered STRING and not just the number.
// They assert the same DIGITS and not the same string: `gtk_spin_button_update` formats
// through the C library's locale (measured `3,14` under de_DE) where `toFixed` is specified
// never to, so the GTK suite normalises the separator and the README names the divergence.
// `toFixed` and not a hand-rolled truncation: `Adw.SpinRow` renders through
// `gtk_spin_button_set_digits`, which rounds half away from zero, and so does `toFixed`.
//
// THE STEPPERS ARE THE CORE'S `increment`/`decrement`, so a press that would leave the range
// is a no-op with no re-render rather than a value that goes out of bounds and comes back.
// The two buttons stay in the tree and go `disabled` at the ends, which is the shape a suite
// can read — an absent button proves nothing about which end was reached.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import { SpinState, adjustmentRange, normalizeAdjustment } from '@gjsify/adwaita-core';

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
    adjustment,
    digits,
    onNotifyValue,
}: AdwSpinRowProps): ReactElement | null {
    // SEEDED IN ONE CALL, which is what the portable adjustment bought here. The three
    // bounds used to be set one at a time BEFORE the value, because `setValue` clamps
    // against whatever range is installed at the time and seeding `value` first clamped it
    // against the default 0…100 — a row authored `lower={200} upper={300} value={250}`
    // mounted at 100. `configure` takes the whole range at once, so there is no order for a
    // later edit to get wrong. The same hazard `spin-row.gtk.tsx` records, closed the same
    // way.
    const [row] = useState(() => {
        const state = new SpinState();
        state.configure(adjustment);
        if (value !== undefined) state.setValue(value);
        return state;
    });
    const [current, setCurrent] = useState(() => row.value);
    // The RANGE is held in state as well, because the two stepper buttons read it: a bound
    // that moves without moving the value would otherwise leave `disabled` on the old ends
    // — the value signal alone cannot say a range changed, which is why `Gtk.Adjustment`
    // has two.
    const [range, setRange] = useState(() => adjustmentRange(row.adjustment));

    // MEMOISED ON THE NUMBERS, NOT ON THE OBJECT, and this is the same measurement
    // `spin-row.gtk.tsx` carries about its `Gtk.Adjustment`: `adjustment={{ upper: 100 }}`
    // is a fresh literal on every render, so an effect keyed on the prop itself re-runs on
    // every re-render — and re-writing the authored value is exactly how a value the USER
    // stepped to gets taken back. `preferences.native.spec.tsx` presses `+` and then
    // re-renders with an unrelated prop, which is the assertion that fails without this.
    const authored = useMemo(
        () => normalizeAdjustment(adjustment),
        [
            adjustment?.lower,
            adjustment?.upper,
            adjustment?.stepIncrement,
            adjustment?.pageIncrement,
            adjustment?.pageSize,
            adjustment?.value,
        ],
    );
    // The value the props name, if either of them does — the `value` prop wins over one
    // written inside the adjustment, because it is the more specific of the two.
    const authoredValue = value ?? adjustment?.value;

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

    useEffect(() => row.subscribeChanged((next) => setRange(adjustmentRange(next))), [row]);

    // ONE effect for the range AND the value, which is what makes the two halves report the
    // same STREAM and not just the same final number. Two effects meant a range that moves
    // re-clamped the old value first and notified it — `[200, 250]` where the GTK half,
    // which builds one new `Gtk.Adjustment` from all six numbers, notifies `[250]`. The
    // divergence was in the writing, not in the arithmetic, so it goes away by writing once.
    //
    // A row that names NO value keeps the one it holds: the five bounds are written and the
    // value is left out, so an uncontrolled row does not snap back to 0 when a bound moves.
    useEffect(() => {
        const { value: _ignored, ...bounds } = authored;
        row.configure(authoredValue === undefined ? bounds : { ...bounds, value: authoredValue });
    }, [row, authored, authoredValue]);

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
            <Pressable accessibilityRole="button" disabled={current <= range[0]} onPress={decrement}>
                <Text>{DECREASE_GLYPH}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={current >= range[1]} onPress={increment}>
                <Text>{INCREASE_GLYPH}</Text>
            </Pressable>
        </Pressable>
    );
}
