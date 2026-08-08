// <adw-switch-row> — Row with a title/subtitle and a trailing toggle switch.
// Attributes: title, subtitle, active (boolean)
// Events: notify::active (CustomEvent, mirrors GJS GObject signal naming)
//
// The ACTIVE flag, its notify rule and the toggle-on-row-activation are HEADLESS
// and live in `@gjsify/adwaita-core` (ADR 0004) as {@link SwitchRowState}; this
// element composes it and keeps only the DOM render half — the checkbox, the
// label column and the `notify::active` event.
// `@gjsify/adwaita-nativescript` composes the same state, so both ports share one
// behaviour. Two things this fixes, both from adw-switch-row.c:
//   - a PROGRAMMATIC `row.active = true` now notifies. The DOM does not fire
//     `change` for `.checked =`, so keying the event off the checkbox meant the
//     row was silent — while the NativeScript port, whose `checkedChange` DOES
//     fire on a programmatic write, notified. libadwaita has exactly one notify
//     path (`slider_notify_active_cb`, C:66-77) and it cannot see the origin.
//   - clicking the ROW toggles. `adw_switch_row_init` points the
//     activatable-widget at the slider (C:160-162), so the title is part of the
//     control; here only the handle itself worked.
//
// The TOGGLE itself is `<adw-switch>`. It used to be built here by hand —
// `label.adw-switch > input[type=checkbox] + span.adw-switch-slider` — and
// `<adw-expander-row>` built the identical thing, over a stylesheet block that
// was a character-for-character copy of this row's.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.SwitchRow; the active state
//   composed from @gjsify/adwaita-core; the toggle markup from <adw-switch>.

import { SwitchRowState, deriveRowLabels } from '@gjsify/adwaita-core';

// SIDE-EFFECT import, deliberately separate from the type import below: it is
// what guarantees `adw-switch` is defined before this module's own
// `customElements.define` can upgrade a server-rendered `<adw-switch-row>` and
// build one. A combined `import { AdwSwitch }` would NOT do it — the binding is
// only ever used in type position here, and this package compiles without
// `verbatimModuleSyntax`, so TypeScript would elide the whole statement and take
// the registration with it.
import './adw-switch.js';
import type { AdwSwitch } from './adw-switch.js';

export class AdwSwitchRow extends HTMLElement {
    private _switchEl!: AdwSwitch;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless active flag + its notify rule (ADR 0004). */
    private readonly _state = new SwitchRowState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'active'];
    }

    get active(): boolean {
        return this._initialized ? this._state.active : this.hasAttribute('active');
    }

    set active(value: boolean) {
        // Routed through the attribute so the declarative and imperative faces
        // stay one code path; `attributeChangedCallback` drives the state.
        this.toggleAttribute('active', !!value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        this._switchEl = document.createElement('adw-switch') as AdwSwitch;

        this.replaceChildren(text, this._switchEl);

        this._state.setActive(this.hasAttribute('active'));
        this._switchEl.active = this._state.active;
        // `gtk_widget_class_set_accessible_role (…, GTK_ACCESSIBLE_ROLE_SWITCH)`
        // plus the initial CHECKED state (adw-switch-row.c:147, :155-158).
        this.setAttribute('role', 'switch');
        this.setAttribute('aria-checked', String(this._state.active));

        this._switchEl.addEventListener('notify::active', (event) => {
            // The ROW is the public event surface — libadwaita has exactly one
            // notify path for this property (`slider_notify_active_cb`, C:66-77).
            // Letting the composed switch's own identically-named event escape
            // would make every listener on the row see each toggle twice.
            event.stopPropagation();
            this._apply(this._state.setActive(this._switchEl.active));
        });

        // Activating the row inverts the state (adw-switch-row.c:23-27). A click
        // that landed on the switch itself is already handled by the switch —
        // toggling again here would immediately undo it.
        this.addEventListener('click', (event) => {
            if (event.target instanceof Node && this._switchEl.contains(event.target)) return;
            this._apply(this._state.activate());
        });

        this._renderText();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'active') this._apply(this._state.setActive(this.hasAttribute('active')));
        else this._renderText();
    }

    /**
     * Push a state transition out to the DOM and emit `notify::active` — but
     * only when something actually changed, which is the `g_object_notify`
     * gate libadwaita puts on the same transition (C:224-225 → :76).
     */
    private _apply(changed: boolean) {
        if (!changed) return;
        // Idempotent on the switch's side too, so this write does not bounce
        // back through the `notify::active` listener as a second transition.
        this._switchEl.active = this._state.active;
        this.toggleAttribute('active', this._state.active);
        // The a11y state libadwaita updates alongside the notify (C:71-74).
        this.setAttribute('aria-checked', String(this._state.active));
        this.dispatchEvent(
            new CustomEvent('notify::active', {
                bubbles: true,
                detail: { active: this._state.active },
            }),
        );
    }

    private _renderText() {
        const { title, titleVisible, subtitle, subtitleVisible } = deriveRowLabels({
            title: this.getAttribute('title'),
            subtitle: this.getAttribute('subtitle'),
        });
        this._titleEl.textContent = title;
        // `string_is_not_empty` applies to the TITLE too (adw-action-row.ui:49-53,
        // inherited — AdwSwitchRow derives from AdwActionRow, adw-switch-row.c:50).
        this._titleEl.hidden = !titleVisible;
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = !subtitleVisible;
    }
}

customElements.define('adw-switch-row', AdwSwitchRow);
