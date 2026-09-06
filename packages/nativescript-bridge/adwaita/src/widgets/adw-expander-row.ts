// AdwExpanderRow — a Libadwaita-style expander row for NativeScript.
//
// Extends {@link AdwActionRow}: the inherited title/subtitle stack is the always-
// visible header, a chevron sits in the suffix slot, and a second grid row
// (spanning both columns) holds a `StackLayout` of child rows that is
// revealed/collapsed by toggling its `visibility`. Mirrors `Adw.ExpanderRow`:
// `addRow(child)` appends to the disclosure, `expanded` get/set drives the reveal
// and emits `notify::expanded`. Tapping the HEADER toggles it — see the
// constructor for which views carry that and the device measurement behind it.
//
// The disclosure STATE MACHINE (the expanded/collapsed toggle + notify-on-change)
// is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link ExpanderState};
// this class composes it and keeps only the NS render half: the `GridLayout`
// disclosure box + chevron `GtkImage` + the `notify::expanded` GObject-style signal,
// all driven by the state object.
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

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, StackLayout, type EventData } from '@nativescript/core';
import { panDownSymbolic, panUpSymbolic } from '@gjsify/adwaita-icons/ui';
import { ExpanderState } from '@gjsify/adwaita-core';
import { AdwActionRow } from './adw-action-row.js';
import { GtkImage } from './gtk-image.js';
import { resolveBuilderSlot } from './builder-slots.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

// Re-export the headless state machine so consumers can reach it from
// `@gjsify/adwaita-nativescript` unchanged.
export { ExpanderState } from '@gjsify/adwaita-core';
export type { ExpanderStateListener } from '@gjsify/adwaita-core';

/** Event name emitted when {@link AdwExpanderRow.expanded} changes. Mirrors GObject `notify::expanded`. */
export const NOTIFY_EXPANDED = 'notify::expanded';

/** Payload of the `notify::expanded` event. */
export interface NotifyExpandedEventData extends EventData {
    /** The new expanded state. */
    expanded: boolean;
}

/** What an XML child of an expander row can ask for; anything else is a disclosure row. */
const EXPANDER_ROW_SLOTS = ['prefix', 'suffix'] as const;

export class AdwExpanderRow extends AdwActionRow {
    /** `AdwExpanderRow` derives from `AdwPreferencesRow` in C
     *  (adw-expander-row.c:72), so the search does not consult a subtitle here. */
    override readonly isActionRow: boolean = false;

    /** The disclosure chevron (suffix) — a plain symbolic icon, like Adw.ExpanderRow. */
    protected readonly _toggle: GtkImage;
    /** The container of revealed child rows (second grid row). */
    protected readonly _disclosure: StackLayout;
    /** The headless expanded/collapsed disclosure state machine (ADR 0004). */
    private readonly _state = new ExpanderState();

