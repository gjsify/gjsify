// The portable adjustment — `Gtk.Adjustment`'s six numbers as plain data (ADR 0047).
//
// The third sibling of `menu.ts` and `list.ts`, and the one with the WIDEST reach of the
// three. `Gtk.Adjustment` is a writable property on six GTK types here — `AdwSpinRow`,
// `GtkSpinButton`, `GtkRange` (so `GtkScale` and `GtkScrollbar`), `GtkScaleButton`, and
// `GtkScrollable`'s `hadjustment`/`vadjustment` (so `GtkScrolledWindow`, `GtkViewport`) —
// read from `gtk-host/src/generated/surface-data.mts`, whose provenance line names the
// libraries it was generated from. A numeric range is not a widget's own private state on
// GTK: it is a value the widget is HANDED, which is why one portable value reaches all of
// them and why three renderers spelling it `min`/`max`/`step` was three spellings of a type
// that already has a name.
//
// WHAT WAS DIVERGENT. `Adw.SpinRow` has no `min`, no `max` and no `step`: it has an
// `adjustment` (`Adw.SpinRow:adjustment`, since libadwaita 1.4). `@gjsify/adwaita-web` and
// `@gjsify/adwaita-nativescript` set three flat numbers; `@gjsify/adwaita-react-native`
// already used the GIR field names (`lower`, `upper`, `stepIncrement`) but hoisted them
// onto the ROW, which is a fourth shape rather than the type. `check-vocabulary-alignment`
// counted the NativeScript half as three of its ten remaining property divergences — the
// largest single group in it — and the React Native half not at all, because that ledger
// reads one renderer. Both are one divergence, and this module is the one value they now
// share.
//
// PROVENANCE, and its limit. `refs/gtk` is EMPTY in this tree, so no C is quotable and
// nothing below claims a line it did not read. The type surface is
// `@girs/gtk-4.0`'s `Gtk.Adjustment` — the six properties, the two signals (`changed`,
// `value-changed`), and the documented sentences this module implements:
//
//   · `set_value`: "The value is clamped to lie between lower and upper. Note that for
//     adjustments which are used in a GtkScrollbar, the effective range of allowed values
//     goes from lower to upper - page_size."
//   · `page_size`: "the page-size is irrelevant and should be set to zero if the adjustment
//     is used for a simple scalar value, e.g. in a GtkSpinButton."
//   · `configure`: sets all six at once, so that the change notifications are "compressed
//     into one".
//
// The DEFAULTS ARE NOT GTK'S, deliberately, and this is the one place that says so. A bare
// `Gtk.Adjustment` is 0…0 with a step of 0 — a spin row that cannot move. `SpinState` picked
// 0…100 step 1 long before this module, both sibling renderers ship it, and the GTK arm of
// `@gjsify/adwaita-react-native` adopted it rather than shipping a widget whose omitted
// range means something else on a desktop than on a phone. The value moved here; the choice
// did not change.
//
// PLATFORM-NEUTRAL: pure data and pure functions plus one observable state object.
// Constructing a real `Gtk.Adjustment` from this value is the GTK renderer's half and is
// NOT here — `@gjsify/adwaita-react-native`'s `spin-row.gtk.tsx` does it, in the one place
// that can import `gi://`.
//
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/**
 * A normalised portable adjustment — what an `adjustment` property holds on every surface.
 *
 * The six numbers of `Gtk.Adjustment`, under its own field names. Every one is finite, and
 * the invariants {@link normalizeAdjustment} establishes hold: `upper >= lower`,
 * `pageSize >= 0`, `stepIncrement > 0`, and `value` inside {@link adjustmentRange}.
 */
export interface AdwAdjustment {
    /** The current value, within `[lower, upper - pageSize]`. */
    value: number;
    /** The minimum value. */
    lower: number;
    /** The maximum value — reduced by {@link AdwAdjustment.pageSize} for what a value may reach. */
    upper: number;
    /** How far one stepper press moves the value. */
    stepIncrement: number;
    /** How far one page press (Page Up/Down) moves the value. */
    pageIncrement: number;
    /** The size of the visible page; zero for a scalar value such as a spin row's. */
    pageSize: number;
}

