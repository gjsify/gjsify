// AdwExpanderRow — a Libadwaita-style expander row for NativeScript.
//
// Extends {@link AdwActionRow}: the inherited title/subtitle stack is the always-
// visible header, a `[+]/[−]` disclosure `Button` sits in the suffix slot, and a
// second grid row (spanning both columns) holds a `StackLayout` of child rows that
// is revealed/collapsed by toggling its `visibility`. Mirrors `Adw.ExpanderRow`:
// `addRow(child)` appends to the disclosure, `expanded` get/set drives the reveal
// and emits `notify::expanded`.
//
// NOTE on animation: the NativeScript CSS subset used by this package has no
// `transform` / height-transition support, so the reveal is an instant
// `visibility` toggle rather than the animated slide `Adw.ExpanderRow` performs.
// (A real NS app could animate via `view.animate({...})` in code, but that lives
// outside the CSS-subset contract this widget set keeps.)
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_row.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_expanders.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, StackLayout, View, type EventData } from '@nativescript/core';
import { panDownSymbolic, panUpSymbolic } from '@gjsify/adwaita-icons/ui';
import { AdwActionRow } from './adw-action-row.js';
import { AdwIcon } from './adw-icon.js';

/** Event name emitted when {@link AdwExpanderRow.expanded} changes. Mirrors GObject `notify::expanded`. */
export const NOTIFY_EXPANDED = 'notify::expanded';

/** Payload of the `notify::expanded` event. */
export interface NotifyExpandedEventData extends EventData {
    /** The new expanded state. */
    expanded: boolean;
}

export class AdwExpanderRow extends AdwActionRow {
    /** The disclosure chevron (suffix) — a plain symbolic icon, like Adw.ExpanderRow. */
    protected readonly _toggle: AdwIcon;
    /** The container of revealed child rows (second grid row). */
    protected readonly _disclosure: StackLayout;
    private _expanded = false;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-expander-row';

        // Second grid row holds the disclosure box across both columns.
        this.addRow(new ItemSpec(1, 'auto'));

        const disclosure = new StackLayout();
        disclosure.orientation = 'vertical';
        disclosure.className = 'adw-expander-disclosure';
        disclosure.visibility = 'collapse';
        GridLayout.setRow(disclosure, 1);
        GridLayout.setColumn(disclosure, 0);
        GridLayout.setColumnSpan(disclosure, 3);
        this.addChild(disclosure);
        this._disclosure = disclosure;

        // Adwaita expanders use a plain chevron affordance (pan-down = collapsed,
        // pan-up = expanded) — a REAL symbolic icon, not a `▾` glyph or a button.
        const toggle = new AdwIcon();
        toggle.icon = panDownSymbolic;
        toggle.className = `${toggle.className} adw-expander-toggle`.trim();
        this.setSuffix(toggle);
        this._toggle = toggle;

        toggle.addEventListener('tap', () => {
            this.expanded = !this._expanded;
        });
    }

    /** Append a child row (or any view) to the disclosure container. */
    addRow(viewOrSpec: View | ItemSpec): void {
        // GridLayout.addRow takes an ItemSpec; AdwExpanderRow.addRow takes a child
        // view (Adw semantics). Disambiguate so the constructor's grid-row setup
        // (which calls the GridLayout signature) still works.
        if (viewOrSpec instanceof ItemSpec) {
            super.addRow(viewOrSpec);
            return;
        }
        this._disclosure.addChild(viewOrSpec);
    }

    /** Remove a previously-added child row from the disclosure container. */
    removeRow(view: View): void {
        this._disclosure.removeChild(view);
    }

    /** Whether the disclosure is revealed. */
    get expanded(): boolean {
        return this._expanded;
    }

    set expanded(value: boolean) {
        const next = !!value;
        if (next === this._expanded) return;
        this._expanded = next;
        this._disclosure.visibility = next ? 'visible' : 'collapse';
        this._toggle.icon = next ? panUpSymbolic : panDownSymbolic;
        const data: NotifyExpandedEventData = {
            eventName: NOTIFY_EXPANDED,
            object: this,
            expanded: next,
        };
        this.notify(data);
    }
}
