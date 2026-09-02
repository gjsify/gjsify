// AdwToggleGroup — a Libadwaita-style segmented control for NativeScript.
//
// Renders a REAL NativeScript horizontal `StackLayout` of mutually-exclusive
// toggle segments (each a tappable box with an optional `AdwIcon` symbolic + a
// `Label`), styled as Adwaita's LINKED toggle group: a tinted rounded container
// with the selected segment raised to a white pill. Mirrors `Adw.ToggleGroup`:
// `options` (labels) / `setToggles` (label+icon), `selected` index, and a
// `notify::selected` event on change.
//
// The selection STATE MACHINE (the label list, the selected index with the
// bounds + no-op-on-same guard, and the selectedValue mapping) is HEADLESS and
// lives in `@gjsify/adwaita-core` (ADR 0004) as {@link ToggleGroupState}; this
// class composes it and keeps only the NS render half: building the segment views
// (with their per-toggle icons — a render concern the state does not carry),
// raising the active `.active` pill, and the `notify::selected` GObject-style
// signal — all driven by the state object.
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
import { ToggleGroupState } from '@gjsify/adwaita-core';
import { AdwIcon } from './adw-icon.js';
import { xmlNumber } from './xml-values.js';

// Re-export the headless state machine so consumers can reach it from
// `@gjsify/adwaita-nativescript` unchanged.
export { ToggleGroupState } from '@gjsify/adwaita-core';
export type { ToggleGroupStateChange, ToggleGroupStateListener } from '@gjsify/adwaita-core';

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
    /** The headless labels + selected-index state machine (ADR 0004). */
    private readonly _state = new ToggleGroupState();

    constructor() {
        super();

        this.orientation = 'horizontal';
        this.className = 'adw-toggle-group';
        this.horizontalAlignment = 'center';

        // The core state raises the active pill + fires notify::selected on a
        // (guarded) selection change; the segment taps drive it.
        this._state.subscribe((change) => {
            this._applySelection();
            const data: NotifyToggleSelectedEventData = {
                eventName: NOTIFY_SELECTED,
                object: this,
                selected: change.selected,
                value: change.value,
            };
            this.notify(data);
        });
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
                icon.iconName = toggle.icon;
                seg.addChild(icon);
            }

            const label = new Label();
            label.text = toggle.label;
            label.className = 'adw-toggle-label';
            label.verticalAlignment = 'middle';
            seg.addChild(label);

            seg.addEventListener('tap', () => {
                this._state.setSelected(index);
            });

            this.addChild(seg);
            this._segments.push(seg);
        });

        // Sync the state's labels (resets its selection to 0 if now out of range,
        // silently) and re-apply the pill to the rebuilt segments.
        this._state.setLabels(this._toggles.map((t) => t.label));
        this._applySelection();
    }

    /** Mark only the selected segment `.active` (the raised white pill). */
    private _applySelection(): void {
        const selected = this._state.selected;
        this._segments.forEach((seg, i) => {
            seg.className = i === selected ? 'adw-toggle-button active' : 'adw-toggle-button';
        });
    }

    /** The selected segment index. Swaps the active pill + emits `notify::selected`. */
    get active(): number {
        return this._state.selected;
    }

    set active(raw: number | string) {
        const value = xmlNumber(raw, this.active);
        this._state.setSelected(value);
    }

    /** The selected segment's label, or `''` when out of range. */
    get selectedValue(): string {
        return this._state.selectedValue;
    }
}
