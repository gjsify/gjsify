// AdwToggleGroup — a Libadwaita-style segmented control for NativeScript.
//
// Renders a REAL NativeScript horizontal `StackLayout` of mutually-exclusive
// toggle segments (each a tappable box with an optional `GtkImage` symbolic + a
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
import { ToggleGroupState, keptToggles, toggleIndexOfName } from '@gjsify/adwaita-core';
import { AdwToggle } from './adw-toggle.js';
import { GtkImage } from './gtk-image.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

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

/**
 * One toggle as {@link AdwToggleGroup.setToggles} takes it: a label, an optional Adwaita
 * symbolic icon, and the `name` `active-name` finds it by. A `.blp` writes an
 * {@link AdwToggle} instead, which the group reads into one of these.
 */
export interface AdwToggleSpec {
    label: string;
    icon?: string;
    name?: string | null;
}

export class AdwToggleGroup extends withSignals(StackLayout) {
    private _toggles: AdwToggleSpec[] = [];
    /**
     * `active` / `active-name` written before the toggle they name exists. GtkBuilder sets
     * a group's properties BEFORE it adds the toggles, so the C holds both back until
     * `parser_finished` (adw-toggle-group.c:1238); NativeScript has no such hook, so each
     * one is applied by the first toggle list it resolves against.
     */
    private _pendingActive: number | null = null;
    private _pendingActiveName: string | null = null;
    private readonly _segments: StackLayout[] = [];
    /** The headless labels + selected-index state machine (ADR 0004). */
    private readonly _state = new ToggleGroupState();

    constructor(props?: ConstructProps<AdwToggleGroup>) {
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

        applyConstructProps(this, props);
    }

    /** The segment labels (icon-less). Setting them rebuilds the toggle group. */
    get options(): string[] {
        return this._toggles.map((t) => t.label);
    }

    set options(value: string[]) {
        this.setToggles((Array.isArray(value) ? value : []).map((label) => ({ label })));
    }

    /** Set the toggles (label + optional symbolic icon). Rebuilds the segments. */
    setToggles(toggles: AdwToggleSpec[]): void {
        this._rebuild(toggles);
        this._applyPending(false);
    }

    private _rebuild(toggles: AdwToggleSpec[]): void {
        for (const seg of this._segments) this.removeChild(seg);
        this._segments.length = 0;
        // A second toggle claiming a name is refused whole, as `add_toggle` refuses it.
        this._toggles = keptToggles(Array.isArray(toggles) ? toggles : []);

        this._toggles.forEach((toggle, index) => {
            const seg = new StackLayout();
            seg.orientation = 'horizontal';
            seg.className = 'adw-toggle-button';
            seg.horizontalAlignment = 'center';

            if (toggle.icon) {
                const icon = new GtkImage();
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

    /**
     * XML inflation: every child is an `Adw.Toggle`, appended in document order as
     * `adw_toggle_group_add` appends it. Anything else is refused, as the C refuses a
     * widget child with a `g_critical` (adw-toggle-group.c:1213) — a view placed here
     * would be a segment nobody asked for.
     */
    _addChildFromBuilder(_name: string, child: object): void {
        if (!(child instanceof AdwToggle)) {
            throw new Error(
                `Adw.ToggleGroup takes only Adw.Toggle children, not \`${(child as object).constructor.name}\`.`,
            );
        }
        const kept = this._toggles.length;
        this._rebuild([...this._toggles, { label: child.label, icon: child.iconName ?? undefined, name: child.name }]);
        if (this._toggles.length === kept) {
            // The C's `g_critical` (adw-toggle-group.c:850): the toggle is not added.
            console.warn(`[AdwToggleGroup] a toggle named '${child.name}' already exists; this one is not added`);
        }
        // The name is KEPT while the builder is still adding toggles: the toggle it names
        // may not be in yet, and the C resolves it only once they all are
        // (`TOGGLE_ACTIVE_NAME_VECTORS`).
        this._applyPending(true);
    }

    /**
     * Apply a held `active` / `active-name` once it resolves, the name after the index as
     * `parser_finished` orders them. `building` keeps the name held for the next toggle;
     * any other change is the end of construction, and a name that still resolves to
     * nothing is dropped as the C drops it (a `g_critical`, :2001).
     */
    private _applyPending(building: boolean): void {
        if (this._pendingActive !== null && this._pendingActive < this._toggles.length) {
            const index = this._pendingActive;
            this._pendingActive = null;
            this._state.setSelected(index);
        }
        if (this._pendingActiveName !== null) {
            const index = toggleIndexOfName(
                this._toggles.map((t) => t.name),
                this._pendingActiveName,
            );
            if (!building) this._pendingActiveName = null;
            if (index !== -1) this._state.setSelected(index);
        }
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
        if (value >= this._toggles.length) {
            this._pendingActive = value;
            return;
        }
        this._state.setSelected(value);
    }

    /**
     * `Adw.ToggleGroup:active-name` — the `name` of the active toggle, or `null`.
     *
     * A name no toggle carries yet is held until one does (see `_pendingActiveName`); a
     * name that never arrives changes nothing, which is the C's `g_critical` and return.
     */
    get activeName(): string | null {
        return this._toggles[this.active]?.name ?? null;
    }

    set activeName(name: string | null) {
        this._pendingActiveName = name;
        this._applyPending(true);
    }

    /** The selected segment's label, or `''` when out of range. */
    get selectedValue(): string {
        return this._state.selectedValue;
    }
}
