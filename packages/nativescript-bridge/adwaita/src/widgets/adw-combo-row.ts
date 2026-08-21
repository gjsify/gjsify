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
// half: the inline value `Label` + chevron `AdwIcon`, the native `action()`
// chooser, and the `notify::selected` GObject-style signal — all driven by the
// state object (a programmatic set refreshes the label silently, the chooser pick
// re-emits `notify::selected`).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_combo_row.scss` (dim value +
// `go-down` chevron).
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss (AdwComboRow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { panDownSymbolic } from '@gjsify/adwaita-icons/ui';
import { action, Label, StackLayout, type EventData } from '@nativescript/core';
import { ComboState } from '@gjsify/adwaita-core';
import type { AdwComboOption } from '@gjsify/adwaita-core';
import { AdwActionRow } from './adw-action-row.js';
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';

// Re-export the headless state machine + the option type so consumers can reach
// them from `@gjsify/adwaita-nativescript` unchanged.
export { ComboState } from '@gjsify/adwaita-core';
export type { AdwComboOption, ComboStateChange, ComboStateListener } from '@gjsify/adwaita-core';

/** Event name emitted when {@link AdwComboRow.selectedIndex} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Payload of the `notify::selected` event. */
export interface NotifySelectedEventData extends EventData {
    /** The newly-selected index. */
    selected: number;
    /** The newly-selected option's `value`. */
    value: string;
}

export class AdwComboRow extends AdwActionRow {
    /** The dim inline value label (selected option). */
    protected readonly _valueLabel: Label;
    /** The down-chevron — a real Adwaita `pan-down-symbolic` icon. */
    protected readonly _chevron: AdwIcon;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-combo-row';

        const suffix = new StackLayout();
        suffix.orientation = 'horizontal';
        suffix.className = 'adw-combo-suffix';

        const valueLabel = new Label();
        valueLabel.className = 'adw-combo-value';
        valueLabel.text = '';

        const chevron = new AdwIcon();
        chevron.className = 'adw-combo-chevron';
        chevron.iconColor = '#9a9a9a'; // dim — matches the old chevron's ~0.45 alpha
        chevron.iconSize = 16;
        chevron.icon = panDownSymbolic;

        suffix.addChild(valueLabel);
        suffix.addChild(chevron);
        this.setSuffix(suffix);

        this._valueLabel = valueLabel;
        this._chevron = chevron;

        // The core state drives the inline label on every change and the
        // notify::selected on an interactive pick.
        this._state.subscribe((change) => {
            this._valueLabel.text = change.label;
            this._syncChooser();
            if (change.interactive) {
                const data: NotifySelectedEventData = {
                    eventName: NOTIFY_SELECTED,
                    object: this,
                    selected: change.selected,
                    value: change.value,
                };
                this.notify(data);
            }
        });

        // Tapping anywhere on the row opens the native chooser...
        this.addEventListener('tap', () => {
            void this._openChooser();
        });
        // ...and the row darkens while held, like an Adwaita activatable row.
        attachRowPressFeedback(this);
        this._syncChooser();
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

    /** The selectable options. Updates the inline value label. */
    get options(): AdwComboOption[] {
        return this._state.options;
    }

    set options(value: AdwComboOption[]) {
        this._state.setOptions(value);
    }

    /** The selected option index. Updates the inline value label. */
    get selectedIndex(): number {
        return this._state.selectedIndex;
    }

    set selectedIndex(value: number) {
        this._state.setSelectedIndex(value);
    }

    /** The selected option's `value`, or `''` when out of range. */
    get selectedValue(): string {
        return this._state.selectedValue;
    }

    set selectedValue(value: string) {
        this._state.setSelectedValue(value);
    }
}
