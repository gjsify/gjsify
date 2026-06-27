// AdwToggleGroup — a Libadwaita-style segmented control for NativeScript.
//
// Renders a REAL NativeScript horizontal `StackLayout` of mutually-exclusive
// toggle segments (each a tappable box with an optional `AdwIcon` symbolic + a
// `Label`), styled as Adwaita's LINKED toggle group: a tinted rounded container
// with the selected segment raised to a white pill. Mirrors `Adw.ToggleGroup`:
// `options` (labels) / `setToggles` (label+icon), `selected` index, and a
// `notify::selected` event on change.
//
// This replaces the earlier native `SegmentedBar` (a Material-styled segmented
// control that read as Android, not Adwaita, and could not carry the per-toggle
// icons the GTK/browser twins show). Pages-vs-toggle selection logic mirrors the
// shared `AdwViewSwitcherBase` button bar.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toggle-group`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, type EventData } from '@nativescript/core';
import { AdwIcon } from './adw-icon.js';

/** Event name emitted when {@link AdwToggleGroup.selected} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Payload of the `notify::selected` event. */
export interface NotifyToggleSelectedEventData extends EventData {
    /** The newly-selected segment index. */
    selected: number;
    /** The newly-selected segment's label. */
    value: string;
}

/** One toggle: a label and an optional Adwaita symbolic SVG icon. */
export interface AdwToggle {
    label: string;
    icon?: string;
}

export class AdwToggleGroup extends StackLayout {
    private _toggles: AdwToggle[] = [];
    private readonly _segments: StackLayout[] = [];
    private _selected = 0;

    constructor() {
        super();

        this.orientation = 'horizontal';
        this.className = 'adw-toggle-group';
        this.horizontalAlignment = 'center';
    }

    /** The segment labels (icon-less). Setting them rebuilds the toggle group. */
    get options(): string[] {
        return this._toggles.map((t) => t.label);
    }

    set options(value: string[]) {
        this.setToggles((Array.isArray(value) ? value : []).map((label) => ({ label })));
    }

    /** Set the toggles (label + optional symbolic icon). Rebuilds the segments. */
    setToggles(toggles: AdwToggle[]): void {
        for (const seg of this._segments) this.removeChild(seg);
        this._segments.length = 0;
        this._toggles = Array.isArray(toggles) ? toggles : [];

        this._toggles.forEach((toggle, index) => {
            const seg = new StackLayout();
            seg.orientation = 'horizontal';
            seg.className = 'adw-toggle-button';
            seg.horizontalAlignment = 'center';

            if (toggle.icon) {
                const icon = new AdwIcon();
                icon.className = `${icon.className} adw-toggle-icon`.trim();
                icon.verticalAlignment = 'middle';
                icon.icon = toggle.icon;
                seg.addChild(icon);
            }

            const label = new Label();
            label.text = toggle.label;
            label.className = 'adw-toggle-label';
            label.verticalAlignment = 'middle';
            seg.addChild(label);

            seg.addEventListener('tap', () => {
                this.selected = index;
            });

            this.addChild(seg);
            this._segments.push(seg);
        });

        if (this._selected >= this._toggles.length) this._selected = 0;
        this._applySelection();
    }

    /** Mark only the selected segment `.active` (the raised white pill). */
    private _applySelection(): void {
        this._segments.forEach((seg, i) => {
            seg.className = i === this._selected ? 'adw-toggle-button active' : 'adw-toggle-button';
        });
    }

    /** The selected segment index. Swaps the active pill + emits `notify::selected`. */
    get selected(): number {
        return this._selected;
    }

    set selected(value: number) {
        const next = Number.isFinite(value) ? value : 0;
        if (next === this._selected || next < 0 || next >= this._toggles.length) return;
        this._selected = next;
        this._applySelection();
        const data: NotifyToggleSelectedEventData = {
            eventName: NOTIFY_SELECTED,
            object: this,
            selected: next,
            value: this._toggles[next]?.label ?? '',
        };
        this.notify(data);
    }

    /** The selected segment's label, or `''` when out of range. */
    get selectedValue(): string {
        return this._toggles[this._selected]?.label ?? '';
    }
}
