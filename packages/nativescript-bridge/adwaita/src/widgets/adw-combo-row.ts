// AdwComboRow — a Libadwaita-style combo (dropdown) row for NativeScript.
//
// Extends {@link AdwActionRow}. The suffix shows the SELECTED value inline plus a
// small down-chevron ("Blue ⌄"), exactly like `Adw.ComboRow` — NOT an expanded
// wheel. Tapping the row opens a native `action()` chooser dialog; picking an
// option updates `selectedIndex` and emits `notify::selected`, mirroring the
// GObject `notify::selected` signal naming used by `Adw.ComboRow` and
// `@gjsify/adwaita-web`'s `<adw-combo-row>`.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_combo_row.scss` (dim value +
// `go-down` chevron).
// Reference: refs/libadwaita/src/stylesheet/widgets/_combo-row.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { action, Label, StackLayout, type EventData } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';

/** One selectable option in an {@link AdwComboRow}. */
export interface AdwComboOption {
    /** Display label shown in the row + chooser. */
    label: string;
    /** Underlying value returned by {@link AdwComboRow.selectedValue}. */
    value: string;
}

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
    /** The down-chevron label. */
    protected readonly _chevronLabel: Label;
    private _options: AdwComboOption[] = [];
    private _selectedIndex = 0;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-combo-row';

        const suffix = new StackLayout();
        suffix.orientation = 'horizontal';
        suffix.className = 'adw-combo-suffix';

        const valueLabel = new Label();
        valueLabel.className = 'adw-combo-value';
        valueLabel.text = '';

        const chevronLabel = new Label();
        chevronLabel.className = 'adw-combo-chevron';
        chevronLabel.text = '⌄'; // U+2304 DOWN ARROWHEAD

        suffix.addChild(valueLabel);
        suffix.addChild(chevronLabel);
        this.setSuffix(suffix);

        this._valueLabel = valueLabel;
        this._chevronLabel = chevronLabel;

        // Tapping anywhere on the row opens the native chooser.
        this.addEventListener('tap', () => {
            void this._openChooser();
        });
    }

    /** Open the native action chooser and apply the picked option. */
    private async _openChooser(): Promise<void> {
        if (this._options.length === 0) return;
        const labels = this._options.map((o) => o.label);
        const chosen = await action({
            title: this.title || undefined,
            cancelButtonText: 'Cancel',
            actions: labels,
        });
        const idx = labels.indexOf(chosen);
        if (idx >= 0 && idx !== this._selectedIndex) {
            this.selectedIndex = idx;
            this._emitSelected();
        }
    }

    /** Refresh the inline value label from the current selection. */
    private _syncValueLabel(): void {
        this._valueLabel.text = this._options[this._selectedIndex]?.label ?? '';
    }

    private _emitSelected(): void {
        const data: NotifySelectedEventData = {
            eventName: NOTIFY_SELECTED,
            object: this,
            selected: this._selectedIndex,
            value: this.selectedValue,
        };
        this.notify(data);
    }

    /** The selectable options. Updates the inline value label. */
    get options(): AdwComboOption[] {
        return this._options;
    }

    set options(value: AdwComboOption[]) {
        this._options = Array.isArray(value) ? value : [];
        if (this._selectedIndex >= this._options.length) {
            this._selectedIndex = 0;
        }
        this._syncValueLabel();
    }

    /** The selected option index. Updates the inline value label. */
    get selectedIndex(): number {
        return this._selectedIndex;
    }

    set selectedIndex(value: number) {
        const next = Number.isFinite(value) ? value : 0;
        if (next !== this._selectedIndex) {
            this._selectedIndex = next;
            this._syncValueLabel();
        }
    }

    /** The selected option's `value`, or `''` when out of range. */
    get selectedValue(): string {
        return this._options[this._selectedIndex]?.value ?? '';
    }

    set selectedValue(value: string) {
        const idx = this._options.findIndex((o) => o.value === value);
        if (idx >= 0) {
            this.selectedIndex = idx;
        }
    }
}
