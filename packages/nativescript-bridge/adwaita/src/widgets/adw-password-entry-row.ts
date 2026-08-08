// AdwPasswordEntryRow — a Libadwaita-style password entry row for NativeScript.
//
// Extends {@link AdwEntryRow} and adds exactly what the C subclass adds
// (adw-password-entry-row.c): a masked field, a trailing peek toggle that swaps
// between the reveal / conceal symbolics, and the Caps Lock warning.
//
// The reveal/caps-lock DERIVATION is HEADLESS and lives in
// `@gjsify/adwaita-core` (ADR 0004) as {@link PasswordEntryRowState}, which
// COMPOSES the parent row's state exactly like the C drives its parent through
// the private `adw_entry_row_set_show_indicator` hook. Two rules fall out of it
// that this port did not have: peeking suppresses the caps-lock warning
// (C:57-59), and so does losing focus (adw-entry-row.c:151). The icon/label swap
// used to be written out THREE times in this file alone; it is now one lookup in
// the core, painted by `entry-row-view.ts`.
//
// Also fixed here: the peek toggle is installed through {@link AdwEntryRow.addSuffix}
// rather than the single-slot `setSuffix`, so a consumer suffix no longer
// detaches it — which used to leave `_peekButton` pointing at a view that was no
// longer in the tree, so the row could never be revealed again.
//
// COMPROMISE: NativeScript exposes no keyboard modifier state, so nothing on
// this port can OBSERVE Caps Lock. {@link setCapsLockOn} is the seam a host with
// that knowledge drives; without it the indicator simply never shows, which is
// the same outcome as before minus the missing suppression rules.
//
// Reference: refs/libadwaita/src/adw-password-entry-row.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { EventData } from '@nativescript/core';
import { dialogWarningSymbolic } from '@gjsify/adwaita-icons/status';
import { PasswordEntryRowState, type PasswordEntryRowRenderState } from '@gjsify/adwaita-core';

import { AdwEntryRow } from './adw-entry-row.js';
import { AdwImageButton } from './adw-image-button.js';
import { NS_PASSWORD_ENTRY_ROW_CLASS, applyPasswordEntryRowState } from './entry-row-view.js';

// Re-exported so consumers reach the headless state machine from
// `@gjsify/adwaita-nativescript` without a second import path.
export { PasswordEntryRowState } from '@gjsify/adwaita-core';
export type { PasswordEntryRowRenderState } from '@gjsify/adwaita-core';

/** Event name emitted when the peek state flips. Mirrors a GObject `notify::`. */
export const NOTIFY_REVEALED = 'notify::revealed';

/** Payload of the `notify::revealed` event. */
export interface NotifyRevealedEventData extends EventData {
    /** Whether the contents are now shown in clear text. */
    revealed: boolean;
}

export class AdwPasswordEntryRow extends AdwEntryRow {
    /** The headless peek + caps-lock derivation, composing the parent row's state. */
    private readonly _password = new PasswordEntryRowState(this._state);
    /** The trailing peek (reveal/conceal) toggle button. */
    protected readonly _peekButton: AdwImageButton;

    constructor() {
        super();

        this._field.className = 'adw-entry-field adw-password-field';

        const peek = new AdwImageButton();
        peek.className = `${peek.className} adw-password-peek`.trim();
        peek.addEventListener('tap', () => this._password.togglePeek());
        // C:152 — installed through add_suffix, so it is the first SUFFIX and a
        // consumer's own suffix lands after it instead of replacing it. The icon
        // itself comes from the render below, never from a second local copy of
        // the reveal/conceal mapping.
        this.addSuffix(peek);
        this._peekButton = peek;

        // The indicator icon is set once at init (C:169-171). `caps-lock-symbolic`
        // is not in the vendored icon theme, so the warning symbolic stands in —
        // the CANONICAL name still travels through the core's render state, so
        // both ports agree on what this slot means.
        this.setIndicatorIcon(dialogWarningSymbolic);

        this._renderPassword(this._password.state);
        this._password.subscribe((state) => {
            this._renderPassword(state);
            const data: NotifyRevealedEventData = {
                eventName: NOTIFY_REVEALED,
                object: this,
                revealed: state.revealed,
            };
            this.notify(data);
        });
    }

    /** Whether the contents are shown in clear text (`GtkText:visibility`). */
    get revealed(): boolean {
        return this._password.revealed;
    }

    set revealed(value: boolean) {
        this._password.setRevealed(value);
    }

    /**
     * Legacy spelling of {@link revealed}. The web port called it `revealed`, this
     * one called it `peeking`, and neither name is in the C — kept so existing
     * NativeScript callers keep working while `revealed` is the shared name.
     */
    get peeking(): boolean {
        return this._password.revealed;
    }

    set peeking(value: boolean) {
        this._password.setRevealed(value);
    }

    /** Flip masked↔revealed — `show_text_clicked_cb` (C:90-97). */
    togglePeek(): boolean {
        return this._password.togglePeek();
    }

    /** Whether Caps Lock is engaged, as last reported by the host. */
    get capsLockOn(): boolean {
        return this._password.capsLockOn;
    }

    /**
     * Feed the platform's Caps Lock state in — GDK reads it off the keyboard
     * device (C:111-115). NativeScript surfaces no equivalent, so this is the
     * host's seam.
     */
    setCapsLockOn(on: boolean): void {
        this._password.setCapsLockOn(on);
    }

    protected override get _baseClassName(): string {
        return NS_PASSWORD_ENTRY_ROW_CLASS;
    }

    /** `notify_visibility_cb` (C:62-81), applied to the NS views. */
    private _renderPassword(state: PasswordEntryRowRenderState): void {
        applyPasswordEntryRowState({ field: this._field, peekButton: this._peekButton }, state);
    }
}
