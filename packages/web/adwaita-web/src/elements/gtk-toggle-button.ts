// <gtk-toggle-button> — a button that stays pressed. `Gtk.ToggleButton` IS a `Gtk.Button`
// with one more boolean, `active`, so this element extends `<gtk-button>` and inherits its
// label, icon, child and style-class attributes unchanged; only the state is new.
//
// `active` is the ATTRIBUTE, as it is on `<gtk-switch>` — `toggleAttribute` is idempotent, so
// "notify only on a real change" needs no guard and no core state class (ADR 0004: trivial
// behaviour gets none). A click, Space or Enter on the inner button flips it. `toggled`
// (GtkToggleButton's own signal) and `notify::active` (CustomEvent, bubbles, detail
// `{ active }`) fire on EVERY change, programmatic included, the way GObject notifies.
//
// The inner button wears libadwaita's `:checked` as a `.checked` class, and `aria-pressed`
// carries the same state for assistive technology.
//
// NOT PORTED: `group`. Mutual exclusion among toggle buttons (and whether the active one can
// be clicked off) lives in `gtk_toggle_button_*`, which is GTK C, and `refs/gtk` is an
// uninitialized submodule here, so the rules are unverifiable. The single-choice shape with a
// verified source is `<adw-toggle-group>`.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss (`:checked`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { GtkButton } from './gtk-button.js';

export class GtkToggleButton extends GtkButton {
    private _wired = false;

    static get observedAttributes() {
        return [...GtkButton.observedAttributes, 'active'];
    }

    /** Whether the button is pressed in. */
    get active(): boolean {
        return this.hasAttribute('active');
    }

    set active(value: boolean) {
        this.toggleAttribute('active', !!value);
    }

    connectedCallback() {
        super.connectedCallback();
        if (this._wired) return;
        this._wired = true;
        // A disabled native button never emits `click`, so there is no guard to write here.
        this.button.addEventListener('click', () => {
            this.active = !this.active;
        });
    }

    // Optional because `GtkButton`'s own callback declares no parameter, and an override may not
    // demand one the base signature does not pass.
    attributeChangedCallback(name?: string) {
        super.attributeChangedCallback();
        if (name !== 'active' || !this._wired) return;
        this.dispatchEvent(new CustomEvent('toggled', { bubbles: true }));
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: this.active } }));
    }

    protected override decorate(button: HTMLButtonElement): void {
        button.classList.toggle('checked', this.active);
        button.setAttribute('aria-pressed', String(this.active));
    }
}

customElements.define('gtk-toggle-button', GtkToggleButton);