/**
 * What an `adjustment` property ACCEPTS: any subset of {@link AdwAdjustment}, with the rest
 * taken from {@link ADW_ADJUSTMENT_DEFAULTS} (or, for {@link SpinState.configure}, from what
 * the adjustment already holds).
 *
 * A bare number is NOT accepted, and the omission is deliberate: an adjustment addressed by
 * one number would be its `value`, and `value` is a property of its own on every widget that
 * takes an adjustment. Accepting it here would make `adjustment={3}` and `value={3}` two
 * spellings of one write.
 */
export type AdwAdjustmentInput = Partial<AdwAdjustment>;

/**
 * The range every surface falls back to, and the one figure in this module that is OURS
 * rather than GTK's — see the file header for why 0…100 step 1 rather than GTK's 0…0 step 0.
 */
export const ADW_ADJUSTMENT_DEFAULTS: AdwAdjustment = {
    value: 0,
    lower: 0,
    upper: 100,
    stepIncrement: 1,
    // `page-increment` is Page Up/Down. Neither the spin row nor the slider row exposes it,
    // and leaving it at GTK's 0 would make those keys a silent no-op on the GTK renderer
    // alone — a divergence nobody authored. It follows the step until a widget has a reason
    // to part them.
    pageIncrement: 1,
    // Zero, which is what the GIR doc asks for on an adjustment "used for a simple scalar
    // value, e.g. in a GtkSpinButton". A scrollable that wants a page sets its own.
    pageSize: 0,
};

/** A finite number, or `fallback`. The one guard every field below shares. */
function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The closed interval a value may occupy: `[lower, upper - pageSize]`.
 *
 * The upper end is `set_value`'s documented "effective range … from lower to
 * upper - page_size", floored at `lower` so a page larger than the range yields the single
 * point `lower` rather than an inverted interval.
 */
export function adjustmentRange(adjustment: AdwAdjustment): [number, number] {
    return [adjustment.lower, Math.max(adjustment.lower, adjustment.upper - adjustment.pageSize)];
}

/**
 * `value` clamped into {@link adjustmentRange}.
 *
 * The two non-finite inputs are NOT one case, and separating them is a repair rather than a
 * refinement. `±Infinity` carries a DIRECTION, so it clamps to the bound it is heading for,
 * which is what `set_value`'s "clamped to lie between lower and upper" says. `NaN` carries
 * none and lands on the lower bound. The `SpinState` this replaces coerced both to 0 before
 * clamping, which is only harmless while 0 is inside the range: on `[-5, -1]` it turned a
 * `NaN` write into `-1`, the MAXIMUM. `adjustment.spec.ts` holds that case.
 */
export function clampAdjustmentValue(adjustment: AdwAdjustment, value: number): number {
    const [low, high] = adjustmentRange(adjustment);
    if (typeof value !== 'number' || Number.isNaN(value)) return low;
    return Math.min(high, Math.max(low, value));
}

/**
 * `value` clamped and then moved to the nearest tick — the arithmetic behind
 * `snap-to-ticks`.
 *
 * `AdwSpinRow:snap-to-ticks` (and `GtkSpinButton`'s before it) is documented as "whether
 * erroneous values are automatically changed to the nearest step", and the ticks are the
 * step grid counted FROM THE LOWER BOUND — a range of `[1, 10]` with a step of 3 has ticks
 * at 1, 4, 7 and 10, not at 3, 6, 9. The result never leaves {@link adjustmentRange}: the
 * tick above the top of the range rounds back down to the one below it.
 *
 * It is a function rather than a mode on {@link SpinState} because only one renderer needs
 * it: a stepper moves BY the step and can never land between ticks, while a dragged slider
 * lands wherever the finger left it.
 */
export function snapAdjustmentValue(adjustment: AdwAdjustment, value: number): number {
    const clamped = clampAdjustmentValue(adjustment, value);
    const [low, high] = adjustmentRange(adjustment);
    const ticks = Math.round((clamped - low) / adjustment.stepIncrement);
    return Math.min(high, low + ticks * adjustment.stepIncrement);
}

/**
 * Fill an authored adjustment out to a whole one.
 *
 * Total: every field falls back to `base` (the defaults unless a caller passes what it
 * already holds), and the invariants are established rather than assumed — `upper` cannot
 * sit below `lower`, `pageSize` cannot be negative, `stepIncrement` cannot be zero (a step
 * of zero is a stepper that cannot move, which is GTK's default and not a usable one), and
 * `value` is clamped last, against the range the other five just described.
 */
