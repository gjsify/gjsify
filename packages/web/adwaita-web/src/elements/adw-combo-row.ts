// <adw-combo-row> — row with a title/subtitle and a dropdown select. The model is a JSON
// array in `options` / `items` (`["a","b"]` or `[{"value":"a","label":"A"}]`), `selected`
// an index, and the native <select> is stretched invisibly over the row so clicking
// anywhere opens it.
//
// The SELECTION state machine (the options list, the two-way index↔value mapping, the
// empty/out-of-range guards and the programmatic-vs-interactive notify split) is HEADLESS
// and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link ComboState}; this element keeps
// only the DOM half — the <select>, the inline value label and `notify::selected`.
//
// THE MODEL IS INPUT, AND INPUT STAYS LIVE. This row and `<gtk-drop-down>` are the same
// list widget on GTK and share that one `ComboState` here — but the row used to parse
// `items` once in `connectedCallback`, observe only `['title','subtitle','selected']` and
// publish no accessor at all. So `row.items = […]` wrote an expando onto the element and
// `setAttribute('items', …)` reached no callback: a model replaced after connect changed
// nothing, silently, while the identical assignment on `<gtk-drop-down>` worked. Both
// spellings now reach the same rebuild, and `scripts/check-adwaita-collection-reactivity.mjs`
// holds the rule for every collection either renderer takes in.
//
// Attributes:
//   title / subtitle — the text column.
//   options / items  — JSON array: `["a","b"]` or `[{"value":"a","label":"A"}]`.
//   selected         — the selected index (number).
// Properties (the `<gtk-drop-down>` set, minus the two that are drop-down chrome):
//   options / items  — the option list ({ value, label }[]) (get/set).
//   selected         — the selected index (get/set).
//   selectedValue    — the selected option's value ('' when empty) (get/set-by-value).
// Events:
//   `notify::selected` (CustomEvent, bubbles, detail = { selected }) — a USER pick.
//     Deliberately NOT every change, unlike `<gtk-drop-down>`: this row's event has
//     always been the interactive half of `ComboState`'s split, and `adw-row-state.spec.ts`
//     pins it.
//
// Adapted from Adwaita Web UI Framework (https://github.com/mclellac/adwaita-web).
// Copyright (c) 2025 csm. MIT License.
// Modifications: Reimplemented as Web Component for @gjsify/adwaita-web;
//   title/subtitle text column added to match Adw.ComboRow; the selection state
//   machine composed from @gjsify/adwaita-core.

import { ComboState, deriveRowLabels, normalizeComboOptions } from '@gjsify/adwaita-core';
import type { AdwComboOption, AdwComboOptionInput } from '@gjsify/adwaita-core';

export class AdwComboRow extends HTMLElement {
    private _select!: HTMLSelectElement;
    private _valueEl!: HTMLSpanElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'options', 'items', 'selected'];
    }

    /** The selectable options. Setting them rebuilds the <select> and clamps the selection. */
    get options(): AdwComboOption[] {
        return this._state.options;
    }

    set options(value: ReadonlyArray<AdwComboOptionInput>) {
        // `setOptions` re-runs autoselect, so an index the new model does not have falls
        // back to 0 — the clamp is core's, exactly as `<gtk-drop-down>` gets it.
        this._state.setOptions(normalizeComboOptions(value));
        this._renderOptions();
    }

    /** `items` is the spelling this row shipped with; it is the `options` alias, as on `<gtk-drop-down>`. */
    get items(): AdwComboOption[] {
        return this._state.options;
    }

    set items(value: ReadonlyArray<AdwComboOptionInput>) {
        this.options = value;
    }

    get selected(): number {
        return this._initialized ? this._state.selectedIndex : parseInt(this.getAttribute('selected') || '0', 10);
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    /**
     * The selected option's `value`, or '' when nothing is selected (Adw.ComboRow:selected-item).
     *
     * Assigning routes through `selected`, i.e. through the attribute, so a set BY VALUE
     * and a set BY INDEX leave the element in the same observable state — including the
     * reflected `selected=` a consumer or a stylesheet may be reading. An unknown value is
     * a no-op, as on `<gtk-drop-down>`.
     */
    get selectedValue(): string {
        return this._state.selectedValue;
    }

    set selectedValue(value: string) {
        const index = this._state.options.findIndex((option) => option.value === value);
        if (index >= 0) this.selected = index;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Seed the headless state BEFORE subscribing, so building the initial DOM below is
        // not driven by a change notification. The string→descriptor mapping is core's, so
        // this row and `<gtk-drop-down>` accept one option vocabulary.
        //
        // Only when the PROPERTY was not already set, the rule `<adw-data-grid>` and
        // `<gtk-drop-down>` both follow: a model assigned to a detached element must
        // survive being attached, and an absent attribute must not blank it.
        if (this._state.count === 0) this._state.setOptions(this._parseOptionsAttr());
        this._state.setSelectedIndex(parseInt(this.getAttribute('selected') || '0', 10));

        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        this._valueEl = document.createElement('span');
        this._valueEl.className = 'adw-row-value';

        this._select = document.createElement('select');

        this.replaceChildren(text, this._valueEl, this._select);

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

        this._renderOptions();
        this._renderText();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'options' || name === 'items') {
            this._state.setOptions(this._parseOptionsAttr());
            this._renderOptions();
        } else if (name === 'selected') {
            // A programmatic set — the core state notifies `interactive: false`,
            // so the subscriber re-syncs the display without emitting an event.
            this._state.setSelectedIndex(parseInt(value || '0', 10));
        } else {
            this._renderText();
        }
    }

    /**
     * The model as authored in markup — `options` first, `items` as the alias, the same
     * order and the same tolerance `<gtk-drop-down>` reads them in.
     *
     * `normalizeComboOptions` already guards a non-array, so a JSON object or scalar
     * yields the empty model rather than a throw; unparseable JSON does the same. A
     * malformed attribute must not take the row's DOM down with it.
     */
    private _parseOptionsAttr(): AdwComboOption[] {
        const raw = this.getAttribute('options') ?? this.getAttribute('items');
        if (!raw) return [];
        try {
            return normalizeComboOptions(JSON.parse(raw) as AdwComboOptionInput[]);
        } catch {
            return [];
        }
    }

    /**
     * Rebuild the `<option>` list from the model, then re-apply everything derived from it.
     *
     * A no-op before `connectedCallback` has built the DOM, which is what lets `options` be
     * assigned to a detached element: the state keeps the model and the connect path renders
     * it. The `<option>` values stay the INDEX — this element addresses its model by
     * position, and the descriptor's own `value` is reached through `selectedValue`.
     */
    private _renderOptions(): void {
        if (!this._initialized) return;
        this._select.replaceChildren();
        for (const [index, option] of this._state.options.entries()) {
            const el = document.createElement('option');
            el.value = String(index);
            el.textContent = option.label;
            this._select.appendChild(el);
        }
        // AFTER the rebuild, never during it: `setOptions` notifies while the old
        // `<option>` nodes are still in place, so the subscriber's own index write lands on
        // the outgoing list. This is the write that counts.
        this._select.selectedIndex = this._state.selectedIndex;
        this._valueEl.textContent = this._state.selectedLabel;
        this._syncChooser();
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
