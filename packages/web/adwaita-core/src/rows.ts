// Headless Adwaita ROW interaction state machines (ADR 0004 — headless Adwaita core).
//
// The selection / disclosure / clamp-and-snap logic behind the Libadwaita row widgets, so
// every renderer shares ONE behavior:
//   - {@link ExpanderState}    — `Adw.ExpanderRow`'s expanded/collapsed disclosure.
//   - {@link ComboState}       — `Adw.ComboRow`'s selectedIndex↔selectedValue mapping
//                                over an options list, with empty/out-of-range guards.
//   - {@link SpinState}        — `Adw.SpinRow`'s value/min/max/step adjustment with
//                                clamping on every mutation and stepped increments.
//   - {@link ToggleGroupState} — `Adw.ToggleGroup`'s selected segment over a label list.
//
// PLATFORM-NEUTRAL: renders nothing, touches no global timer and no DOM. Each state
// machine exposes a per-instance subscribe/emit surface returning an unsubscribe function
// — the module-scoped `onAdwaitaColorSchemeChanged` shape, scoped to one widget. A
// renderer subscribes to drive both the visual update and the GObject-style `notify::*`
// re-emit, and feeds interaction back through the state methods.
//
// Programmatic-vs-interactive fidelity: `Adw.SpinRow` / `Adw.ComboRow` notify ONLY on a
// user-driven change (a stepper press, a chooser pick), not on a programmatic property set
// — so {@link SpinState} / {@link ComboState} tag every change with an `interactive` flag
// and the renderer re-emits `notify::*` only when it is set. `Adw.ExpanderRow` /
// `Adw.ToggleGroup` make no such distinction (both paths notify) and carry no flag.
//
// Reference: refs/libadwaita/src/adw-{expander-row,combo-row,spin-row,toggle-group}.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { clampListSelection, listItemsChanged } from './list.js';
import type { AdwComboOption, AdwListItemsChanged } from './list.js';

// The ITEM vocabulary moved to `list.ts` (ADR 0046) — one module owns what an item is, for
// every widget GTK gives a `model` property. Re-exported under its published names so
// neither import path changed and no fifth spelling of "an item" was created.
export { ADW_COMBO_NO_SELECTION, normalizeComboOptions } from './list.js';
export type { AdwComboOption, AdwComboOptionInput } from './list.js';

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
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
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

/** Payload of a {@link ComboState} change. */
export interface ComboStateChange {
    /** The (new) selected index, or {@link ADW_COMBO_NO_SELECTION}. */
    selected: number;
    /** The selected option's `value` (or `''` when out of range). */
    value: string;
    /** The selected option's `label` (or `''` when out of range) — drives the inline display. */
    label: string;
    /** True for a user pick ({@link ComboState.select}); false for a programmatic set. */
    interactive: boolean;
}

/** Subscriber for {@link ComboState} selection changes. */
export type ComboStateListener = (change: ComboStateChange) => void;

/** Subscriber for {@link ComboState} MODEL changes — one `items-changed` per replacement. */
export type ComboItemsListener = (change: AdwListItemsChanged) => void;

/**
 * The selection state of a combo row: a portable list model (`AdwListModel`) plus
 * the selected index, with a two-way index↔value mapping and empty/out-of-range guards.
 * Mirrors `Adw.ComboRow`: a programmatic set ({@link setSelectedIndex} /
 * {@link setSelectedValue} / {@link setModel}) updates silently (`interactive: false` —
 * the renderer refreshes the inline value but re-emits no `notify::selected`), while
 * {@link select} is the user pick that notifies (`interactive: true`).
 *
 * TWO SIGNALS, because they answer different questions and a renderer needs both
 * (ADR 0046). {@link subscribe} reports the SELECTION; {@link subscribeItems} reports WHERE
 * the model changed, so a renderer splices its item views instead of rebuilding them.
 * `Adw.ComboRow` gets both from GTK for free — the first is `notify::selected`, the second
 * is `Gio.ListModel::items-changed` on the model it holds — and this class had only the
 * first, which is why both browser selectors dropped every option node on every
 * assignment.
 */
export class ComboState {
    private _options: AdwComboOption[] = [];
    private _selected = 0;
    private readonly _listeners = new Set<ComboStateListener>();
    private readonly _itemListeners = new Set<ComboItemsListener>();

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: ComboStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * Subscribe to MODEL changes — `Gio.ListModel::items-changed`, one splice per
     * {@link setModel}. Returns an unsubscribe function.
     *
     * Fires BEFORE the selection change {@link setModel} also emits, which is the order
     * that makes it usable: the selection subscriber writes the new index into the item
     * views, so those views have to exist by then. The rebuild path had the inverse
     * ordering hazard written down in `<adw-combo-row>` — "AFTER the rebuild, never during
     * it" — and this is what removes it rather than documenting it again.
     */
    subscribeItems(listener: ComboItemsListener): () => void {
        this._itemListeners.add(listener);
        return () => {
            this._itemListeners.delete(listener);
        };
    }