export function normalizeAdjustment(
    input?: AdwAdjustmentInput | null,
    base: AdwAdjustment = ADW_ADJUSTMENT_DEFAULTS,
): AdwAdjustment {
    const authored = input ?? {};
    const lower = finite(authored.lower, base.lower);
    const upper = Math.max(lower, finite(authored.upper, base.upper));
    const stepCandidate = finite(authored.stepIncrement, base.stepIncrement);
    const stepIncrement = stepCandidate > 0 ? stepCandidate : ADW_ADJUSTMENT_DEFAULTS.stepIncrement;
    // A page increment that was FOLLOWING the step keeps following it, so moving the step
    // alone does not silently leave Page Up/Down on the old distance; one authored apart
    // from the step is carried through untouched.
    const baseFollowsStep = base.pageIncrement === base.stepIncrement;
    const pageCandidate = finite(authored.pageIncrement, baseFollowsStep ? stepIncrement : base.pageIncrement);
    const pageIncrement = pageCandidate > 0 ? pageCandidate : stepIncrement;
    const pageSize = Math.max(0, finite(authored.pageSize, base.pageSize));
    const ranged: AdwAdjustment = {
        value: 0,
        lower,
        upper,
        stepIncrement,
        pageIncrement,
        pageSize,
    };
    ranged.value = clampAdjustmentValue(ranged, typeof authored.value === 'number' ? authored.value : base.value);
    return ranged;
}

/** The six field names, so the markup door reads only what an adjustment has. */
const ADJUSTMENT_FIELDS = [
    'value',
    'lower',
    'upper',
    'stepIncrement',
    'pageIncrement',
    'pageSize',
] as const satisfies readonly (keyof AdwAdjustment)[];

/**
 * The MARKUP door: a JSON attribute → the fields it authored.
 *
 * It yields a PARTIAL and not a whole adjustment, and that is what makes attribute order
 * irrelevant: `adjustment='{"upper":20}'` moves the upper bound and leaves the value where
 * it is, whichever attribute the parser reached first. A door that answered with a whole
 * adjustment would carry `value: 0` into every such write and silently reset the row —
 * the ordering hazard `spin-row.gtk.tsx` records for the GTK renderer, arriving through
 * markup instead of through props.
 *
 * Total in every failure mode, and they are all an author slip rather than a state the
 * element may refuse to upgrade in: absent, unparseable, and well-formed JSON that is not an
 * object (an array, a number, `null`) each yield `{}` — no field authored, nothing moves.
 * The same door `parseListModel` and `parseMenuModel` open for their values, for the same
 * reason and on the same surfaces.
 *
 * A key that is not one of the six is DROPPED rather than carried into the state, so a typo
 * (`{"min":1}`) does not travel as a property the value does not have.
 */
export function parseAdjustment(raw: string | null | undefined): AdwAdjustmentInput {
    if (!raw) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const authored = parsed as Record<string, unknown>;
    const input: AdwAdjustmentInput = {};
    for (const field of ADJUSTMENT_FIELDS) {
        const value = authored[field];
        if (typeof value === 'number') input[field] = value;
    }
    return input;
}

/** Payload of a {@link SpinState} value change. */
export interface SpinStateChange {
    /** The new value (already clamped into {@link adjustmentRange}). */
    value: number;
    /** True for a stepper press ({@link SpinState.increment}/{@link SpinState.decrement}); false for a programmatic set or a re-clamp. */
    interactive: boolean;
}

/** Subscriber for {@link SpinState} value changes — `Gtk.Adjustment::value-changed`. */
export type SpinStateListener = (change: SpinStateChange) => void;

/** Subscriber for {@link SpinState} RANGE changes — `Gtk.Adjustment::changed`. */
export type SpinStateRangeListener = (adjustment: AdwAdjustment) => void;

/**
 * An adjustment that can be watched — the portable `Gtk.Adjustment` OBJECT to
 * {@link AdwAdjustment}'s value.
 *
 * It keeps the two signals apart exactly as GTK does, because a renderer needs them apart:
 * `value-changed` redraws a label, `changed` re-sizes a slider's track. {@link subscribe}
 * is the first, {@link subscribeChanged} the second, and {@link configure} may emit both.
 *
 * The `interactive` flag on the value signal is OURS and has no GTK counterpart, because on
 * GTK the two callers are different objects: the widget writes the adjustment on a stepper
 * press and the application writes it programmatically, and a renderer here is both. It
 * mirrors `Adw.SpinRow`'s observable behaviour — a programmatic set refreshes the display
 * without the row re-emitting `notify::value`, a stepper press emits.
 *
 * WHAT IT DOES NOT HAVE is GTK's five individual setters (`set_lower`, `set_upper`, …).
 * They exist in C because there is no record literal there; here the whole range arrives as
 * one value, and `gtk_adjustment_configure`'s own documented reason for existing — it
 * compresses the notifications "into one" — is the shape this class already has.
 */
