// Headless Adwaita ROW interaction state machines (ADR 0004 — headless Adwaita core).
//
// The selection / disclosure / clamp-and-snap logic behind the Libadwaita row widgets, so
// every renderer shares ONE behavior:
//   - {@link ExpanderState}    — `Adw.ExpanderRow`'s expanded/collapsed disclosure.
//   - {@link ComboState}       — `Adw.ComboRow`'s selectedIndex↔selectedValue mapping
//                                over an options list, with empty/out-of-range guards.
//   - {@link SpinState}        — `Adw.SpinRow`'s adjustment: a watchable `Gtk.Adjustment`
//                                over the portable value in `adjustment.ts` (ADR 0047),
//                                which is where it now lives.
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

import { ADW_COMBO_NO_SELECTION, listItemsChanged, normalizeComboOptions } from './list.js';
import type { AdwComboOption, AdwListItemsChanged, AdwListModelSource } from './list.js';

// The ITEM vocabulary moved to `list.ts` (ADR 0046) — one module owns what an item is, for
// every widget GTK gives a `model` property. Re-exported under its published names so
// neither import path changed and no fifth spelling of "an item" was created.
export { ADW_COMBO_NO_SELECTION, normalizeComboOptions } from './list.js';
export type { AdwComboOption, AdwComboOptionInput } from './list.js';
// `SpinState` moved to `adjustment.ts` with the value it holds (ADR 0047) and is
// re-exported here, so the import path three renderers use did not change.
export { SpinState } from './adjustment.js';
export type { SpinStateChange, SpinStateListener, SpinStateRangeListener } from './adjustment.js';

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
 * A GObject property of `Adw.ComboRow` / `Gtk.DropDown` whose `notify::` a renderer owes its
 * widget — the three ADR 0122 § 5's table is written in terms of.
 */
export type ComboNotify = 'selected' | 'selected-item' | 'model';

/** Subscriber for the `notify::*` a {@link ComboState} transition owes, in emission ORDER. */
export type ComboNotifyListener = (property: ComboNotify) => void;

/**
 * What {@link ComboState} needs off a model to WATCH it, beyond reading it.
 *
 * Optional, and duck-typed for the reason `AdwListModelSource` is: a real `Gio.ListModel` has
 * `connect`, and so does every model this repository builds, but the reader in `list.ts` accepts
 * anything with the two getters and a state machine that DEMANDED a signal surface would refuse
 * models it can otherwise read perfectly.
 *
 * EXPORTED because it is the published type of a `model` property now (ADR 0122 § 4). Left
 * un-exported it still reached the `.d.ts`, so a consumer could satisfy it and not NAME it —
 * which is the shape that makes a caller declare its own copy.
 */
export interface ComboWatchableModel extends AdwListModelSource {
    connect?: (signal: string, handler: (...args: unknown[]) => void) => number;
    disconnect?: (id: number) => void;
}

/**
 * Subscribe to a model's `items-changed`, or to nothing when it has no signals.
 *
 * Returns the detach function either way, so the caller has one shape to store and no branch
 * of its own.
 */