    constructor(props?: ConstructProps<AdwExpanderRow>) {
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
        const toggle = new GtkImage();
        toggle.iconName = panDownSymbolic;
        toggle.className = `${toggle.className} adw-expander-toggle`.trim();
        this.setSuffix(toggle);
        this._toggle = toggle;

        // The core state drives the reveal + chevron + notify.
        this._state.subscribe((expanded) => {
            this._disclosure.visibility = expanded ? 'visible' : 'collapse';
            this._toggle.iconName = expanded ? panUpSymbolic : panDownSymbolic;
            const data: NotifyExpandedEventData = {
                eventName: NOTIFY_EXPANDED,
                object: this,
                expanded,
            };
            this.notify(data);
        });

        // WHAT TOGGLES THE ROW, and why it is wired exactly here (#1155).
        //
        // libadwaita expands from the HEADER, and says why in the template:
        // "The header row must be activatable to toggle expansion by clicking it"
        // (adw-expander-row.ui:24-26 → activate_cb → adw-expander-row.c:94-98). It
        // sets `activatable=False` on the expander itself and True on the inner
        // header, so the REVEALED rows cannot toggle their own parent.
        //
        // This port has no inner header widget — it IS an AdwActionRow — so the
        // targets are the header's own children: the title/subtitle stack, which
        // fills the flexible column and therefore most of the header, plus the
        // chevron. Both sit in grid row 0; the disclosure is row 1.
        //
        // MEASURED ON DEVICE, because the answer decides the shape and no
        // off-device spec can reach it (`extends GridLayout` cannot be imported):
        // a NativeScript `tap` does NOT stop at a child that handles it. A tap on a
        // plain Label inside the disclosure fires its own listener AND the row's;
        // so does a tap on a nested switch row. (A nested entry row fires neither —
        // the native EditText consumes it.) So the tempting version, toggling from
        // the row's own `tap` or from `activate()`, would collapse the row whenever
        // a user touched anything inside it.
        //
        // For the same reason the chevron's listener is the ONLY one on the chevron:
        // if the row itself also toggled, a chevron tap would toggle twice and read
        // as dead. Siblings do not receive each other's taps, which is what makes
        // two header-scoped listeners safe.
        //
        // The affordance was previously the chevron alone — a 16-unit square, on the
        // port whose targets are fingers.
        const toggleOnTap = () => {
            this._state.toggle();
        };
        this._textStack.addEventListener('tap', toggleOnTap);
        toggle.addEventListener('tap', toggleOnTap);

        applyConstructProps(this, props);
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

    /**
     * Remove a previously-added child row from the disclosure container.
     *
     * Takes `View | ItemSpec` for the same reason `addRow` does: `GridLayout` already
     * declares `removeRow(itemSpec: ItemSpec)`, so accepting only a `View` NARROWS an
     * inherited signature. That is a type error for anyone compiling against the real
     * `@nativescript/core`, and it left the base's own track teardown unreachable
     * through this name.
     */
    removeRow(viewOrSpec: View | ItemSpec): void {
        if (viewOrSpec instanceof ItemSpec) {
            super.removeRow(viewOrSpec);
            return;
        }
        this._disclosure.removeChild(viewOrSpec);
    }

    /**
     * An XML child is a ROW inside the disclosure — the one placement an expander row
     * adds over its base, and the reason this overrides `AdwActionRow`'s prefix/suffix
     * rule rather than inheriting it. The two edges stay reachable by name.
     */
    _addChildFromBuilder(name: string, view: View): void {
        const slot = resolveBuilderSlot(name, EXPANDER_ROW_SLOTS, 'row');
        if (slot === 'row') this.addRow(view);
        else super._addChildFromBuilder(slot, view);
    }

    /**
     * The rows inside the disclosure, in order — the read-back for `addRow`.
     *
     * NOT `rows`, which is what it was called first. `GridLayoutBase` declares `rows`
     * as a SETTER-ONLY accessor (its getter is `rowsInternal`), so a getter of that
     * name on a subclass shadows it: `expanderRow.rows = 'auto,*'` then throws
     * `TypeError: Cannot set property rows … which has only a getter` in strict mode,
     * which every NativeScript bundle is. Measured against that prototype shape, and
     * it would have broken apps that never touch XML. `rows` and `columns` are the
     * only two accessors of that shape on the bases this package extends —
     * `scripts/check-nativescript-xml-doors.mjs` holds both (in `SETTER_ONLY_ON_BASE`,
     * `scripts/nativescript-xml-doors.mjs:116`).
     */
    get disclosureRows(): readonly View[] {
        const out: View[] = [];
        for (let i = 0; i < this._disclosure.getChildrenCount(); i++) out.push(this._disclosure.getChildAt(i));
        return out;
    }

    /** Whether the disclosure is revealed. */
    get expanded(): boolean {
        return this._state.expanded;
    }

    set expanded(value: boolean | string) {
        this._state.setExpanded(xmlBoolean(value, false));
    }
}
