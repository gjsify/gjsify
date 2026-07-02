// Headless Adwaita ROW interaction state machines (ADR 0004 — headless Adwaita core).
//
// The selection / disclosure / clamp-and-snap logic behind the Libadwaita row
// widgets, lifted out of `@gjsify/adwaita-nativescript` so every renderer shares
// ONE behavior:
//   - {@link ExpanderState}    — `Adw.ExpanderRow`'s expanded/collapsed disclosure.
//   - {@link ComboState}       — `Adw.ComboRow`'s selectedIndex↔selectedValue mapping
//                                over an options list, with empty/out-of-range guards.
//   - {@link SpinState}        — `Adw.SpinRow`'s value/min/max/step adjustment with
//                                clamping on every mutation and stepped increments.
//   - {@link ToggleGroupState} — `Adw.ToggleGroup`'s selected segment over a label list.
//
// This module is PLATFORM-NEUTRAL: it renders nothing and never touches a global
// timer or the DOM. Each state machine exposes a small per-instance subscribe/emit
// surface — {@link ExpanderState.subscribe} et al. return an unsubscribe function,
// mirroring the module-scoped `onAdwaitaColorSchemeChanged` observable but scoped
// to one widget. A renderer subscribes to drive both the visual update and the
// GObject-style `notify::*` re-emit; it feeds interaction back through the state
// methods (`toggle`, `select`, `increment`, `setSelected`, …).
//
// Programmatic-vs-interactive fidelity: `Adw.SpinRow` / `Adw.ComboRow` in the NS
// port emit their `notify::*` signal ONLY on a user-driven change (a stepper press,
// a chooser pick), not on a programmatic property set (which silently updates the
// display). {@link SpinState} / {@link ComboState} preserve this exactly by tagging
// every change with an `interactive` flag — the renderer re-emits `notify::*` only
// when it is set. `Adw.ExpanderRow` / `Adw.ToggleGroup` make no such distinction
// (both paths notify), so their change carries no flag.
//
// Reference: refs/libadwaita/src/adw-{expander-row,combo-row,spin-row,toggle-group}.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

// --- Expander (Adw.ExpanderRow disclosure) ---

/** Subscriber for {@link ExpanderState} changes — receives the new expanded flag. */
export type ExpanderStateListener = (expanded: boolean) => void;

/**
 * The disclosure state of an expander row: a single boolean that toggles between
 * revealed and collapsed. Idempotent — setting the current value again is a no-op
 * and fires no notification. Both programmatic and interactive changes notify (as
 * `Adw.ExpanderRow` does).
 */
export class ExpanderState {
    private _expanded = false;
    private readonly _listeners = new Set<ExpanderStateListener>();

    /** Subscribe to expanded-state changes. Returns an unsubscribe function. */
    subscribe(listener: ExpanderStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(): void {
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        for (const listener of [...this._listeners]) listener(this._expanded);
    }

    /** Whether the disclosure is revealed. */
    get expanded(): boolean {
        return this._expanded;
    }

    /** Set the expanded flag. Notifies only on an actual change. Returns whether it changed. */
    setExpanded(value: boolean): boolean {
        const next = !!value;
        if (next === this._expanded) return false;
        this._expanded = next;
        this._emit();
        return true;
    }

    /** Flip expanded↔collapsed (the disclosure tap). Returns whether it changed. */
    toggle(): boolean {
        return this.setExpanded(!this._expanded);
    }

    /** Reveal the disclosure. Returns whether it changed. */
    expand(): boolean {
        return this.setExpanded(true);
    }

    /** Collapse the disclosure. Returns whether it changed. */
    collapse(): boolean {
        return this.setExpanded(false);
    }
}

// --- Combo (Adw.ComboRow selection) ---

/** One selectable option in a {@link ComboState}. */
export interface AdwComboOption {
    /** Display label shown in the row + chooser. */
    label: string;
    /** Underlying value returned by {@link ComboState.selectedValue}. */
    value: string;
}

/** Payload of a {@link ComboState} change. */
export interface ComboStateChange {
    /** The (new) selected index. */
    selected: number;
    /** The selected option's `value` (or `''` when out of range). */
    value: string;
    /** The selected option's `label` (or `''` when out of range) — drives the inline display. */
    label: string;
    /** True for a user pick ({@link ComboState.select}); false for a programmatic set. */
    interactive: boolean;
}

/** Subscriber for {@link ComboState} changes. */
export type ComboStateListener = (change: ComboStateChange) => void;

/**
 * The selection state of a combo row: an options list plus the selected index,
 * with a two-way index↔value mapping and empty/out-of-range guards. Mirrors
 * `Adw.ComboRow`: a programmatic set ({@link setSelectedIndex} / {@link setSelectedValue}
 * / {@link setOptions}) updates silently (`interactive: false` — the renderer refreshes
 * the inline value but re-emits no `notify::selected`), while {@link select} is the
 * user pick that notifies (`interactive: true`).
 */
export class ComboState {
    private _options: AdwComboOption[] = [];
    private _selected = 0;
    private readonly _listeners = new Set<ComboStateListener>();

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: ComboStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(interactive: boolean): void {
        const change: ComboStateChange = {
            selected: this._selected,
            value: this.selectedValue,
            label: this.selectedLabel,
            interactive,
        };
        for (const listener of [...this._listeners]) listener(change);
    }

