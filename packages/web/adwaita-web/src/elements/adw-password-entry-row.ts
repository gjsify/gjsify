// <adw-password-entry-row> — An entry row tailored for secrets: the value is
// masked, a trailing peek button reveals it, and a warning shows while Caps Lock
// is engaged.
//
// EXTENDS `<adw-entry-row>`, as `AdwPasswordEntryRow` extends `AdwEntryRow` in the C, so
// only what the subclass adds lives here: the masked input, the peek toggle and the
// caps-lock source.
//
// The reveal/caps-lock DERIVATION is HEADLESS and lives in `@gjsify/adwaita-core`
// (ADR 0004) as {@link PasswordEntryRowState}, which composes the parent's
// `EntryRowState` the way the C drives its parent through
// `adw_entry_row_set_show_indicator`. Two rules fall out of it: peeking suppresses the
// caps-lock warning, and so does losing focus.
//
// `notify::revealed` fires only on a REAL change. That needs the core's setter guard,
// because `attributeChangedCallback` also runs for a same-value write.
//
// Reference: refs/libadwaita/src/adw-password-entry-row.c
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/passwordentryrow.md
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { PasswordEntryRowState, type PasswordEntryRowRenderState } from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './gtk-image.js';

import { AdwEntryRow } from './adw-entry-row.js';

export class AdwPasswordEntryRow extends AdwEntryRow {
    /** The headless peek + caps-lock derivation, composing the parent row's state. */
    private readonly _password = new PasswordEntryRowState(this._state);
    private _toggle!: HTMLButtonElement;
    private _toggleIcon!: GtkImage;

    static get observedAttributes(): string[] {
        return [...AdwEntryRow.observedAttributes, 'revealed'];
    }

    // `_password_entry_row.scss` scopes its rules to `.adw-password-entry-row-*`,
    // so the inherited DOM builder must name the parts that way.
    protected override get _classPrefix(): string {
        return 'adw-password-entry-row';
    }

    /** Whether the contents are shown in clear text (`GtkText:visibility`). */
    get revealed(): boolean {
        return this._password.revealed;
    }

    set revealed(value: boolean) {
        this._password.setRevealed(value);
    }

    /** Whether Caps Lock is engaged, as last observed from a keyboard event. */
    get capsLockOn(): boolean {
        return this._password.capsLockOn;
    }

    /**
     * Feed the platform's Caps Lock state in — GDK gets it from the keyboard device.
     * Public so a host that knows better than `KeyboardEvent.getModifierState` (a virtual
     * keyboard, a test) can drive it directly.
     */
    setCapsLockOn(on: boolean): void {
        this._password.setCapsLockOn(on);
    }

    protected override _onConnected(): void {
        // C's `gtk_text_set_visibility (…, FALSE)` + GTK_INPUT_PURPOSE_PASSWORD.
        this._input.type = 'password';
        this._input.autocomplete = 'off';

        this._toggle = document.createElement('button');
        this._toggle.type = 'button';
        this._toggle.className = `adw-button flat circular icon-only ${this._classPrefix}-toggle`;
        this._toggleIcon = createGtkImage(null);
        this._toggle.append(this._toggleIcon);
        this._toggle.addEventListener('click', () => this._password.togglePeek());
        // Installed through add_suffix as C does, so it is the FIRST suffix and a
        // consumer's own suffix lands after it instead of replacing it.
        this.addSuffix(this._toggle);

        // GDK reads caps lock off the keyboard device; the browser exposes it
        // only on keyboard events, so those are the source here.
        const readCapsLock = (event: KeyboardEvent) => this._password.setCapsLockOn(event.getModifierState('CapsLock'));
        this._input.addEventListener('keydown', readCapsLock);
        this._input.addEventListener('keyup', readCapsLock);

        // The indicator icon + tooltip are set once at init, as in C; their canonical names
        // come from the core so both ports spell them alike.
        const initial = this._password.state;
        this.setIndicatorIconName(initial.indicatorIconName);
        this.setIndicatorTooltip(initial.indicatorTooltip);

        // Seed from the attribute BEFORE subscribing, so the first paint emits no
        // `notify::revealed`.
        if (this.hasAttribute('revealed')) this._password.setRevealed(this.getAttribute('revealed') !== 'false');
        this._renderPassword(this._password.state);
        this._password.subscribe((state) => {
            this._renderPassword(state);
            this.dispatchEvent(
                new CustomEvent('notify::revealed', { bubbles: true, detail: { revealed: state.revealed } }),
            );
        });
    }

    override attributeChangedCallback(name: string, oldValue: string | null, value: string | null) {
        if (name !== 'revealed') {
            super.attributeChangedCallback(name, oldValue, value);
            return;
        }
        if (!this._initialized) return;
        // The core guard makes this idempotent, which is what keeps the reflection
        // in `_renderPassword` from bouncing back as a second notification.
        this._password.setRevealed(value !== null && value !== 'false');
    }

    /** `notify_visibility_cb`, applied to the DOM. */
    private _renderPassword(state: PasswordEntryRowRenderState): void {
        this._input.type = state.revealed ? 'text' : 'password';
        // The libadwaita name travels in `data-icon-name`; the mask class is the
        // curated @gjsify/adwaita-icons spelling of the same symbolic.
        this._toggleIcon.dataset.iconName = state.peekIconName;
        this._toggleIcon.iconName = state.peekIconName;
        this._toggle.title = state.peekLabel;
        this._toggle.setAttribute('aria-label', state.peekLabel);
        this._toggle.setAttribute('aria-pressed', String(state.revealed));
        if (state.revealed) this.setAttribute('revealed', '');
        else this.removeAttribute('revealed');
    }
}

customElements.define('adw-password-entry-row', AdwPasswordEntryRow);
