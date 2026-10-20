// AdwSwitchRow — a Libadwaita-style switch row for NativeScript.
//
// Extends {@link AdwActionRow} and installs a REAL NativeScript `Switch` in the
// suffix slot. `notify::active` mirrors the GObject signal name `Adw.SwitchRow` emits.
//
// What routing every path through one gate fixes: the row is now the switch's
// activator. `adw_switch_row_init` sets the row activatable and points the
// activatable-widget at the slider (adw-switch-row.c:160-162) — "the user can control
// the switch by activating the row or by dragging on the switch handle" (C:23-27) — and
// here only the handle worked. It also makes the notify gate the one libadwaita has: a
// set to the value already held is dropped by the equality early-return (C:224-225)
// BEFORE the slider is written, so it emits nothing. Re-emitting `checkedChange` blindly
// could not express that.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-switch-row` / `_switch_row.scss`.
// Reference: refs/libadwaita/src/adw-switch-row.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_switch.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
//
// THE FIRST DERIVED REGISTRATION OF THE PORT (ADR 0105 § 2, route D). `withProperties` rather
// than `withSignals`: the base is already a widget of this package, so `connect`, `disconnect`,
// `emit`, `notify` and the layout properties come down from it and already answer this class's
// declaration — they resolve the INSTANCE's whole chain. What is new is the registration itself,
// a GType over `AdwActionRow`'s GType over the foreign `GridLayout`. node-gi used to stop its
// parent walk at the plain NativeScript class between the two registrations; it now steps over
// one, which is a GJS-parity fix and not a host-gated one.
//
// So `SwitchRowState` is gone from here: a flag plus a notify gate is exactly what the declared
// property is, and holding it twice would mean two stores and one of them stale. The class stays
// in `@gjsify/adwaita-core` for `@gjsify/adwaita-web` and the conformance vectors.

import { Switch } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';
import { switchClassName } from './row-state.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withProperties } from './signals.js';

/**
 * Event name emitted when {@link AdwSwitchRow.active} changes. Mirrors GObject `notify::active`,
 * and like every declared member it is subscribed with `connect` alone (see `signals.ts`).
 *
 * There is no payload TYPE to go with it: a real `notify::` carries a `GParamSpec`, not the
 * value, and the seam hands a handler the port's plain `{ eventName, object }` on both legs.
 * Read the state off the emitter — `(self) => self.active`.
 */
export const NOTIFY_ACTIVE = 'notify::active';

export class AdwSwitchRow extends withProperties(AdwActionRow, {
    GTypeName: 'AdwSwitchRow',
    Properties: {
        active: { kind: 'boolean', default: false, blurb: 'Whether the switch row is in its "on" or "off" position' },
    },
}) {
    static readonly GTypeName: string = 'AdwSwitchRow';

    /** Whether the switch is on. */
    declare active: boolean;

    /** The suffix Switch control. */
    protected readonly _switch: Switch;

    constructor(props?: ConstructProps<AdwSwitchRow>) {
        super();

        this.className = 'adw-row adw-action-row adw-switch-row';

        const sw = new Switch();
        sw.className = switchClassName(false);
        this.add_suffix(sw);
        this._switch = sw;

        // `adw_switch_row_init` (C:160-162): the row is activatable and the
        // slider is what it activates.
        this.activatableWidget = sw;
        this.activatable = true;

        // NativeScript fires `checkedChange` for a PROGRAMMATIC write as well as for a drag, so
        // this is the single funnel INTO the property — and the property's own equal-write rule
        // is what stops the re-entry, where the twin needed `setActive`'s return value for it.
        sw.addEventListener('checkedChange', () => {
            this.active = sw.checked;
        });

        // …and `notify::active` is the single funnel OUT. The handler reads the emitter, so it
        // works unchanged when node-gi owns the property and hands the instance back itself.
        this.connect(NOTIFY_ACTIVE, (self) => self._apply());

        applyConstructProps(this, props);
    }

    get_active(): boolean {
        return this.active;
    }

    set_active(active: boolean): void {
        this.active = active;
    }

    /**
     * The row was tapped — invert the state, then emit `activated` like any
     * other action row (adw-switch-row.c:23-27 via the activatable widget).
     *
     * UNVERIFIED OFF-DEVICE: this assumes a tap that lands on the `Switch`
     * itself is consumed by it and does NOT also reach the row's tap gesture. If
     * a platform were to bubble it, the handle would toggle twice. Both Android
     * (a clickable native widget consumes the touch) and iOS (a `UISwitch` claims
     * the gesture) are expected to consume it, but only a device run can confirm
     * that — `row-press.ts` reasons about the same propagation for its highlight.
     */
    override activate(): void {
        if (!this.activatable) return;
        this.active = !this.active;
        super.activate();
    }

    /** Push the state out to the `Switch`. Run from `notify::active`, which is already the gate. */
    private _apply(): void {
        this._switch.checked = this.active;
        this._switch.className = switchClassName(this.active);
    }
}