    private _setIndex(next: number, interactive: boolean): boolean {
        if (next === this._selected) return false;
        this._selected = next;
        this._emit(interactive);
        return true;
    }

    /** The selectable options. */
    get options(): AdwComboOption[] {
        return this._options;
    }

    /**
     * Replace the options. Resets the selection to 0 when the current index no
     * longer fits (mirroring `Adw.ComboRow`), then notifies (`interactive: false`)
     * so the renderer re-syncs the inline value label (the label may change even at
     * the same index).
     */
    setOptions(options: AdwComboOption[]): void {
        this._options = Array.isArray(options) ? options : [];
        if (this._selected >= this._options.length) this._selected = 0;
        this._emit(false);
    }

    /** The selected option index (may sit past the options length — {@link selectedValue} then is `''`). */
    get selectedIndex(): number {
        return this._selected;
    }

    /** Programmatic index set — notifies `interactive: false`. Returns whether it changed. */
    setSelectedIndex(index: number): boolean {
        return this._setIndex(Number.isFinite(index) ? index : 0, false);
    }

    /** The selected option's `value`, or `''` when out of range. */
    get selectedValue(): string {
        return this._options[this._selected]?.value ?? '';
    }

    /** The selected option's `label`, or `''` when out of range (the inline display text). */
    get selectedLabel(): string {
        return this._options[this._selected]?.label ?? '';
    }

    /** Programmatic value set — moves the index to the first option with this `value`. No-op for an unknown value. */
    setSelectedValue(value: string): boolean {
        const index = this._options.findIndex((o) => o.value === value);
        return index >= 0 ? this.setSelectedIndex(index) : false;
    }

    /**
     * Select an option by index as a USER pick (the chooser result) — notifies
     * `interactive: true`. A no-op (returns false) for a negative index or the
     * already-selected one, matching the renderer's chooser guard.
     */
    select(index: number): boolean {
        if (index < 0 || index === this._selected) return false;
        return this._setIndex(index, true);
    }

    /** Number of options. */
    get count(): number {
        return this._options.length;
    }
}

// --- Spin (Adw.SpinRow numeric adjustment) ---

/** Payload of a {@link SpinState} change. */
export interface SpinStateChange {
    /** The new value (already clamped to `[min, max]`). */
    value: number;
    /** True for a stepper press ({@link SpinState.increment}/{@link SpinState.decrement}); false for a programmatic set/re-clamp. */
    interactive: boolean;
}

/** Subscriber for {@link SpinState} changes. */
export type SpinStateListener = (change: SpinStateChange) => void;

/**
 * The numeric adjustment state of a spin row: `value` bounded by `[min, max]` and
 * stepped by `step`. Every mutation clamps into range. Mirrors `Adw.SpinRow`: a
 * programmatic {@link setValue} (or a re-clamp from a moved {@link setMin}/{@link setMax})
 * notifies `interactive: false` (the renderer refreshes the display but re-emits no
 * `notify::value`), while {@link increment}/{@link decrement} are the stepper presses
 * that notify `interactive: true`.
 */
export class SpinState {
    private _value = 0;
    private _min = 0;
    private _max = 100;
    private _step = 1;
    private readonly _listeners = new Set<SpinStateListener>();

