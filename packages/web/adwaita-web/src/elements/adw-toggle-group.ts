// <adw-toggle-group> — A linked set of toggle buttons where exactly one is
// active at a time (the web counterpart of Adw.ToggleGroup). Toggles are
// declared as <adw-toggle> children with `label` and/or `icon-name` attributes;
// the group renders them inside an inner container, tracks the active index, and
// recolors the active toggle with the Adwaita active-toggle accent.
// Attributes: active (zero-based index of the active toggle, default 0), and the
//   style flags flat / round (mirroring the Adw.ToggleGroup `.flat` / `.round`
//   style classes).
// Events: `notify::active` (CustomEvent, bubbles, `detail = { active }`) when the
//   active toggle changes — mirrors the Adw.ToggleGroup `active` GObject property.
//
// The SELECTION state machine (the segment list plus the guarded, no-op-on-same
// active index) is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as
// {@link ToggleGroupState}; this element composes it and keeps only the DOM render
// half — building the buttons, the active pill / `aria-pressed` reflection, and
// the `notify::active` event. `@gjsify/adwaita-nativescript` composes the same
// state machine, so both ports share one behaviour.
//
// Reference: refs/libadwaita/src/adw-toggle-group.c (AdwToggleGroup behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_toggle_group.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// selection state machine composed from @gjsify/adwaita-core.

import { ToggleGroupState } from '@gjsify/adwaita-core';

/** A single toggle. Children of <adw-toggle-group>; consumed at connect time. */
export class AdwToggle extends HTMLElement {
    static get observedAttributes() {
        return ['label', 'icon-name'];
    }
}

export class AdwToggleGroup extends HTMLElement {
    private _innerEl!: HTMLDivElement;
    private _buttons: HTMLButtonElement[] = [];
    /** The headless segment list + guarded selection state machine (ADR 0004). */
    private readonly _state = new ToggleGroupState();
    private _initialized = false;

    static get observedAttributes() {
        return ['active', 'flat', 'round'];
    }

    /** Zero-based index of the active toggle. */
    get active(): number {
        return this._state.selected;
    }

    set active(value: number) {
        this.setAttribute('active', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-toggle> children before we take over the
        // subtree — their label / icon-name become the rendered buttons.
        const toggles = Array.from(this.querySelectorAll('adw-toggle')) as AdwToggle[];

        this._innerEl = document.createElement('div');
        this._innerEl.className = 'adw-toggle-group-inner';

        this._buttons = toggles.map((toggle, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'adw-toggle';

            const label = toggle.getAttribute('label') ?? '';
            const icon = toggle.getAttribute('icon-name') ?? '';
            if (icon) {
                const span = document.createElement('span');
                span.className = `adw-icon adw-icon--${icon}`;
                span.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)
                btn.appendChild(span);
            }
            if (label) btn.appendChild(document.createTextNode(label));

            // An icon-only toggle has no text — give it an accessible name.
            if (icon && !label) btn.setAttribute('aria-label', icon);

            btn.addEventListener('click', () => this._selectIndex(index));
            return btn;
        });

        this._innerEl.append(...this._buttons);
        this.replaceChildren(this._innerEl);

        // Hand the segments to the headless state machine (it needs the count to
        // bound the selection), then seed the active index from the attribute.
        this._state.setLabels(
            toggles.map((toggle) => toggle.getAttribute('label') || toggle.getAttribute('icon-name') || ''),
        );
        this._state.subscribe(() => this._render());
        this._state.setSelected(this._readActiveAttr());
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'active') {
            // A no-op / out-of-range index is rejected by the core state machine.
            this._state.setSelected(this._readActiveAttr());
            return;
        }
        // flat / round are styling-only.
        this._render();
    }

    private _readActiveAttr(): number {
        const raw = Number.parseInt(this.getAttribute('active') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        const max = Math.max(0, this._state.count - 1);
        return Math.min(Math.max(raw, 0), max);
    }

    private _selectIndex(index: number): void {
        // The core state machine guards the no-op/out-of-range cases and notifies
        // the subscriber (which re-renders) only on a real change.
        if (!this._state.setSelected(index)) return;
        // Keep the attribute in sync without re-entering via the guarded
        // attributeChangedCallback (value already matches, so it no-ops).
        this.setAttribute('active', String(index));
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: index } }));
    }

    private _render(): void {
        this.classList.toggle('flat', this.hasAttribute('flat'));
        this.classList.toggle('round', this.hasAttribute('round'));
        const active = this._state.selected;
        this._buttons.forEach((btn, index) => {
            const isActive = index === active;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    }
}

customElements.define('adw-toggle', AdwToggle);
customElements.define('adw-toggle-group', AdwToggleGroup);