function watchItemsChanged(model: ComboWatchableModel, handler: (change: AdwListItemsChanged) => void): () => void {
    if (typeof model.connect !== 'function' || typeof model.disconnect !== 'function') return () => {};
    const id = model.connect('items-changed', (...args: unknown[]) => {
        // The emitter hands the SOURCE first, as every GObject signal does.
        const [position, removed, added] = args.slice(1) as number[];
        handler({ position: position ?? 0, removed: removed ?? 0, added: added ?? 0 });
    });
    return () => void model.disconnect?.(id);
}

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
    /** The model's IDENTITY — the object `model` hands back, never a copy (ADR 0122 § 4). */
    private _model: ComboWatchableModel | null = null;
    /** The descriptors the held model holds, re-read whenever it says it changed. */
    private _options: AdwComboOption[] = [];
    private _selected = ADW_COMBO_NO_SELECTION;
    /** Detaches this state from the held model's `items-changed`. */
    private _unwatch: (() => void) | null = null;
    private readonly _listeners = new Set<ComboStateListener>();
    private readonly _itemListeners = new Set<ComboItemsListener>();
    private readonly _notifyListeners = new Set<ComboNotifyListener>();

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: ComboStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * Subscribe to the `notify::*` each transition owes, delivered one at a time IN ORDER.
     *
     * Separate from {@link subscribe} because the two answer different questions and the
     * ordering is the whole content of this one. It is the seam for a renderer that owns real
     * GObject properties — none does today: both ports render DOM or NativeScript views and
     * use {@link subscribe}, so this channel is measured in core alone (its table says so).
     * Re-emitting it verbatim is what a host with real properties has to do, and the reason
     * the order is recorded here rather than re-derived there.
     *
     * The ORDER is not derived, it is measured, and it is not the same on both paths
     * (`~/.cache/gjsify-android/combo-probe2.js`, GJS 1.88.01 / libadwaita 1.9.4):
     *
     *   - a `model` write notifies `selected`, `selected-item`, `model` — in that order, and
     *     ALL THREE even when `selected` ends on the value it already had;
     *   - a `selected` write notifies `selected`, then `selected-item`;
     *   - an `items-changed` on the HELD model notifies `selected-item` BEFORE `selected`.
     *
     * The third is the inverse of the second, which is why no single rule is written here.
     */
    subscribeNotify(listener: ComboNotifyListener): () => void {
        this._notifyListeners.add(listener);
        return () => {
            this._notifyListeners.delete(listener);
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

    /** Deliver one `notify::`, snapshotted for the reason `_emit` states. */
    private _notify(property: ComboNotify): void {
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._notifyListeners]) listener(property);
    }

    /** Deliver one `items-changed`, snapshotted for the reason `_emit` states. */
    private _emitItems(change: AdwListItemsChanged): void {
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._itemListeners]) listener(change);
    }

    private _setIndex(next: number, interactive: boolean): boolean {
        if (next === this._selected) return false;
        this._selected = next;
        this._emit(interactive);
        // `selected` THEN `selected-item`, measured for a `selected` write. The reverse order
        // belongs to the `items-changed` path alone — see {@link subscribeNotify}.
        this._notify('selected');
        this._notify('selected-item');
        return true;
    }

    /**
     * The list model — `Adw.ComboRow:model` / `Gtk.DropDown:model`, by IDENTITY.
     *
     * The OBJECT that was assigned, never a copy and never a snapshot of its items: ADR 0122
     * § 4 makes `model` an object-kind property over a real `Gio.ListModel`, and `row.model
     * === model` is measured to hold in libadwaita. The copy this getter used to hand back
     * belonged to the Array era, where the model WAS its items and the splice was computed by
     * comparing two arrays — which made `const m = row.model; m.push(x); row.model = m` a
     * silent no-op the copy existed to prevent. A live model has no such round trip: items go
     * in through the model's own API, and it says so itself with `items-changed`.
     *
     * The normalised `{ value, label }` descriptors moved to {@link options}, which is what a
     * renderer drawing the list wants and is still a copy.
     */
    get model(): ComboWatchableModel | null {
        return this._model;
    }

    /**
     * The held model's items as the normalised `{ value, label }` descriptors (ADR 0046's item
     * vocabulary), re-read whenever the model says it changed.
     *
     * A COPY, items included, for the reason the cache exists: `_options` is what every label
     * lookup on this class reads, so a caller that retained it and mutated an item would move
     * the row's inline text without the model knowing. The copy is what keeps the model the
     * single source — mutate the MODEL and the descriptors follow, which is the whole point of
     * holding one.
     *
     * Cost, MEASURED rather than assumed (Node 24.19, `{value,label}` records): linear, about
     * four nanoseconds per item — so a read is well under a microsecond at every size a combo
     * row actually holds. What the shape rules out is a per-item read: the call sites that had
     * one — `_applyItemsChanged` in each browser selector, `_filter` in `<gtk-drop-down>` which
     * runs per row per keystroke — hoist it out of their loop, so a read is O(n) once per
     * operation instead of O(n²). Nothing reads it per frame. A model large enough for the
     * linear term to matter is a `Gtk.ListView` and belongs to `ListController`'s
     * virtualisation, which ADR 0046 § 7 keeps out of this class on purpose.
     */
    get options(): AdwComboOption[] {
        return this._options.map((option) => ({ value: option.value, label: option.label }));
    }

    /**
     * The selected ITEM — `Adw.ComboRow:selected-item` / `Gtk.DropDown:selected-item`.
     *
     * The model's OWN item at {@link selectedIndex}, read through `get_item`, so
     * `row.selectedItem === model.get_item(row.selectedIndex)` the way it is measured to hold
     * in libadwaita. Not a descriptor: the item is whatever the model holds — a
     * `GjsifyOptionObject`, a `Gtk.StringObject`, an application object — and handing back the
     * normalised `{ value, label }` instead would make the identity comparison every
     * `selected-item` consumer writes fail. {@link selectedValue} / {@link selectedLabel} are
     * the descriptor side of the same question.
     *
     * `null` for the sentinel, for no model, and for an item the model declines to hand over.
     */
    get selectedItem(): unknown {
        if (!this._model || this._selected < 0) return null;
        return this._model.get_item(this._selected) ?? null;
    }

    /**
     * Replace the model — the `model` property write of ADR 0122 § 5.
     *
     * Assigning the model the state ALREADY holds does nothing at all: no splice, no selection
     * emit, no `notify::`. Identity is the test, because identity is now what the property
     * holds — two distinct models with equal contents are two different values of `model`, and
     * GTK treats them that way.
     *
     * Otherwise the state detaches from the old model's `items-changed`, attaches to the new
     * one's, re-reads the descriptors, and RE-RUNS AUTOSELECT: the selection lands on 0, or on
     * {@link ADW_COMBO_NO_SELECTION} when the new model is empty. Not a clamp of the old index
     * — measured, a replacement resets the selection to 0 even when the old index exists in the
     * new model (`combo-probe2.js`: selected 2, new model of 3 → selected 0).
     *
     * The `notify::` set is measured and is NOT conditional on anything having changed: a
     * non-null model notifies `selected`, `selected-item`, `model` in that order, even when the
     * selection ends on the value it already had; `model = null` notifies `model` ALONE, and
     * the selection goes to the sentinel silently.
     *
     * The splice ({@link subscribeItems}) is emitted first and only when the descriptors
     * actually differ, because that channel is a renderer's instruction to move item views and
     * an empty instruction is noise. It is NOT `Gio.ListModel::items-changed` — no model emits
     * one when a WIDGET swaps which model it points at — it is this class telling its renderer
     * what the swap did to the drawn list.
     */
    setModel(model: ComboWatchableModel | null): void {
        if (model === this._model) return;
        this._unwatch?.();
        this._unwatch = null;
        const previous = this._options;
        this._model = model;
        this._options = model ? normalizeComboOptions(model) : [];
        this._selected = this._options.length === 0 ? ADW_COMBO_NO_SELECTION : 0;
        if (model) this._unwatch = watchItemsChanged(model, (change) => this._onItemsChanged(change));

        const change = listItemsChanged(previous, this._options);
        if (change) this._emitItems(change);
        this._emit(false);
        if (model) {
            this._notify('selected');
            this._notify('selected-item');
        }
        this._notify('model');
    }

    /**
     * The held model moved under us — `Gio.ListModel::items-changed`, forwarded to the
     * renderer and then applied to the selection the way `GtkSingleSelection` applies it.
     *
     * Four cases, all MEASURED (`combo-probe2.js`, GJS 1.88.01 / GTK 4.22.5), and the notify
     * ORDER here is the inverse of the `selected`-write path — `selected-item` comes FIRST,
     * because the item under the selection changed before the index did:
     *
     *   - nothing selected → autoselect takes 0 as soon as the model has one, notifying
     *     `selected-item` then `selected`;
     *   - the change sits entirely AFTER the selection → the index still addresses the same
     *     item, no notify at all;
     *   - entirely BEFORE it → the item did not change, only its position did, so the index
     *     shifts by `added - removed` and ONLY `selected` notifies;
     *   - the change COVERS the selection → the selected item is gone, so the index clamps to
     *     `min(position, n_items - 1)` (the sentinel for an emptied model) and `selected-item`
     *     notifies whether or not the index moved — which is what makes a replace-in-place
     *     (`removed: 1, added: 1` at the selection) notify `selected-item` alone.
     */
    private _onItemsChanged(change: AdwListItemsChanged): void {
        this._options = this._model ? normalizeComboOptions(this._model) : [];
        this._emitItems(change);

        const before = this._selected;
        const count = this._options.length;
        if (before === ADW_COMBO_NO_SELECTION) {
            if (count === 0) return;
            this._selected = 0;
            this._emit(false);
            this._notify('selected-item');
            this._notify('selected');
            return;
        }
        if (before < change.position) return;
        if (before >= change.position + change.removed) {
            this._selected = before + change.added - change.removed;
            this._emit(false);
            this._notify('selected');
            return;
        }
        this._selected = count === 0 ? ADW_COMBO_NO_SELECTION : Math.min(change.position, count - 1);
        this._emit(false);
        this._notify('selected-item');
        if (this._selected !== before) this._notify('selected');
    }

    /**
     * The selected option index, or {@link ADW_COMBO_NO_SELECTION}.
     *
     * Always either the sentinel or a position the model HAS: every door that writes it
     * ({@link setSelectedIndex}, {@link select}, autoselect) refuses an index the model does
     * not address, so this is the one place "nothing selected" is spelled.
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

    /**
     * Programmatic index set — notifies `interactive: false`. Returns whether it changed.
     *
     * An index the model does not have is IGNORED, silently: no change, no notify, no error.
     * That is measured on both widgets (`combo-probe2.js`: `selected = 5` on a model of 3, and
     * `selected = GTK_INVALID_LIST_POSITION` on a non-empty model, each leave `selected` where
     * it was and emit nothing). `Adw.ComboRow` forwards the position to
     * `gtk_single_selection_set_selected`, which validates it — so this is not a renderer
     * policy and no renderer states its own answer any more.
     */
    setSelectedIndex(index: number): boolean {
        if (!this.hasIndex(index)) return false;
        return this._setIndex(index, false);
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
     * Whether `index` addresses an item the held model has.
     *
     * The ONE bounds predicate: {@link setSelectedIndex} and {@link select} both refuse what it
     * refuses, so a programmatic set and a user pick agree about what is out of range. They
     * once did not — `refs/gtk` is empty, so what `gtk_single_selection_set_selected` does with
     * `GTK_INVALID_LIST_POSITION` was not verifiable in this tree and each renderer stated its
     * own answer. It is now measured (see {@link setSelectedIndex}) and there is one.
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

/**
 * The toggles a group keeps, in add order.
 *
 * A NAME IS UNIQUE, AND THE SECOND CLAIM IS REFUSED WHOLE. `add_toggle` looks the name up
 * before adding and, when another toggle already carries it, prints a `g_critical` and
 * drops the toggle — it is never added, so it draws no button and takes no index
 * (adw-toggle-group.c:849). An unnamed toggle is always kept.
 */
export function keptToggles<T extends { readonly name?: string | null }>(toggles: readonly T[]): T[] {
    const taken = new Set<string>();
    const kept: T[] = [];
    for (const toggle of toggles) {
        const name = toggle.name ?? null;
        if (name !== null && taken.has(name)) continue;
        if (name !== null) taken.add(name);
        kept.push(toggle);
    }
    return kept;
}

/**
 * The toggle `adw_toggle_group_set_active_name` selects: its index among the names of the
 * KEPT toggles ({@link keptToggles}), or `-1` when none carries `name`.
 *
 * `-1` is not a selection. The C answers a name nothing carries with a `g_critical` and
 * returns (:2001) — the active toggle stays where it was — so a renderer leaves its
 * selection alone on `-1` rather than clearing it.
 */
export function toggleIndexOfName(names: readonly (string | null | undefined)[], name: string): number {
    return names.indexOf(name);
}