    private _emit(interactive: boolean): void {
        const change: ComboStateChange = {
            selected: this._selected,
            value: this.selectedValue,
            label: this.selectedLabel,
            interactive,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    private _setIndex(next: number, interactive: boolean): boolean {
        if (next === this._selected) return false;
        this._selected = next;
        this._emit(interactive);
        return true;
    }

    /**
     * The list model — `Adw.ComboRow:model` / `Gtk.DropDown:model`, in portable form.
     *
     * A COPY, items included, and that is load-bearing rather than defensive. The splice
     * (ADR 0046) decides what changed by COMPARING the assigned model against the stored
     * one, so anything that leaks a reference into `_options` makes the comparison read the
     * new value on both sides and answer "nothing changed". Handing back `_options` itself
     * did exactly that, and it turned a pattern that WORKED under the old full rebuild into
     * a silent no-op:
     *
     * ```ts
     * const m = row.model; m.push(item); row.model = m;   // → no splice, DOM unchanged
     * ```
     *
     * Fresh items and not just a fresh array, because the same failure sits one level down:
     * `m[0].label = 'x'` through a shared descriptor mutates the stored one too, and the
     * comparison is by BOTH halves. A frozen item would have made the mutation loud; a copy
     * makes the round trip CORRECT, which is the difference between documenting the hazard
     * and removing it.
     *
     * Cost, MEASURED rather than assumed (Node 24.19, `{value,label}` records): linear, about
     * four nanoseconds per item — so a read is well under a microsecond at every size a combo
     * row actually holds, and the assignment beside it already costs more. What the shape
     * rules out is a per-item read: the three call sites that had one — `_applyItemsChanged`
     * in each browser selector and `_filter` in `<gtk-drop-down>`, which runs per row per
     * keystroke — hoist it out of their loop, so a read is O(n) once per operation instead of
     * O(n²). Nothing reads it per frame. A model large enough for the linear term to matter is
     * a `Gtk.ListView` and belongs to `ListController`'s virtualisation, which ADR 0046 § 7
     * keeps out of this class on purpose.
     */
    get model(): AdwComboOption[] {
        return this._options.map((option) => ({ value: option.value, label: option.label }));
    }

    /**
     * Replace the model: emit the splice that turns the old one into the new
     * ({@link subscribeItems}), then notify the SELECTION (`interactive: false`) so the
     * renderer re-syncs the inline value label — which may change even at an unchanged
     * index, because the label is read out of the model.
     *
     * Replacing the model re-runs autoselect ({@link clampListSelection}), so an index the
     * new one does not have falls back to 0 — including the sentinel, which is how a row
     * recovers a selection when its model grows. An EMPTY model has no 0 to fall back to
     * and lands on {@link ADW_COMBO_NO_SELECTION}.
     *
     * The selection notify is UNCONDITIONAL while the splice is not: an assignment of an
     * equal model emits no `items-changed` (GTK emits none either) but still re-runs the
     * label sync, because that is the behaviour every renderer has depended on since this
     * class existed and nothing measured says it is wrong.
     */
    setModel(model: AdwComboOption[]): void {
        const previous = this._options;
        const next = Array.isArray(model) ? model : [];
        const change = listItemsChanged(previous, next);
        // Copied AFTER the comparison, and for the reason {@link model} gives from the other
        // side: the stored model shares nothing with a caller, so a retained input array —
        // or a retained item — cannot mutate what the next assignment is compared against.
        // Closing one door and not the other would leave the same silent no-op reachable by
        // the other route.
        this._options = next.map((option) => ({ value: option.value, label: option.label }));
        this._selected = clampListSelection(this._selected, next.length);
        if (change) {
            // Snapshot, for the reason `_emit` states.
            // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
            for (const listener of [...this._itemListeners]) listener(change);
        }
        this._emit(false);
    }

    /**
     * The selected option index, or {@link ADW_COMBO_NO_SELECTION}. May also sit PAST the
     * options length: {@link setSelectedIndex} is deliberately permissive, mirroring a
     * `guint` property that takes any position. {@link selectedValue} reads `''` in both
     * cases, which is why the sentinel is what distinguishes "nothing selected" from "an
     * empty label".
     */
    get selectedIndex(): number {
        return this._selected;
    }

    /**
     * Whether the row presents itself as a CHOOSER — `model_changed` makes the arrow visible
     * and the row activatable on `n_items > 1`, and hides both otherwise. One item or none is
     * not a choice, so `Adw.ComboRow` stops looking like one: no chevron, and tapping does
     * nothing.
     */
    get presentsChooser(): boolean {
        return this._options.length > 1;
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
     * Whether `index` addresses an option that exists.
     *
     * The bounds arithmetic lives here; the POLICY for a programmatic out-of-range set does
     * not, because this tree cannot settle it: `adw_combo_row_set_selected` forwards the
     * position straight to `gtk_single_selection_set_selected` and documents
     * `GTK_INVALID_LIST_POSITION` as a legal argument, but `refs/gtk` is EMPTY so what
     * GtkSingleSelection does with it is not verifiable here. Each renderer therefore states
     * its own answer against this one predicate: {@link setSelectedIndex} keeps the permissive
     * model (an index past the end is how "nothing selected" is spelled and
     * {@link selectedValue} reads `''`), while `<gtk-drop-down>` rejects the set, as its
     * published `selected` docs promise.
     */
    hasIndex(index: number): boolean {
        return Number.isFinite(index) && index >= 0 && index < this._options.length;
    }

    /**
     * Select an option by index as a USER pick (the chooser result) — notifies
     * `interactive: true`. A no-op for the already-selected index or one that addresses no
     * option.
     *
     * The UPPER bound is part of that guard: a pick is a pick OF something, so `select(99)` on
     * a three-option model is not "select nothing", it is a chooser reporting an index the
     * model does not have.
     */
    select(index: number): boolean {
        if (!this.hasIndex(index) || index === this._selected) return false;
        return this._setIndex(index, true);
    }

    /** Number of options. */
    get count(): number {
        return this._options.length;
    }
}

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
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
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
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
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
