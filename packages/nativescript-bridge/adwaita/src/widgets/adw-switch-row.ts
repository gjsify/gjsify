// AdwSwitchRow — a Libadwaita-style switch row for NativeScript.
//
// Extends {@link AdwActionRow} and installs a REAL NativeScript `Switch` in the
// suffix slot. `active` is two-way bound to the Switch's `checked`; flipping the
// Switch emits a `notify::active` event (NativeScript `notify`), mirroring the
// GObject `notify::active` signal naming used by `Adw.SwitchRow` and by
// `@gjsify/adwaita-web`'s `<adw-switch-row>`. This is the live-bound control the
// spike toggles.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-switch-row` / `_switch_row.scss`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_switch.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Switch, type EventData } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';

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

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-switch-row';

        const sw = new Switch();
        sw.className = 'adw-switch';
        this.setSuffix(sw);
        this._switch = sw;

        // Re-emit the Switch's checkedChange as a GObject-style notify::active so
        // consumers subscribe with a single, runtime-agnostic event name.
        sw.addEventListener('checkedChange', () => {
            const data: NotifyActiveEventData = {
                eventName: NOTIFY_ACTIVE,
                object: this,
                active: sw.checked,
            };
            this.notify(data);
        });
    }

    /** Whether the switch is on. Two-way bound to the suffix `Switch.checked`. */
    get active(): boolean {
        return this._switch.checked;
    }

    set active(value: boolean) {
        const next = !!value;
        if (this._switch.checked !== next) {
            this._switch.checked = next;
        }
    }
}
