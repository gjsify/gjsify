// <adw-switch> — the Adwaita toggle, as an element. A 44×24 track with a hidden
// checkbox behind it and a knob that slides on `active`.
//
// WHY IT EXISTS: `<adw-switch-row>` and `<adw-expander-row>` each built
// `label.adw-switch > input[type=checkbox] + span.adw-switch-slider` by hand, and
// `_expander_row.scss:73-121` was a character-for-character copy of
// `_switch_row.scss:15-63`. The cause was structural — `_switch_row.scss:9`
// opened `adw-switch-row {` and nested everything inside it, so `.adw-switch` did
// not exist outside a switch row and the expander could not reuse it. The styles
// are now the unscoped `scss/_switch.scss` and the markup is here.
//
// NO CORE STATE MACHINE. The state is one boolean with no derivation, no
// ordering and no notify subtlety beyond "on change" — ADR 0004 is explicit that
// a widget with genuinely trivial behaviour does not get a core class, and the
// `active` ATTRIBUTE is the state (`toggleAttribute` is idempotent by
// definition, so "notify only on a real change" needs no guard of its own).
// `GtkSwitch` does carry a two-phase `active`/`state` pair for async toggles,
// but `refs/gtk` is EMPTY in this tree so that is unverifiable here, and neither
// this port nor `@gjsify/adwaita-nativescript` models it — see the ROW's state
// (`SwitchRowState`), which is where the notify rule that IS derived from C
// lives.
//
// Attributes:
//   active   — boolean; reflects (and drives) the toggled state.
//   disabled — boolean; the control does not respond and is dimmed.
// Properties:
//   active   — the toggled state (get/set).
//   disabled — whether the control is inert (get/set).
// Events:
//   `notify::active` (CustomEvent, bubbles, detail = { active }) — mirrors the
//     GObject property-notify; fires on every change, programmatic included.
//     A widget that COMPOSES this one and publishes its own `notify::active`
//     (`<adw-switch-row>`) stops this one at the switch, so the row stays the
//     single public event surface.
//
// A11Y: the checkbox is left bare — no `role="switch"` — because the widgets
// that host one claim that role themselves (`adw_switch_row_init` sets
// `GTK_ACCESSIBLE_ROLE_SWITCH` on the ROW, adw-switch-row.c:147), and a nested
// second switch role would be announced twice. This is exactly the markup that
// shipped inside the two rows before the extraction.
//
// Reference: refs/adwaita-web/adwaita-web/scss/_switch.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_switch.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

export class AdwSwitch extends HTMLElement {
    private _input!: HTMLInputElement;
    private _slider!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['active', 'disabled'];
    }

    /** Whether the switch is on. */
    get active(): boolean {
        return this.hasAttribute('active');
    }

    set active(value: boolean) {
        // `toggleAttribute` with a force flag is a no-op when the attribute is
        // already in the wanted state, so re-setting the current value mutates
        // nothing and `attributeChangedCallback` — and therefore the notify —
        // never runs. That idempotence is what a state class would otherwise be
        // holding.
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

        // Keyboard (Space on the focused checkbox) and a direct programmatic
        // `input.click()` both arrive here; the attribute is the state, so this
        // just writes it and lets attributeChangedCallback do the rest.
        this._input.addEventListener('change', () => {
            this.active = this._input.checked;
        });

        // The slider covers the whole track (`inset: 0`), so every pointer click
        // lands on it rather than on the 0×0 checkbox — this is the toggle the
        // wrapping `<label>` used to provide for free. A click that DID reach the
        // checkbox is already handled by the listener above; toggling again here
        // would immediately undo it.
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
        this.classList.toggle('disabled', disabled);
    }
}

customElements.define('adw-switch', AdwSwitch);
