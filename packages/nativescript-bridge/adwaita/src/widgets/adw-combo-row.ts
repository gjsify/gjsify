// AdwComboRow — a Libadwaita-style combo (dropdown) row for NativeScript.
//
// Extends {@link AdwActionRow}. The suffix shows the SELECTED value inline plus a
// small down-chevron ("Blue ⌄"), exactly like `Adw.ComboRow` — NOT an expanded
// wheel. Tapping the row opens a native `action()` chooser dialog; picking an
// option updates `selectedIndex` and emits `notify::selected`, mirroring the
// GObject `notify::selected` signal naming used by `Adw.ComboRow` and
// `@gjsify/adwaita-web`'s `<adw-combo-row>`.
//
// The selection STATE MACHINE (the options list, the two-way selectedIndex↔
// selectedValue mapping, the empty/out-of-range guards, and the programmatic-vs-
// interactive notify split) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR
// 0004) as {@link ComboState}; this class composes it and keeps only the NS render
// half: the inline value `Label` + chevron `GtkImage`, the native `action()`
// chooser, and the `notify::selected` GObject-style signal — all driven by the
// state object (a programmatic set refreshes the label silently, the chooser pick
// re-emits `notify::selected`).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_combo_row.scss` (dim value +
// `go-down` chevron).
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (AdwComboRow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { panDownSymbolic } from '@gjsify/adwaita-icons/ui';
import { action, Label, StackLayout, type View } from '@nativescript/core';
import {
    ADW_COMBO_NO_SELECTION,
    ComboState,
    GjsifyOptionList,
    ListModel,
    TYPE_OBJECT,
    readModelWrite,
} from '@gjsify/adwaita-core';
import type { AdwComboOption, ComboNotify, ComboWatchableModel } from '@gjsify/adwaita-core';
import { AdwActionRow } from './adw-action-row.js';
import { builderSlotsOf, resolveBuilderSlot } from './builder-slots.js';
import { GtkImage } from './gtk-image.js';
import { attachRowPressFeedback } from './row-press.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { pushDeclared, readDeclaredValue, withProperties } from './signals.js';

// Re-export the headless state machine + the option type so consumers can reach
// them from `@gjsify/adwaita-nativescript` unchanged.
export { ComboState } from '@gjsify/adwaita-core';
export type { AdwComboOption, ComboStateChange, ComboStateListener } from '@gjsify/adwaita-core';

/** Event name emitted when {@link AdwComboRow.selected} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/**
 * What a declared property's {@link DeclaredProperty.normalize} reads off the row. Structural,
 * because `normalize` is handed a bare `object` while the instance may still be constructing
 * (the `EntryRowValues` precedent) — and because these two members are private to the class,
 * which a cast to `AdwComboRow` could not reach.
 */
interface ComboRowValues {
    readonly _state: ComboState;
    readonly _authored: GjsifyOptionList;
    _pendingSelected: number | null;
    readonly model: ComboWatchableModel | null;
    readonly selected: number;
}

export class AdwComboRow extends withProperties(AdwActionRow, {
    GTypeName: 'AdwComboRow',
    Properties: {
        // ALL THREE ARE `explicitNotify`, and that is one decision, not three: the measured
        // emission ORDER of this widget is not the order a store-level "it changed, so notify"
        // produces, so `ComboState` owns every emission and the seam owns none. The sharpest
        // case is `model = null`, which notifies `model` ALONE while `selected` goes to the
        // sentinel and `selected-item` to null SILENTLY (GJS 1.88 / libadwaita 1.9.4).
        //
        // Two of them are object-kind, which makes them seam-owned for a SECOND reason as well:
        // every model this port holds is pure JS by construction (ADR 0122 § A3), so it could
        // not enter a real GObject slot anyway. See `isSeamOwned` in `signals.ts`.
        model: {
            kind: 'object',
            valueType: ListModel,
            explicitNotify: true,
            blurb: 'The model used by the combo row',
            // SHAPE ONLY — `readModelWrite` validates and converts, and the state is left to
            // `afterNotify`. Were the state moved here, the selection it resets would notify
            // BEFORE the `model` that caused it, and the measured order ends with `model`.
            //
            // The one side effect it does keep is the authored list's splice: a JSON attribute
            // reconciles `_authored` IN PLACE and hands back the same object, so re-parsing the
            // attribute moves the list the row already points at. The seam's equal-write guard
            // then stops the write — which is right, because libadwaita answers a re-assignment
            // of the held model with nothing, and the splice has already emitted what a splice
            // emits through `items-changed`.
            normalize: (value, self) => readModelWrite(value, (self as ComboRowValues)._authored),
            afterNotify: (self) => {
                const row = self as ComboRowValues;
                // `setModel` emits `selected`, `selected-item`, `model` through the relay, in
                // that order and all three — see `ComboState.setModel`.
                row._state.setModel(row.model);
                // The index that arrived before the model did (see `_pendingSelected`). Applied
                // AFTER, so it reads as what it is: a second write that found its model.
                const pending = row._pendingSelected;
                if (pending !== null && row._state.hasIndex(pending)) {
                    row._pendingSelected = null;
                    row._state.setSelectedIndex(pending);
                }
            },
        },
        // `int`, where libadwaita declares `guint`. The port's "nothing selected" is
        // `ADW_COMBO_NO_SELECTION` (-1) — the recorded divergence #2 of the conformance table
        // in `adwaita-core/src/conformance/rows.ts`, shared by all four combo widgets and by
        // `ADW_SIDEBAR_NO_SELECTION` — and a uint ParamSpec REFUSES that default outright
        // ("value is out of range for uint32", measured GJS 1.88). The pspec is a declaration
        // surface only here, because `explicitNotify` keeps the value in the seam's store and
        // out of the GObject, so the sign costs nothing a consumer can observe.
        selected: {
            kind: 'int',
            default: ADW_COMBO_NO_SELECTION,
            explicitNotify: true,
            blurb: 'The position of the selected item',
            normalize: (value, self) => {
                const row = self as ComboRowValues;
                const next = readDeclaredValue('selected', 'int', value) as number;
                // No model yet: hold the index rather than drop it. NativeScript's XML builder
                // assigns every attribute before it adds the children, so `selected="1"` reaches
                // this normalizer before `<adw:ComboRow.model>` does.
                if (row._state.count === 0) {
                    row._pendingSelected = next;
                    return row.selected;
                }
                // The ONE bounds predicate, `ComboState.hasIndex` — so a programmatic write and
                // a user pick refuse the same indices, the sentinel on a non-empty model
                // included. Resolving back to the held value is what makes the write silent.
                return row._state.hasIndex(next) ? next : row.selected;
            },
            afterNotify: (self) => {
                const row = self as ComboRowValues;
                // Emits `selected` then `selected-item` through the relay.
                row._state.setSelectedIndex(row.selected);
            },
        },
        // READ-ONLY by derivation, the way `AdwEntryRow:text-length` is: a write resolves to the
        // value already held, so it changes nothing and notifies nothing. libadwaita THROWS on a
        // write instead — recorded as consumer-visible rather than hidden, because the seam has
        // no read-only arm and inventing one for a single property would be a second vocabulary.
        'selected-item': {
            kind: 'object',
            valueType: TYPE_OBJECT,
            explicitNotify: true,
            blurb: 'The selected item',
            normalize: (_value, self) => (self as ComboRowValues)._state.selectedItem,
        },
    },
}) {
    static readonly GTypeName: string = 'AdwComboRow';

    /**
     * The action row's edges, plus `model`: `model: Gtk.StringList { strings [ … ] }` in a
     * `.blp` places the list at the property it sets (ADR 0072).
     */
    static readonly builderSlots: readonly string[] = builderSlotsOf([...AdwActionRow.builderSlots, 'model'], 'suffix');

    /** The dim inline value label (selected option). */
    protected readonly _valueLabel: Label;
    /** The down-chevron — a real Adwaita `pan-down-symbolic` icon. */
    protected readonly _chevron: GtkImage;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    /**
     * The list the MARKUP door fills — `<adw:ComboRow model='[…]'>` is JSON text, and a real
     * `Gio.ListModel` has no attribute spelling (ADR 0122 § 5). Held for the row's whole life so
     * re-parsing the attribute splices the list the row already points at rather than replacing
     * it, which would reset the selection.
     */
    private readonly _authored = GjsifyOptionList.new(null);
    /**
     * A `selected` written while the row has no model yet. NativeScript's XML builder assigns
     * every attribute before it adds the children, so `<adw:ComboRow selected="1">` reaches
     * this setter before its `<adw:ComboRow.model>` list does, and the index had nothing to
     * select. Held until the first model arrives, which is the order a `.blp` states when it
     * writes `model:` first — the order GtkBuilder needs too.
     */
    private _pendingSelected: number | null = null;

    /** `Adw.ComboRow:model` — the list, by identity. Declared above; the seam installs it. */
    declare model: ComboWatchableModel | null;

    /**
     * `Adw.ComboRow:selected` — the selected position, or {@link ADW_COMBO_NO_SELECTION}.
     * Declared above; not `readonly` in TypeScript because the seam installs one accessor pair
     * per declared property and this row is what writes the derived value.
     */
    declare selected: number;

    /**
     * `Adw.ComboRow:selected-item` — the model's OWN object at {@link selected}, so the identity
     * comparison a `selected-item` consumer writes holds. `null` for the sentinel and for no
     * model. Read-only by derivation (see the declaration).
     */
    declare selectedItem: unknown;

    constructor(props?: ConstructProps<AdwComboRow>) {
        super();

        this.className = 'adw-row adw-action-row adw-combo-row';

        const suffix = new StackLayout();
        suffix.orientation = 'horizontal';
        suffix.className = 'adw-combo-suffix';

        const valueLabel = new Label();
        valueLabel.className = 'adw-combo-value';
        valueLabel.text = '';

        const chevron = new GtkImage();
        chevron.className = 'adw-combo-chevron';
        chevron.iconColor = '#9a9a9a'; // dim — matches the old chevron's ~0.45 alpha
        chevron.pixelSize = 16;
        chevron.iconName = panDownSymbolic;

        suffix.addChild(valueLabel);
        suffix.addChild(chevron);
        this.add_suffix(suffix);

        this._valueLabel = valueLabel;
        this._chevron = chevron;

        // The core state drives the inline label on every change, and PUSHES the derived
        // properties silently. Silently is the point: a transition moves `selected` and
        // `selected-item` whether or not it owes a `notify::` for them — `model = null` moves
        // both and notifies neither — so the push and the emission are two channels, and this
        // is the one that keeps the store true.
        this._state.subscribe((change) => {
            pushDeclared(this, 'selected', change.selected);
            pushDeclared(this, 'selected-item', this._state.selectedItem);
            this._valueLabel.text = change.label;
            this._syncChooser();
        });

        // ...and this is the one that emits, in the measured order, one `notify::` at a time.
        // `ComboState.subscribeNotify` exists for "a renderer that owns real GObject
        // properties", which is what this row became: the `interactive` carve-out of the
        // conformance table's divergence #1 is GONE here, and a programmatic write now notifies
        // exactly as it does in libadwaita.
        this._state.subscribeNotify((property: ComboNotify) => {
            pushDeclared(this, property, this._valueOf(property));
            this.notify(property);
        });

        // Tapping anywhere on the row opens the native chooser...
        this.addEventListener('tap', () => {
            void this._openChooser();
        });
        // ...and the row darkens while held, like an Adwaita activatable row.
        attachRowPressFeedback(this);
        this._syncChooser();

        applyConstructProps(this, props);
    }

    /** What the relay pushes for each of the three — the state's reading, never the store's. */
    private _valueOf(property: ComboNotify): unknown {
        if (property === 'model') return this._state.model;
        return property === 'selected' ? this._state.selectedIndex : this._state.selectedItem;
    }

    /**
     * `model_changed` (adw-combo-row.c:187-195) — one option or none is not a
     * choice, so the chevron goes and the row stops being activatable.
     *
     * Both halves matter. Hiding the chevron alone would leave a row that still
     * opens a one-entry `action()` sheet on tap; the tap guard is in
     * {@link _openChooser}, which reads the same predicate.
     */
    private _syncChooser(): void {
        this._chevron.visibility = this._state.presentsChooser ? 'visible' : 'collapse';
    }

    /** Open the native action chooser and apply the picked option. */
    private async _openChooser(): Promise<void> {
        // `n_items > 1`: a single option is not a choice, and libadwaita makes
        // the row non-activatable rather than opening a sheet with one entry.
        if (!this._state.presentsChooser) return;
        const labels = this._state.options.map((o) => o.label);
        const chosen = await action({
            title: this.title || undefined,
            cancelButtonText: 'Cancel',
            actions: labels,
        });
        // A user pick — the core `select` guards the no-op/negative case and
        // notifies `interactive`, so the subscriber re-emits `notify::selected`.
        this._state.select(labels.indexOf(chosen));
    }

    /** The held model's items as `{ value, label }` descriptors. */
    get options(): AdwComboOption[] {
        return this._state.options;
    }

    /** `adw_combo_row_set_model`. */
    set_model(model: ComboWatchableModel | null): void {
        this.model = model;
    }

    /** `adw_combo_row_get_model`. */
    get_model(): ComboWatchableModel | null {
        return this.model;
    }

    /**
     * XML inflation: a child at `model` is the row's list — a `Gtk.StringList` IS a
     * `Gio.ListModel`, so it goes through the same setter as the property. Everything else is a
     * row edge, as on any action row.
     */
    _addChildFromBuilder(name: string, child: View): void {
        if (resolveBuilderSlot(name, ['model'], 'edge') === 'model') {
            this.model = child as unknown as ComboWatchableModel;
            return;
        }
        super._addChildFromBuilder(name, child);
    }

    /** `adw_combo_row_get_selected`. */
    get_selected(): number {
        return this.selected;
    }

    set_selected(position: number): void {
        this.selected = position;
    }

    /** The selected option's `value`, or `''` when out of range. */
    get selectedValue(): string {
        return this._state.selectedValue;
    }

    set selectedValue(value: string) {
        this._state.setSelectedValue(value);
    }

    /** `adw_combo_row_get_selected_item`. */
    get_selected_item(): unknown {
        return this.selectedItem;
    }
}
