// <adw-combo-row> — row with a title/subtitle and a dropdown select. `items` is a JSON
// `string[]`, `selected` an index, and the native <select> is stretched invisibly over the
// row so clicking anywhere opens it.
//
// The SELECTION state machine (the options list, the two-way index↔value mapping, the
// empty/out-of-range guards and the programmatic-vs-interactive notify split) is HEADLESS
// and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link ComboState}; this element keeps
// only the DOM half — the <select>, the inline value label and `notify::selected`.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.ComboRow; the selection state
//   machine composed from @gjsify/adwaita-core.

import { ComboState, deriveRowLabels, normalizeComboOptions } from '@gjsify/adwaita-core';

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
        // Seed the headless state BEFORE subscribing, so building the initial DOM below is
        // not driven by a change notification. The string→descriptor mapping is core's, so
        // this row and `<gtk-drop-down>` accept one option vocabulary.
        this._state.setOptions(normalizeComboOptions(items));
        this._state.setSelectedIndex(parseInt(this.getAttribute('selected') || '0', 10));
        const selectedIdx = this._state.selectedIndex;

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        this._valueEl = document.createElement('span');
        this._valueEl.className = 'adw-row-value';
        this._valueEl.textContent = this._state.selectedLabel;

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
            this._syncChooser();
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

        this._syncChooser();
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

    /**
     * `model_changed`: one option or none is not a choice, so the arrow goes and the row
     * stops being activatable.
     *
     * Both halves have to be expressed — `data-presents-chooser` gates the
     * `.adw-row-value::after` mask in the stylesheet, and DISABLING the overlaid `<select>`
     * is what makes the row inert. Hiding the arrow alone leaves a row that still opens a
     * one-entry popup on click.
     */
    private _syncChooser() {
        const presents = this._state.presentsChooser;
        this.dataset.presentsChooser = presents ? 'true' : 'false';
        this._select.disabled = !presents;
    }

    private _renderText() {
        // The `string_is_not_empty` label rule, from core — it hides the TITLE too.
        const labels = deriveRowLabels({
            title: this.getAttribute('title'),
            subtitle: this.getAttribute('subtitle'),
        });
        this._titleEl.textContent = labels.title;
        this._titleEl.hidden = !labels.titleVisible;
        this._subtitleEl.textContent = labels.subtitle;
        this._subtitleEl.hidden = !labels.subtitleVisible;
    }
}

customElements.define('adw-combo-row', AdwComboRow);
