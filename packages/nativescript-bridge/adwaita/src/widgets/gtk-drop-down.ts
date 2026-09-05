// GtkDropDown — the Adwaita-styled GTK dropdown selector for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): libadwaita vendors no
// `adw-drop-down.c` and ships no dropdown type, as the FIDELITY note below says while
// listing what it therefore cannot reproduce. `AdwComboRow` is the boxed-list row form
// and IS a genuine Adw type; this one is `Gtk.DropDown`.
//
// The toolbar/inline twin of {@link AdwComboRow}: the same selection, without the
// boxed-list row around it. A button-shaped horizontal box showing the selected
// option's label plus a `pan-down` chevron; tapping it opens the chooser and the
// pick updates the label and emits `notify::selected`. Reach for this one when a
// dropdown sits in a header bar or a toolbar, and for `AdwComboRow` when it
// belongs to a preferences list.
//
// The selection STATE MACHINE is the row's: `ComboState` from `@gjsify/adwaita-core`
// (ADR 0004), held to its `COMBO_SELECTION_VECTORS`. This class is the render half only,
// so the standalone control and the row cannot drift apart.
//
// FIDELITY: approximated for the popover — the NS subset has none, so the options open
// in the platform `action()` sheet, the same substitution `AdwComboRow`,
// `AdwSplitButton` and `GtkMenuButton` make. Two unhideable consequences: the sheet has
// no search field, so `Gtk.DropDown:enable-search` is deliberately ABSENT rather than
// accepted-and-ignored; and the sheet marks nothing as selected, so the current option
// is visible only on the button (libadwaita vendors no `adw-drop-down.c`, so GtkDropDown's
// own factory model and selected-row check are not reproduced here).
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_dropdowns.scss
//   (`dropdown > button > box` border-spacing, the 16px `arrow`)
// Reference: refs/libadwaita/src/adw-combo-row.c (the shared selection semantics)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { panDownSymbolic } from '@gjsify/adwaita-icons/ui';
import { action, Label, StackLayout, type EventData } from '@nativescript/core';
import { ComboState, normalizeComboOptions } from '@gjsify/adwaita-core';
import type { AdwComboOption, AdwListModelInput } from '@gjsify/adwaita-core';
import { AdwIcon } from './adw-icon.js';
import { attachRowPressFeedback } from './row-press.js';
import { xmlNumber } from './xml-values.js';

/** Event name emitted when {@link GtkDropDown.selected} changes through a pick. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Payload of the `notify::selected` event. */
export interface NotifyDropDownSelectedEventData extends EventData {
    /** The newly-selected index. */
    selected: number;
    /** The newly-selected option's `value`. */
    value: string;
    /** The newly-selected option's `label` — what the button now shows. */
    label: string;
}

export class GtkDropDown extends StackLayout {
    /** The button label — the selected option. */
    protected readonly _label: Label;
    /** The down-chevron — a real Adwaita `pan-down-symbolic` icon. */
    protected readonly _chevron: AdwIcon;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    /** Title shown atop the substituted `action()` sheet. */
    private _chooserTitle = '';

    constructor() {
        super();

        this.orientation = 'horizontal';
        this.className = 'adw-drop-down';

        const label = new Label();
        label.className = 'adw-drop-down-label';
        label.text = '';

        // `dropdown arrow { min-height: 16px; min-width: 16px }`
        // (_dropdowns.scss:10-13) — which is exactly `DEFAULT_ADW_ICON_SIZE`, so
        // no size is set here. The colour is likewise left alone: an unpinned
        // AdwIcon follows the light/dark scheme, and GTK draws this arrow in the
        // button's own foreground.
        const chevron = new AdwIcon();
        chevron.className = 'adw-drop-down-chevron';
        chevron.iconName = panDownSymbolic;

        this.addChild(label);
        this.addChild(chevron);
        this._label = label;
        this._chevron = chevron;

        // The core state drives the button label on every change and the
        // notify::selected on an interactive pick.
        this._state.subscribe((change) => {
            this._label.text = change.label;
            if (change.interactive) {
                const data: NotifyDropDownSelectedEventData = {
                    eventName: NOTIFY_SELECTED,
                    object: this,
                    selected: change.selected,
                    value: change.value,
                    label: change.label,
                };
                this.notify(data);
            }
        });

        this.addEventListener('tap', () => {
            void this._openChooser();
        });
        // ...and the button darkens while held, like an Adwaita button `:active`.
        attachRowPressFeedback(this);
    }

    /** Open the native chooser and apply the picked option. */
    private async _openChooser(): Promise<void> {
        if (this._state.count === 0) return;
        const labels = this._state.model.map((o) => o.label);
        const chosen = await action({
            title: this._chooserTitle || undefined,
            cancelButtonText: 'Cancel',
            actions: labels,
        });
        // A user pick — the core `select` guards the dismissed sheet (`indexOf`
        // returns -1 for the cancel label) and the no-op re-pick, and notifies
        // `interactive`, so the subscriber re-emits `notify::selected`.
        this._state.select(labels.indexOf(chosen));
    }

    /** The list model (`Gtk.DropDown:model`). Updates the button label. */
    get model(): AdwComboOption[] {
        return this._state.model;
    }

    set model(value: AdwListModelInput) {
        // The SAME normaliser the browser elements run, so one authored model — bare
        // strings included — moves between the surfaces unchanged. This setter used to
        // take descriptors only, so `model = ['a','b']` stored strings and every label
        // read back `undefined`.
        this._state.setModel(normalizeComboOptions(value));
    }

    /** The selected option index (`Gtk.DropDown:selected`). */
    get selected(): number {
        return this._state.selectedIndex;
    }

    set selected(raw: number | string) {
        const value = xmlNumber(raw, this.selected);
        this._state.setSelectedIndex(value);
    }

    /** The selected option's `value`, or `''` when out of range. */
    get selectedValue(): string {
        return this._state.selectedValue;
    }

    set selectedValue(value: string) {
        this._state.setSelectedValue(value);
    }

    /** The selected option descriptor, or `null` when out of range (`Gtk.DropDown:selected-item`). */
    get selectedItem(): AdwComboOption | null {
        return this._state.model[this._state.selectedIndex] ?? null;
    }

    /**
     * Optional title shown atop the chooser sheet. A SUBSTITUTION affordance:
     * GTK's popover has no title, but a bare native sheet gives no clue what is
     * being chosen — the same reason `GtkMenuButton` carries `menuTitle`.
     */
    get chooserTitle(): string {
        return this._chooserTitle;
    }

    set chooserTitle(value: string) {
        this._chooserTitle = value ?? '';
    }
}