    /** Subscribe to value changes. Returns an unsubscribe function. */
    subscribe(listener: SpinStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(interactive: boolean): void {
        const change: SpinStateChange = { value: this._value, interactive };
        for (const listener of [...this._listeners]) listener(change);
    }

    private _clamp(n: number): number {
        return Math.min(this._max, Math.max(this._min, n));
    }

    private _bump(delta: number): boolean {
        const next = this._clamp(this._value + delta);
        if (next === this._value) return false;
        this._value = next;
        this._emit(true);
        return true;
    }

    /** Re-clamp the current value after a bound moved; notifies `interactive: false` on change. */
    private _reclamp(): boolean {
        const next = this._clamp(this._value);
        if (next === this._value) return false;
        this._value = next;
        this._emit(false);
        return true;
    }

    /** The current numeric value (always within `[min, max]`). */
    get value(): number {
        return this._value;
    }

    /** Lower bound. */
    get min(): number {
        return this._min;
    }

    /** Upper bound. */
    get max(): number {
        return this._max;
    }

    /** Increment/decrement step applied per stepper press. */
    get step(): number {
        return this._step;
    }

    /** Programmatic value set — clamp, notify `interactive: false` on change. Returns whether it changed. */
    setValue(value: number): boolean {
        const next = this._clamp(Number.isFinite(value) ? value : 0);
        if (next === this._value) return false;
        this._value = next;
        this._emit(false);
        return true;
    }

    /** Set the lower bound and re-clamp the value into range. Returns whether the value changed. */
    setMin(value: number): boolean {
        this._min = Number.isFinite(value) ? value : 0;
        return this._reclamp();
    }

    /** Set the upper bound and re-clamp the value into range. Returns whether the value changed. */
    setMax(value: number): boolean {
        this._max = Number.isFinite(value) ? value : 0;
        return this._reclamp();
    }

    /** Set the step. A non-positive or non-finite step falls back to `1`. */
    setStep(value: number): void {
        this._step = Number.isFinite(value) && value > 0 ? value : 1;
    }

    /** Step up by `step`, clamped to `max`. Notifies `interactive: true` on change. Returns whether it changed. */
    increment(): boolean {
        return this._bump(this._step);
    }

    /** Step down by `step`, clamped to `min`. Notifies `interactive: true` on change. Returns whether it changed. */
    decrement(): boolean {
        return this._bump(-this._step);
    }
}

// --- Toggle group (Adw.ToggleGroup segmented selection) ---

/** Payload of a {@link ToggleGroupState} change. */
export interface ToggleGroupStateChange {
    /** The newly-selected segment index. */
    selected: number;
    /** The newly-selected segment's label (or `''` when out of range). */
    value: string;
}

/** Subscriber for {@link ToggleGroupState} changes. */
export type ToggleGroupStateListener = (change: ToggleGroupStateChange) => void;

/**
 * The selection state of a segmented toggle group: a label list plus the selected
 * index. Mirrors `Adw.ToggleGroup`: {@link setLabels} replaces the segments (resetting
 * the selection to 0 when the current index no longer fits) WITHOUT notifying — the
 * renderer rebuilds its segment views — while {@link setSelected} is the guarded
 * selection change (bounds + no-op-on-same) that notifies. Both programmatic and
 * interactive selections notify (as `Adw.ToggleGroup` does).
 */
export class ToggleGroupState {
    private _labels: string[] = [];
    private _selected = 0;
    private readonly _listeners = new Set<ToggleGroupStateListener>();

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: ToggleGroupStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(): void {
        const change: ToggleGroupStateChange = { selected: this._selected, value: this.selectedValue };
        for (const listener of [...this._listeners]) listener(change);
    }

    /** The segment labels. */
    get labels(): string[] {
        return this._labels;
    }

    /**
     * Replace the segment labels. Resets the selection to 0 when the current index
     * no longer fits. Silent — the renderer rebuilds its segment views and re-applies
     * the active pill from {@link selected}.
     */
    setLabels(labels: string[]): void {
        this._labels = Array.isArray(labels) ? labels : [];
        if (this._selected >= this._labels.length) this._selected = 0;
    }

    /** The selected segment index. */
    get selected(): number {
        return this._selected;
    }

    /**
     * Select a segment. Guarded like `Adw.ToggleGroup`: a non-finite, negative,
     * out-of-range, or already-selected index is a no-op. Notifies on a valid change.
     * Returns whether it changed.
     */
    setSelected(index: number): boolean {
        const next = Number.isFinite(index) ? index : 0;
        if (next === this._selected || next < 0 || next >= this._labels.length) return false;
        this._selected = next;
        this._emit();
        return true;
    }

    /** The selected segment's label, or `''` when out of range. */
    get selectedValue(): string {
        return this._labels[this._selected] ?? '';
    }

    /** Number of segments. */
    get count(): number {
        return this._labels.length;
    }
}
