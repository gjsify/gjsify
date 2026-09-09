// The portable adjustment as a real `Gtk.Adjustment` (ADR 0047 § Amendment).
//
// The third value on the ParamSpec seam, after the menu (`menu.ts`) and the list
// (`list-model.ts`), and the widest of the three: an adjustment property sits on seven
// GTK widget interfaces (`AdwSpinRow`, `GtkSpinButton`, `GtkRange`, `GtkScaleButton`,
// `GtkScrollbar`, `GtkScrolledWindow`, `GtkScrollable`), so one `coerce` branch is what
// lets `<adw-spin-row adjustment={{ lower: 0, upper: 100 }}>` and
// `<gtk-scrolled-window hadjustment={{ … }}>` be written at all.
//
// THE OBJECT IS THE WHOLE ADJUSTMENT. `normalizeAdjustment` fills an authored subset out
// to six numbers from `ADW_ADJUSTMENT_DEFAULTS` and clamps the value; what it answers is
// what GTK gets, and `ADJUSTMENT_AUTHORED_VECTORS` is driven verbatim through here so
// the core's answer and the real adjustment's cannot disagree. That is deliberately the
// READ of `spin-row.gtk.tsx` in `@gjsify/adwaita-react-native` and NOT the read of
// `SpinState.configure`, which keeps unwritten fields: a stateful surface has a state
// to keep them from, and a props object has not — it is a complete description, the
// way `new Gtk.Adjustment({ lower, upper })` in a GJS application is. The consequence
// is the same as that line's, and `adjustment.spec.ts` pins it: replacing a mounted
// widget's adjustment with an input that names no `value` lands the value on the LOWER
// bound. An author who wants the value to survive a range change writes it INSIDE the
// adjustment, which is where the GJS and Blueprint spellings already put it.
//
// Values through `gi://`, types through `@girs/*`.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import type { AdwAdjustment, AdwAdjustmentInput } from '@gjsify/adwaita-core';
import { normalizeAdjustment } from '@gjsify/adwaita-core';

/**
 * A portable adjustment as a live `Gtk.Adjustment`.
 *
 * `value` is written LAST, and the core has clamped it before it gets here, so neither
 * half of the two-clamp hazard applies: GTK's own `set_value` clamps against whatever
 * range is installed at the moment the property is written, and the order
 * `g_object_new` writes two properties in is not a contract. A value that is already
 * inside the range survives either order.
 */
export function buildAdjustment(input: AdwAdjustmentInput): Gtk.Adjustment {
    const adjustment = normalizeAdjustment(input);
    return new Gtk.Adjustment({
        lower: adjustment.lower,
        upper: adjustment.upper,
        stepIncrement: adjustment.stepIncrement,
        pageIncrement: adjustment.pageIncrement,
        pageSize: adjustment.pageSize,
        value: adjustment.value,
    });
}

/**
 * Whether a value is a portable adjustment rather than a `Gtk.Adjustment`.
 *
 * A plain OBJECT: not null, not an array, not a GObject. A bare number is NOT one — the
 * decision is ADR 0047 § 1's, and `coerce` refuses it by name rather than reading it as
 * the value, because `value` is a property of its own on every widget that takes an
 * adjustment and two spellings of one write is what the whole convergence removes.
 */
export const isPortableAdjustment = (value: unknown): value is AdwAdjustmentInput =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof GObject.Object);

/**
 * A `Gtk.Adjustment` back as the portable value — the inverse of {@link buildAdjustment}.
 *
 * Six numbers read off the real object, so `adjustment.spec.ts` can compare what GTK
 * holds against what the core said it would, row for row.
 */
export function fromAdjustment(adjustment: Gtk.Adjustment): AdwAdjustment {
    return {
        value: adjustment.value,
        lower: adjustment.lower,
        upper: adjustment.upper,
        stepIncrement: adjustment.stepIncrement,
        pageIncrement: adjustment.pageIncrement,
        pageSize: adjustment.pageSize,
    };
}
