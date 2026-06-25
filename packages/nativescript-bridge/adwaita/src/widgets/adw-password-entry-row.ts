// AdwPasswordEntryRow — a Libadwaita-style password entry row for NativeScript.
//
// Extends {@link AdwEntryRow} and flips the suffix `TextField` into `secure` mode
// so the value is masked, mirroring `Adw.PasswordEntryRow`. Inherits `text` /
// `notify::text` from {@link AdwEntryRow} unchanged.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwEntryRow } from './adw-entry-row.js';

export class AdwPasswordEntryRow extends AdwEntryRow {
    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-entry-row adw-password-entry-row';
        this._field.className = 'adw-entry-field adw-password-field';
        this._field.secure = true;
    }
}
