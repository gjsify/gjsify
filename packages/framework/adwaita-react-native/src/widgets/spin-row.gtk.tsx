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
// is the three numbers, not the object identity.
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

import type { AdwSpinRowProps } from '../props.js';

/**
 * `SpinState`'s own defaults, which are the ones the React Native half falls back to.
 *
 * Exported so the spec asserts the two halves against ONE table rather than each against its
 * own literals. They are not libadwaita's: a bare `Gtk.Adjustment` is 0…0 with a step of 0,
 * which is a spin row that cannot move. `@gjsify/adwaita-core` picked 0…100 step 1, both
 * sibling renderers use it, and the GTK half adopts it here rather than shipping a widget
 * whose omitted range means something else than it does on a phone.
 */
export const ADW_SPIN_ROW_DEFAULTS = { lower: 0, upper: 100, stepIncrement: 1, value: 0 } as const;

/** {@link import('./spin-row.js').AdwSpinRow} on GTK. */
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
    const row = useRef<Adw.SpinRow | null>(null);

    const low = lower ?? ADW_SPIN_ROW_DEFAULTS.lower;
    const high = upper ?? ADW_SPIN_ROW_DEFAULTS.upper;
    const step = stepIncrement ?? ADW_SPIN_ROW_DEFAULTS.stepIncrement;
    const current = value ?? ADW_SPIN_ROW_DEFAULTS.value;

    const adjustment = useMemo(
        () =>
            new Gtk.Adjustment({
                lower: low,
                upper: high,
                stepIncrement: step,
                // `page-increment` is Page Up/Down and neither half exposes it; leaving it at
                // 0 would make those keys a no-op on GTK and a divergence nobody authored, so
                // it follows the step.
                pageIncrement: step,
                value: current,
            }),
        [low, high, step, current],
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
            adjustment={adjustment}
            digits={digits}
            onNotifyValue={onNotifyValue === undefined ? undefined : notifyValue}
        />
    );
}
