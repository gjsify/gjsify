// <adw-combo-row> — Row with a title/subtitle and a dropdown select.
// Attributes: title, subtitle, items (JSON string[]), selected (index number)
// Events: notify::selected (CustomEvent, mirrors GJS GObject signal naming)
// The native <select> is stretched invisibly over the row so clicking anywhere opens it.
//
// The SELECTION state machine (the options list, the two-way index↔value mapping,
// the empty/out-of-range guards and the programmatic-vs-interactive notify split)
// is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link ComboState};
// this element composes it and keeps only the DOM render half — the <select>, the
// inline value label and the `notify::selected` event.
// `@gjsify/adwaita-nativescript` composes the same state machine, so both ports
// share one behaviour.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.ComboRow; the selection state
//   machine composed from @gjsify/adwaita-core.

import { ComboState } from '@gjsify/adwaita-core';

export class AdwComboRow extends HTMLElement {
    private _select!: HTMLSelectElement;
    private _valueEl!: HTMLSpanElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'selected'];
    }

    get selected(): number {
        return this._initialized ? this._state.selectedIndex : parseInt(this.getAttribute('selected') || '0', 10);
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const items: string[] = JSON.parse(this.getAttribute('items') || '[]');
        // Seed the headless state BEFORE subscribing, so building the initial DOM
        // below is not driven by a change notification.
        this._state.setOptions(items.map((item) => ({ label: item, value: item })));
        this._state.setSelectedIndex(parseInt(this.getAttribute('selected') || '0', 10));
        const selectedIdx = this._state.selectedIndex;

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        // Visible selected value display
        this._valueEl = document.createElement('span');
        this._valueEl.className = 'adw-row-value';
        this._valueEl.textContent = this._state.selectedLabel;

        // Hidden select overlaying the entire row
        const select = document.createElement('select');
        items.forEach((item, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = item;
            if (i === selectedIdx) option.selected = true;
            select.appendChild(option);
        });

        this.replaceChildren(text, this._valueEl, select);

        this._select = select;

        // The core state drives the inline label + the <select> on every change,
        // and the notify::selected event only on an interactive pick.
        this._state.subscribe((change) => {
            this._valueEl.textContent = change.label;
            if (this._select.selectedIndex !== change.selected) this._select.selectedIndex = change.selected;
            if (!change.interactive) return;
            this.setAttribute('selected', String(change.selected));
            this.dispatchEvent(
                new CustomEvent('notify::selected', {
                    bubbles: true,
                    detail: { selected: change.selected },
                }),
            );
        });

        this._select.addEventListener('change', () => {
            // A user pick — `select()` guards the no-op case and notifies
            // `interactive`, so the subscriber emits notify::selected.
            this._state.select(this._select.selectedIndex);
        });

        this._renderText();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'selected') {
            // A programmatic set — the core state notifies `interactive: false`,
            // so the subscriber re-syncs the display without emitting an event.
            this._state.setSelectedIndex(parseInt(value || '0', 10));
        } else {
            this._renderText();
        }
    }

    private _renderText() {
        this._titleEl.textContent = this.getAttribute('title') ?? '';
        const subtitle = this.getAttribute('subtitle') ?? '';
        this._subtitleEl.textContent = subtitle;
        this._subtitleEl.hidden = subtitle.length === 0;
    }
}

customElements.define('adw-combo-row', AdwComboRow);
