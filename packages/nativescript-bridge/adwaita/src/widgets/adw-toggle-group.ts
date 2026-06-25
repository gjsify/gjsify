// AdwToggleGroup — a Libadwaita-style segmented control for NativeScript.
//
// Extends the REAL NativeScript `SegmentedBar`: a horizontal set of mutually-
// exclusive segments. Mirrors `Adw.ToggleGroup`: `options` (labels), `selected`
// index, and a `notify::selected` event on change.
//
// FIDELITY: approximated. `SegmentedBar` is the closest native primitive to
// `Adw.ToggleGroup`'s linked toggle set; it is mutually-exclusive and styled by
// the platform's segmented-control look (tinted by the `adw-toggle-group` accent),
// not pixel-identical to libadwaita's `.linked` button group. Icons are not
// supported (SegmentedBarItem is title-only) — labels only.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toggle-group`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { SegmentedBar, SegmentedBarItem, type EventData } from '@nativescript/core';

/** Event name emitted when {@link AdwToggleGroup.selected} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Payload of the `notify::selected` event. */
export interface NotifyToggleSelectedEventData extends EventData {
    /** The newly-selected segment index. */
    selected: number;
    /** The newly-selected segment's label. */
    value: string;
}

export class AdwToggleGroup extends SegmentedBar {
    private _options: string[] = [];

    constructor() {
        super();

        this.className = 'adw-toggle-group';

        // Re-emit the SegmentedBar's selectedIndexChanged as a GObject-style
        // notify::selected so consumers use one runtime-agnostic event name.
        this.addEventListener('selectedIndexChanged', () => {
            const data: NotifyToggleSelectedEventData = {
                eventName: NOTIFY_SELECTED,
                object: this,
                selected: this.selectedIndex,
                value: this._options[this.selectedIndex] ?? '',
            };
            this.notify(data);
        });
    }

    /** The segment labels. Setting them rebuilds the segmented bar items. */
    get options(): string[] {
        return this._options;
    }

    set options(value: string[]) {
        this._options = Array.isArray(value) ? value : [];
        this.items = this._options.map((label) => {
            const item = new SegmentedBarItem();
            item.title = label;
            return item;
        });
    }

    /** The selected segment index. Two-way bound to `SegmentedBar.selectedIndex`. */
    get selected(): number {
        return this.selectedIndex;
    }

    set selected(value: number) {
        const next = Number.isFinite(value) ? value : 0;
        if (next !== this.selectedIndex) {
            this.selectedIndex = next;
        }
    }

    /** The selected segment's label, or `''` when out of range. */
    get selectedValue(): string {
        return this._options[this.selectedIndex] ?? '';
    }
}
