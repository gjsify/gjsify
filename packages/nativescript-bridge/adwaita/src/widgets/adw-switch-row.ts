// AdwSwitchRow — a Libadwaita-style switch row for NativeScript.
//
// Extends {@link AdwActionRow} and installs a REAL NativeScript `Switch` in the
// suffix slot. The ACTIVE flag and its notify rule are HEADLESS and live in
// `@gjsify/adwaita-core` (ADR 0004) as `SwitchRowState`, shared with
// `@gjsify/adwaita-web`; this class keeps only the NativeScript render half.
// `notify::active` mirrors the GObject signal name `Adw.SwitchRow` emits.
//
// What routing every path through the shared state fixes: the row is now the
// switch's activator. `adw_switch_row_init` sets the row activatable and points
// the activatable-widget at the slider (adw-switch-row.c:160-162) — "the user can
// control the switch by activating the row or by dragging on the switch handle"
// (C:23-27) — and here only the handle worked. It also makes the notify gate the
// one libadwaita has: a set to the value already held is dropped by the equality
// early-return (C:224-225) BEFORE the slider is written, so it emits nothing.
// Re-emitting `checkedChange` blindly could not express that.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-switch-row` / `_switch_row.scss`.
// Reference: refs/libadwaita/src/adw-switch-row.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_switch.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Switch, type EventData } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';
import { SwitchRowState } from './row-state.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when {@link AdwSwitchRow.active} changes. Mirrors GObject `notify::active`. */
export const NOTIFY_ACTIVE = 'notify::active';

/** Payload of the `notify::active` event. */
export interface NotifyActiveEventData extends EventData {
    /** The new `active` state. */
    active: boolean;
}

export class AdwSwitchRow extends AdwActionRow {
    /** The suffix Switch control. */
    protected readonly _switch: Switch;
    /** The headless active flag + its notify rule (ADR 0004). */
    private readonly _switchState = new SwitchRowState();

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-switch-row';

        const sw = new Switch();
        sw.className = 'adw-switch';
        this.setSuffix(sw);
        this._switch = sw;

        // `adw_switch_row_init` (C:160-162): the row is activatable and the
        // slider is what it activates.
        this.activatableWidget = sw;
        this.activatable = true;

        // NativeScript fires `checkedChange` for a PROGRAMMATIC write as well as
        // for a drag, so this is the single funnel: `setActive` returns false for
        // the write `_apply` itself just made, which is what stops the re-entry.
        sw.addEventListener('checkedChange', () => this._apply(this._switchState.setActive(sw.checked)));
    }

    /** Whether the switch is on. */
    get active(): boolean {
        return this._switchState.active;
    }

    set active(value: boolean | string) {
        this._apply(this._switchState.setActive(xmlBoolean(value, false)));
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
        this._apply(this._switchState.activate());
        super.activate();
    }

    /**
     * Push a state transition out to the Switch and emit `notify::active` — only
     * when something actually changed, which is the `g_object_notify` gate
     * libadwaita puts on the same transition (C:224-225 → :76).
     */
    private _apply(changed: boolean): void {
        if (!changed) return;
        this._switch.checked = this._switchState.active;
        const data: NotifyActiveEventData = {
            eventName: NOTIFY_ACTIVE,
            object: this,
            active: this._switchState.active,
        };
        this.notify(data);
    }
}
