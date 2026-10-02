// <gtk-password-entry> — a field for a secret: masked by default, no copy, a Caps Lock
// warning, and optionally a button that reveals it for one look.
//
// `Gtk.PasswordEntry` does NOT derive from `Gtk.Entry` — it is a sibling that implements
// `GtkEditable` itself, which is why this header cannot say "it IS an entry". It EXTENDS
// `<gtk-entry>` here all the same, because what a browser has is an `<input>` and
// `GtkEntry` is the one module that owns one; what this element adds is the masked
// default, the peek button and the Caps Lock indicator, all of which C builds around its
// own inner `Gtk.Text` for the same reason.
//
// THE REVEAL + CAPS-LOCK DERIVATION IS HEADLESS and already exists:
// `PasswordEntryRowState` in `@gjsify/adwaita-core` is libadwaita's `notify_visibility_cb`
// truth table, composed with an `EntryRowState` so `editing && show_indicator` — the
// warning's own focus condition, which `adw_entry_row_set_show_indicator` reaches through a
// private hook — is derived in one place (ADR 0004). `Adw.PasswordEntryRow` and
// `Gtk.PasswordEntry` are those same two rules over the same four inputs, so this element
// composes that state rather than writing a second copy of it.
//
// WHAT THE BROWSER CANNOT DO, and what it does instead:
//   · `caps-lock-symbolic` is in neither the Adwaita icon theme nor `@gjsify/adwaita-icons`,
//     so the indicator is the TEXT glyph `⇪` with the canonical name in `data-icon-name` —
//     the substitution `<adw-password-entry-row>` already makes
//     (status/adwaita-web-icon-masks.json, `caps-lock`).
//   · The `GtkEntryBuffer` C allocates is documented as non-pageable so the secret is not
//     written out to swap; a browser input has no such buffer and a script on the page can
//     read the DOM either way.
//   · `extra-menu` is a `Gio.MenuModel` — a slot, not an attribute, and out of scope for a
//     browser context menu. `activates-default` and `placeholder-text` are in `KNOWN_GAPS`.
//
// A11Y: the inner `<input type="password">` IS the text box, which is what
// `GTK_ACCESSIBLE_ROLE_TEXT_BOX` (gtkpasswordentry.c:536) means; the host does not restate
// a role the focused node already has.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss:1-96 (entry.password)
// Reference: refs/gtk/gtk/gtkpasswordentry.c (properties, init, visibility_toggled, activate_cb)
// Reference: refs/libadwaita/src/adw-password-entry-row.c (the derivation this reuses)
// Copyright (c) GNOME contributors (libadwaita, GTK). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the peek + caps-lock
//   derivation composed from @gjsify/adwaita-core.

import { EntryRowState, PasswordEntryRowState } from '@gjsify/adwaita-core';
import type { PasswordEntryRowRenderState } from '@gjsify/adwaita-core';

import { createGtkImage, type GtkImage } from './gtk-image.js';

import { GtkEntry } from './gtk-entry.js';

/** The glyph for the one symbolic `@gjsify/adwaita-icons` cannot compile — see the header. */
const CAPS_LOCK_GLYPH = '⇪';

export class GtkPasswordEntry extends GtkEntry {
    /** The headless peek + caps-lock derivation, composing the entry's own state. */
    private readonly _entry = new EntryRowState();
    private readonly _password = new PasswordEntryRowState(this._entry);
    private _toggle!: HTMLButtonElement;
    private _peekIcon!: GtkImage;
    private _capsLock!: HTMLElement;