export class SpinState {
    private _adjustment: AdwAdjustment = normalizeAdjustment();
    private readonly _listeners = new Set<SpinStateListener>();
    private readonly _rangeListeners = new Set<SpinStateRangeListener>();

    /** Subscribe to value changes (`value-changed`). Returns an unsubscribe function. */
    subscribe(listener: SpinStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Subscribe to range changes (`changed`). Returns an unsubscribe function. */
    subscribeChanged(listener: SpinStateRangeListener): () => void {
        this._rangeListeners.add(listener);
        return () => {
            this._rangeListeners.delete(listener);
        };
    }

    private _emit(interactive: boolean): void {
        const change: SpinStateChange = { value: this._adjustment.value, interactive };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    private _emitChanged(): void {
        const adjustment = this._adjustment;
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot, as in `_emit`
        for (const listener of [...this._rangeListeners]) listener(adjustment);
    }

    private _bump(delta: number): boolean {
        const next = clampAdjustmentValue(this._adjustment, this._adjustment.value + delta);
        if (next === this._adjustment.value) return false;
        this._adjustment = { ...this._adjustment, value: next };
        this._emit(true);
        return true;
    }

    /** The whole adjustment. A snapshot: mutating it does not reach this object. */
    get adjustment(): AdwAdjustment {
        return { ...this._adjustment };
    }

    /** The current value (always within {@link adjustmentRange}). */
    get value(): number {
        return this._adjustment.value;
    }

    /**
     * Replace the range (and optionally the value) — `gtk_adjustment_configure`.
     *
     * Unwritten fields keep what the adjustment already holds, so a caller may move one
     * bound without restating the rest. Emits `changed` when any of the five range fields
     * moved and `value-changed` when the value did — including a value that moved only
     * because a bound came under it, which notifies `interactive: false`.
     *
     * Returns whether anything changed at all.
     */
    configure(input: AdwAdjustmentInput | null | undefined): boolean {
        const previous = this._adjustment;
        const next = normalizeAdjustment(input, previous);
        const rangeMoved =
            next.lower !== previous.lower ||
            next.upper !== previous.upper ||
            next.stepIncrement !== previous.stepIncrement ||
            next.pageIncrement !== previous.pageIncrement ||
            next.pageSize !== previous.pageSize;
        const valueMoved = next.value !== previous.value;
        if (!rangeMoved && !valueMoved) return false;
        this._adjustment = next;
        // `changed` first, as GTK emits it: a listener that re-reads the value wants the
        // range it now lives in to be the current one.
        if (rangeMoved) this._emitChanged();
        if (valueMoved) this._emit(false);
        return true;
    }

    /** Programmatic value set — clamp, notify `interactive: false` on change. Returns whether it changed. */
    setValue(value: number): boolean {
        const next = clampAdjustmentValue(this._adjustment, value);
        if (next === this._adjustment.value) return false;
        this._adjustment = { ...this._adjustment, value: next };
        this._emit(false);
        return true;
    }

    /**
     * The same set, as a USER-driven change — notifies `interactive: true`.
     *
     * {@link increment} and {@link decrement} are the stepper's interactions and move BY the
     * step; this is the DRAGGED one, which lands wherever the finger left it.
     * `ComboState.select` is the same pair on the same reasoning: one method per caller,
     * rather than a flag every caller has to remember to pass.
     *
     * Returns whether it changed.
     */
    setValueInteractive(value: number): boolean {
        const next = clampAdjustmentValue(this._adjustment, value);
        if (next === this._adjustment.value) return false;
        this._adjustment = { ...this._adjustment, value: next };
        this._emit(true);
        return true;
    }

    /** Step up by `stepIncrement`, clamped. Notifies `interactive: true` on change. Returns whether it changed. */
    increment(): boolean {
        return this._bump(this._adjustment.stepIncrement);
    }

    /** Step down by `stepIncrement`, clamped. Notifies `interactive: true` on change. Returns whether it changed. */
    decrement(): boolean {
        return this._bump(-this._adjustment.stepIncrement);
    }
}
