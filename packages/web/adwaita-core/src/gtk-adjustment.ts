// `Gtk.Adjustment` — the AUTHORING DOOR onto the portable adjustment.
//
// WHAT WAS MISSING, AND WHERE IT SHOWED. `adjustment.ts` has carried the VALUE since ADR
// 0047: `AdwAdjustment` is `Gtk.Adjustment`'s six numbers under its own field names, and
// every `adjustment` property on every surface takes it. What no surface had was the name
// a GJS author reaches for, so the website gallery wrote the same range twice:
//
//   gjs           adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, value: 16, stepIncrement: 1 })
//   nativescript  adjustment: { lower: 0, upper: 100, value: 16, stepIncrement: 1 }
//
// IT IS NOT ARRAY-SHAPED, so it follows `Gio.MenuItem`'s precedent rather than
// `Gio.Menu`'s: a class that IS the portable value — `implements AdwAdjustment`, six own
// data fields — so an `adjustment` property reads it exactly as it reads the object
// literal beside it. That is why neither port had to learn a second input shape: a
// `GtkAdjustment` already satisfies `AdwAdjustmentInput`.
//
// THE CONSTRUCTOR TAKES WHAT GJS WRITES, in camelCase. Measured against `@girs/gtk-4.0`
// 5.4.0: `Gtk.Adjustment.ConstructorProps` declares BOTH spellings of the three
// two-word properties — `step_increment` and `stepIncrement`, `page_increment` and
// `pageIncrement`, `page_size` and `pageSize` — because a GJS construct bag accepts
// either. The camelCase half is the one `AdwAdjustment` already uses, so one shape serves
// both and no port has to translate. The METHODS take the other half: `get_step_increment`
// is the typelib's own name and there is no second spelling of it.
//
// THE INVARIANTS ARE `adjustment.ts`'s, NOT A CLAIM ABOUT C. Every write here goes through
// `normalizeAdjustment`, so `upper >= lower`, `stepIncrement > 0`, `pageSize >= 0` and a
// value inside `adjustmentRange` hold after a constructor, a setter and a `configure`
// alike — which is what the surfaces already relied on and what makes this class and a
// plain object the same write. `refs/gtk` is empty in this tree, so nothing below quotes a
// C line; the documented sentences `adjustment.ts` implements are quoted in its header.
//
// WHAT IS DELIBERATELY ABSENT. `clamp_page` moves the value so a given range sits inside
// the page — a scrolling operation, and no surface here has a scrollable that reaches an
// adjustment. The two signals are absent too: `SpinState` in `adjustment.ts` already
// publishes `value-changed` and `changed`, and a second observable would be two places a
// widget could subscribe to.
//
// Reference: @girs/gtk-4.0 5.4.0 — `Gtk.Adjustment` ConstructorProps and its
// `configure`, `get_*`/`set_*` and `get_minimum_increment` methods.
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { normalizeAdjustment } from './adjustment.js';
import type { AdwAdjustment, AdwAdjustmentInput } from './adjustment.js';

/**
 * What `new Gtk.Adjustment({ … })` takes: the GJS construct bag, which is exactly
 * {@link AdwAdjustmentInput}.
 *
 * An ALIAS and not a second interface — the two would be one declaration copied, and the
 * copy is the one that drifts when a seventh field arrives.
 */
export type GtkAdjustmentProps = AdwAdjustmentInput;

/**
 * A numeric range — `Gtk.Adjustment`'s six properties as a value an `adjustment` property
 * takes.
 *
 * `new GtkAdjustment()` is `ADW_ADJUSTMENT_DEFAULTS` (0…100 step 1), which is the
 * package's own default and NOT GTK's 0…0 step 0 — `adjustment.ts` says why in its header.
 */
export class GtkAdjustment implements AdwAdjustment {
    /** The current value, within {@link adjustmentRange}. */
    value: number;
    /** The minimum value. */
    lower: number;
    /** The maximum value. */
    upper: number;
    /** How far one stepper press moves the value. */
    stepIncrement: number;
    /** How far one page press (Page Up/Down) moves the value. */
    pageIncrement: number;
    /** The size of the visible page; zero for a scalar value such as a spin row's. */
    pageSize: number;

    constructor(props?: GtkAdjustmentProps | null) {
        const adjustment = normalizeAdjustment(props);
        this.value = adjustment.value;
        this.lower = adjustment.lower;
        this.upper = adjustment.upper;
        this.stepIncrement = adjustment.stepIncrement;
        this.pageIncrement = adjustment.pageIncrement;
        this.pageSize = adjustment.pageSize;
    }

    /**
     * Re-establish the invariants around one authored change.
     *
     * The current six are the BASE, so a field nobody wrote keeps what it held instead of
     * falling back to the package default — the same contract `SpinState.configure` has.
     */
    private _write(input: AdwAdjustmentInput): void {
        const next = normalizeAdjustment(input, this);
        this.value = next.value;
        this.lower = next.lower;
        this.upper = next.upper;
        this.stepIncrement = next.stepIncrement;
        this.pageIncrement = next.pageIncrement;
        this.pageSize = next.pageSize;
    }

    /** `gtk_adjustment_configure` — all six at once, which is what C compresses into one. */
    configure(
        value: number,
        lower: number,
        upper: number,
        step_increment: number,
        page_increment: number,
        page_size: number,
    ): void {
        this._write({
            value,
            lower,
            upper,
            stepIncrement: step_increment,
            pageIncrement: page_increment,
            pageSize: page_size,
        });
    }

    /** `gtk_adjustment_get_value`. */
    get_value(): number {
        return this.value;
    }

    /** `gtk_adjustment_set_value` — "clamped to lie between lower and upper". */
    set_value(value: number): void {
        this._write({ value });
    }

    /** `gtk_adjustment_get_lower`. */
    get_lower(): number {
        return this.lower;
    }

    /** `gtk_adjustment_set_lower`. */
    set_lower(lower: number): void {
        this._write({ lower });
    }

    /** `gtk_adjustment_get_upper`. */
    get_upper(): number {
        return this.upper;
    }

    /** `gtk_adjustment_set_upper`. */
    set_upper(upper: number): void {
        this._write({ upper });
    }

    /** `gtk_adjustment_get_step_increment`. */
    get_step_increment(): number {
        return this.stepIncrement;
    }

    /** `gtk_adjustment_set_step_increment`. */
    set_step_increment(step_increment: number): void {
        this._write({ stepIncrement: step_increment });
    }

    /** `gtk_adjustment_get_page_increment`. */
    get_page_increment(): number {
        return this.pageIncrement;
    }

    /** `gtk_adjustment_set_page_increment`. */
    set_page_increment(page_increment: number): void {
        this._write({ pageIncrement: page_increment });
    }

    /** `gtk_adjustment_get_page_size`. */
    get_page_size(): number {
        return this.pageSize;
    }

    /** `gtk_adjustment_set_page_size`. */
    set_page_size(page_size: number): void {
        this._write({ pageSize: page_size });
    }

    /**
     * `gtk_adjustment_get_minimum_increment` — "the smaller of step increment and page
     * increment", which is the GIR's own sentence.
     *
     * Total, with no zero case: `normalizeAdjustment` refuses a step of zero and carries
     * the page increment with it, so both are positive here. C has to answer for the
     * adjustment its own defaults produce, where either can be 0.
     */
    get_minimum_increment(): number {
        return Math.min(this.stepIncrement, this.pageIncrement);
    }
}