    static get observedAttributes(): string[] {
        return [...GtkEntry.observedAttributes, 'show-peek-icon'];
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
     * Feed the platform's Caps Lock state in — GDK reads it off the keyboard device
     * (`gdk_device_get_caps_lock_state`), which a browser exposes only on keyboard events.
     * Public so a host that knows better (a virtual keyboard, a test) can drive it directly.
     */
    setCapsLockOn(on: boolean): void {
        this._password.setCapsLockOn(on);
    }

    override connectedCallback(): void {
        super.connectedCallback();

        // C's `gtk_text_set_visibility (…, FALSE)` + `GTK_INPUT_PURPOSE_PASSWORD`.
        this._input.type = 'password';
        this._input.autocomplete = 'new-password';

        this._capsLock = document.createElement('span');
        this._capsLock.className = 'adw-password-entry-caps-lock';
        this._capsLock.textContent = CAPS_LOCK_GLYPH;
        this._capsLock.setAttribute('role', 'alert');

        this._toggle = document.createElement('button');
        this._toggle.type = 'button';
        this._toggle.className = 'adw-button flat circular icon-only adw-password-entry-peek';
        this._peekIcon = createGtkImage(null, 'adw-password-entry-peek-icon');
        this._toggle.append(this._peekIcon);
        this._toggle.addEventListener('click', () => this._password.togglePeek());
        // A click must not take the caret out of the field, which it would by default.
        this._toggle.addEventListener('mousedown', (event) => event.preventDefault());

        // GDK reads caps lock off the keyboard device; the browser exposes it only on
        // keyboard events, so those are the source here. Focus is the OTHER input the
        // derivation needs — GTK's `caps_lock_state_changed` requires `has_focus` too.
        const readCapsLock = (event: KeyboardEvent) => this._password.setCapsLockOn(event.getModifierState('CapsLock'));
        this._input.addEventListener('keydown', readCapsLock);
        this._input.addEventListener('keyup', readCapsLock);
        this._input.addEventListener('focus', () => {
            this._entry.setEditing(true);
            this._passwordChanged();
        });
        this._input.addEventListener('blur', () => {
            this._entry.setEditing(false);
            this._passwordChanged();
        });

        // The indicator leads and the peek button trails, the order libadwaita's
        // `&.password image.caps-lock-indicator` and the C's own sizing put them in.
        this.replaceChildren(this._capsLock, this._input, this._toggle);

        this._toggle.hidden = !this.hasAttribute('show-peek-icon');
        this._applyPassword(this._password.state);
        this._password.subscribe((state) => {
            this._applyPassword(state);
            this.dispatchEvent(
                new CustomEvent('notify::revealed', { bubbles: true, detail: { revealed: state.revealed } }),
            );
        });
    }

    override attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
        super.attributeChangedCallback(name, oldValue, value);
        // `show-peek-icon` is FALSE by default (gtkpasswordentry.c:500-504), so a bare
        // `<gtk-password-entry>` has no toggle at all — the same answer `Adw.PasswordEntryRow`
        // gives, whose peek button it does show.
        if (name === 'show-peek-icon' && this._toggle) this._toggle.hidden = value === null;
    }

    /** A focus change re-derives, because the warning's visibility is `editing && …`. */
    private _passwordChanged(): void {
        this._applyPassword(this._password.state);
    }

    /** `notify_visibility_cb`, applied to the DOM. */
    private _applyPassword(state: PasswordEntryRowRenderState): void {
        this._input.type = state.revealed ? 'text' : 'password';
        // The libadwaita name travels in `data-icon-name`; the mask class is the curated
        // `@gjsify/adwaita-icons` spelling of the same symbolic, as `<adw-password-entry-row>`
        // does for its own toggle.
        this._peekIcon.dataset.iconName = state.peekIconName;
        this._peekIcon.iconName = state.peekIconName;
        this._toggle.title = state.peekLabel;
        this._toggle.setAttribute('aria-label', state.peekLabel);
        this._toggle.setAttribute('aria-pressed', String(state.revealed));
        if (state.revealed) this.setAttribute('revealed', '');
        else this.removeAttribute('revealed');

        this._capsLock.dataset.iconName = state.indicatorIconName;
        this._capsLock.title = state.indicatorTooltip;
        this._capsLock.setAttribute('aria-label', state.indicatorTooltip);
        this._capsLock.hidden = !this._entry.state.indicatorVisible;
    }
}

customElements.define('gtk-password-entry', GtkPasswordEntry);
