// <gtk-switch> — the Adwaita toggle, as an element. A 44×24 track with a hidden
// checkbox behind it and a knob that slides on `active`.
//
// The styles are the UNSCOPED `scss/_switch.scss`, so `.adw-switch` exists outside a
// switch row and `<adw-expander-row>` can reuse it instead of copying the block.
//
// NO CORE STATE MACHINE. The state is two booleans with no derivation, no ordering and
// no notify subtlety beyond "on change" — ADR 0004 is explicit that trivial behaviour
// gets no core class — and each is the ATTRIBUTE, `toggleAttribute` being idempotent, so
// "notify only on a real change" needs no guard. The notify rule that IS derived from C
// lives in the ROW's `SwitchRowState`.
//
// THE TWO BOOLEANS ARE NOT THE SAME THING, and that is the whole of `GtkSwitch`:
// `active` is where the USER put the switch, `state` is what the thing being switched
// currently IS (gtkswitch.c:39-43). `set_active` emits `::state-set` with the new value
// and the DEFAULT HANDLER sets `state` to it (:800, :558), so by default the two track
// each other — that is why a declarative `active` still paints the trough. An
// application that changes the backend separately connects to `::state-set`, returns
// TRUE to stop the default handler and calls `set_state` when the real change lands
// (:637-654); then `active` moves and `state` does not, which is exactly the delayed
// case. So the handler is not modelled as a cancellable signal — it is modelled as its
// DEFAULT, plus the attribute an application writes, which is the one half a custom
// element can express.
//
// WHICH ONE IS PAINTED: libadwaita's `switch:checked` (refs/libadwaita/src/stylesheet/
// widgets/_switch.scss:41-55), and GTK sets that state flag from `state`, not from
// `active` (gtkswitch.c:853-856). So the trough colour follows `state` and the knob
// position follows `active`, which is the two-phase picture the C describes.
//
// A11Y: the checkbox is left bare — no `role="switch"` — because the widgets that host
// one claim that role themselves (`adw_switch_row_init` sets
// `GTK_ACCESSIBLE_ROLE_SWITCH` on the ROW) and a nested second switch role would be
// announced twice.
//
// Reference: refs/adwaita-web/adwaita-web/scss/_switch.scss
// Reference: refs/libadwaita/src/stylesheet/widgets/_switch.scss
// Reference: refs/gtk/gtk/gtkswitch.c:26-72,558,637-654,779-810,840-859
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Copyright (c) 2025 csm (adwaita-web). MIT License.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { DispatchedSignals } from '../signals.js';

export class GtkSwitch extends HTMLElement {
    /** The GTK signals this element dispatches, each with the DOM event it arrives as (ADR 0093). */
    static readonly signals: DispatchedSignals = {
        'notify::active': 'notify::active',
        'notify::state': 'notify::state',
    };

    private _input!: HTMLInputElement;
    private _slider!: HTMLSpanElement;
    private _initialized = false;

    static get observedAttributes() {
        return ['active', 'state', 'disabled', 'unfocusable'];
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

    /** Whether the user put the switch ON. Drives the knob. */
    get active(): boolean {
        return this.hasAttribute('active');
    }

    set active(value: boolean) {
        // `gtk_switch_set_active` emits `::state-set` and the DEFAULT handler runs
        // `set_state` (gtkswitch.c:800, :558), so writing one writes the other. That is
        // what keeps a declarative `active` painting the accent trough.
        this.toggleAttribute('active', !!value);
        this.state = this.active;
    }

    /** `Gtk.Switch:state` — what the switched thing currently is. Drives the trough. */
    get state(): boolean {
        return this.hasAttribute('state');
    }

    set state(value: boolean) {
        this.toggleAttribute('state', !!value);
    }

    /** Whether the switch is inert. */
    get disabled(): boolean {
        return this.hasAttribute('disabled');
    }

    set disabled(value: boolean) {
        this.toggleAttribute('disabled', !!value);
    }

    connectedCallback() {
        if (this._initialized) {
            this._render();
            return;
        }
        this._initialized = true;

        this.classList.add('adw-switch');

        this._input = document.createElement('input');
        this._input.type = 'checkbox';
        this._slider = document.createElement('span');
        this._slider.className = 'adw-switch-slider';
        this.replaceChildren(this._input, this._slider);

        // An `active` written before the element was connected is the same write GTK
        // sees at construction time, so the default `::state-set` handler has already
        // run by the time anyone looks: catch `state` up here (gtkswitch.c:682-757 gives
        // `state` and `is_active` the same FALSE default and no attribute to reconcile).
        if (this.active) this.state = true;

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
        } else if (name === 'state') {
            this.dispatchEvent(new CustomEvent('notify::state', { bubbles: true, detail: { state: this.state } }));
        }
    }

    private _render(): void {
        const disabled = this.disabled;
        this._input.checked = this.active;
        this._input.disabled = disabled;
        if (this.unfocusable) this._input.tabIndex = -1;
        else this._input.removeAttribute('tabindex');
        // The `:checked` state flag GTK raises from `state` (gtkswitch.c:853-856), which
        // is the selector libadwaita paints the accent trough from.
        this.classList.toggle('checked', this.state);
        this.classList.toggle('disabled', disabled);
    }
}

customElements.define('gtk-switch', GtkSwitch);
