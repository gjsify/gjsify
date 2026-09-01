// <gtk-switch> — the Adwaita toggle, as an element. A 44×24 track with a hidden
// checkbox behind it and a knob that slides on `active`.
//
// The styles are the UNSCOPED `scss/_switch.scss`, so `.adw-switch` exists outside a
// switch row and `<adw-expander-row>` can reuse it instead of copying the block.
//
// NO CORE STATE MACHINE. The state is one boolean with no derivation, no ordering and no
// notify subtlety beyond "on change" — ADR 0004 is explicit that trivial behaviour gets
// no core class, and the `active` ATTRIBUTE is the state (`toggleAttribute` is idempotent,
// so "notify only on a real change" needs no guard). `GtkSwitch` does carry a two-phase
// `active`/`state` pair for async toggles, but `refs/gtk` is an uninitialized submodule
// here so that is unverifiable, and neither this port nor
// `@gjsify/adwaita-nativescript` models it. The notify rule that IS derived from C lives
// in the ROW's `SwitchRowState`.
//
// `notify::active` (CustomEvent, bubbles, detail `{ active }`) fires on every change,
// programmatic included. A widget that COMPOSES this one and publishes its own
// `notify::active` (`<adw-switch-row>`) stops this one at the switch, so the row stays
// the single public event surface.
//
// A11Y: the checkbox is left bare — no `role="switch"` — because the widgets that host
// one claim that role themselves (`adw_switch_row_init` sets
// `GTK_ACCESSIBLE_ROLE_SWITCH` on the ROW) and a nested second switch role would be
// announced twice.
//
// Reference: refs/adwaita-web/adwaita-web/scss/_switch.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_switch.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class GtkSwitch extends HTMLElement {
    private _input!: HTMLInputElement;
    private _slider!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['active', 'disabled', 'unfocusable'];
    }

    /**
     * `Gtk.Widget:can-focus` on the slider, inverted so the default stays "yes".
     *
     * `adw_switch_row_init` does `gtk_widget_set_can_focus (self->slider, FALSE)`
     * (adw-switch-row.c:159) and makes the ROW activatable instead, so a switch row is ONE
     * tab stop announced as its own title — not a bare checkbox followed by a label that
     * cannot be reached. A standalone `<gtk-switch>` keeps its checkbox focusable.
     */
    get unfocusable(): boolean {
        return this.hasAttribute('unfocusable');
    }

    set unfocusable(value: boolean) {
        this.toggleAttribute('unfocusable', !!value);
    }

    /** Whether the switch is on. */
    get active(): boolean {
        return this.hasAttribute('active');
    }

    set active(value: boolean) {
        // `toggleAttribute` with a force flag is a no-op when the attribute already holds
        // the wanted state, so re-setting the current value never runs
        // `attributeChangedCallback` and never notifies. That idempotence is what a state
        // class would otherwise hold.
        this.toggleAttribute('active', !!value);
    }

    /** Whether the switch is inert. */
    get disabled(): boolean {
        return this.hasAttribute('disabled');
    }

    set disabled(value: boolean) {
        this.toggleAttribute('disabled', !!value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add('adw-switch');

        this._input = document.createElement('input');
        this._input.type = 'checkbox';
        this._slider = document.createElement('span');
        this._slider.className = 'adw-switch-slider';
        this.replaceChildren(this._input, this._slider);

        // Keyboard (Space on the focused checkbox) and a programmatic `input.click()` both
        // arrive here; the attribute is the state, so this writes it and lets
        // attributeChangedCallback do the rest.
        this._input.addEventListener('change', () => {
            this.active = this._input.checked;
        });

        // The slider covers the whole track (`inset: 0`), so every pointer click lands on
        // it rather than on the 0×0 checkbox. A click that DID reach the checkbox is
        // already handled by the listener above; toggling again here would undo it.
        this.addEventListener('click', (event) => {
            if (this.disabled) return;
            if (event.target === this._input) return;
            this.active = !this.active;
        });

        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        this._render();
        if (name === 'active') {
            this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: this.active } }));
        }
    }

    private _render(): void {
        const disabled = this.disabled;
        this._input.checked = this.active;
        this._input.disabled = disabled;
        if (this.unfocusable) this._input.tabIndex = -1;
        else this._input.removeAttribute('tabindex');
        this.classList.toggle('disabled', disabled);
    }
}

customElements.define('gtk-switch', GtkSwitch);
