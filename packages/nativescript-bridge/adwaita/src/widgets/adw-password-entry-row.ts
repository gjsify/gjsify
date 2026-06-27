// AdwPasswordEntryRow — a Libadwaita-style password entry row for NativeScript.
//
// Extends {@link AdwEntryRow} and flips the `TextField` into `secure` mode so the
// value is masked, plus a trailing PEEK toggle (an `AdwImageButton` with the
// view-reveal / view-conceal symbolic) that shows/hides the value — mirroring
// `Adw.PasswordEntryRow`'s eye button. Inherits `text` / `notify::text` from
// {@link AdwEntryRow} unchanged.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { viewConcealSymbolic, viewRevealSymbolic } from '@gjsify/adwaita-icons/actions';
import { AdwEntryRow } from './adw-entry-row.js';
import { AdwImageButton } from './adw-image-button.js';

export class AdwPasswordEntryRow extends AdwEntryRow {
    /** The trailing peek (reveal/conceal) toggle button. */
    protected readonly _peekButton: AdwImageButton;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-entry-row adw-password-entry-row';
        this._field.className = 'adw-entry-field adw-password-field';
        this._field.secure = true;

        // Trailing eye button — tap reveals/conceals the masked value, like
        // Adw.PasswordEntryRow. Shows the view-reveal eye while masked, the
        // view-conceal eye-slash while revealed.
        const peek = new AdwImageButton();
        peek.className = `${peek.className} adw-password-peek`.trim();
        peek.icon = viewRevealSymbolic;
        peek.addEventListener('tap', () => this._togglePeek());
        this.setSuffix(peek);
        this._peekButton = peek;
    }

    /** Toggle the masked/revealed state + swap the eye icon. */
    private _togglePeek(): void {
        this._field.secure = !this._field.secure;
        this._peekButton.icon = this._field.secure ? viewRevealSymbolic : viewConcealSymbolic;
    }

    /** Whether the password is currently revealed (the value is shown). */
    get peeking(): boolean {
        return !this._field.secure;
    }

    set peeking(value: boolean) {
        const reveal = !!value;
        if (reveal === this.peeking) return;
        this._field.secure = !reveal;
        this._peekButton.icon = this._field.secure ? viewRevealSymbolic : viewConcealSymbolic;
    }
}
