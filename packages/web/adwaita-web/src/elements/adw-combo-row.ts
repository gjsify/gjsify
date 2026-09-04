// <adw-combo-row> — row with a title/subtitle and a dropdown select. The model is a JSON
// array in the `model` attribute (`["a","b"]` or `[{"value":"a","label":"A"}]`), `selected`
// an index, and the native <select> is stretched invisibly over the row so clicking
// anywhere opens it.
//
// The SELECTION state machine (the model, the two-way index↔value mapping, the
// empty/out-of-range guards and the programmatic-vs-interactive notify split) is HEADLESS
// and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link ComboState}; this element keeps
// only the DOM half — the <select>, the inline value label and `notify::selected`.
//
// THE MODEL IS INPUT, AND INPUT STAYS LIVE. This row and `<gtk-drop-down>` are the same
// list widget on GTK and share that one `ComboState` here — but the row used to parse its
// items once in `connectedCallback`, observe only `['title','subtitle','selected']` and
// publish no accessor at all, so a model replaced after connect changed nothing, silently
// (#1525). Both spellings now reach the same rebuild, and
// `scripts/check-adwaita-collection-reactivity.mjs` holds the rule for every collection
// either renderer takes in.
//
// THE MODEL IS SPLICED, NOT REBUILT (ADR 0046). `ComboState` reports WHERE the model
// changed — `Gio.ListModel::items-changed`, one splice per assignment — and this element
// applies exactly that range. Appending one item to a hundred-item model adds ONE
// `<option>` and leaves the other hundred nodes standing; the previous code dropped every
// node on every assignment, which is also what threw away the browser's own state for the
// rows that did not change. It is what removes the ordering hazard this file used to
// carry as a comment: the splice arrives BEFORE the selection change, so the subscriber's
// index write already lands on the new list.
//
// Attributes:
//   title / subtitle — the text column.
//   model            — JSON array: `["a","b"]` or `[{"value":"a","label":"A"}]`.
//   selected         — the selected index (number).
// Properties — the `<gtk-drop-down>` set minus `enableSearch` and `active`, which are that
// element's own popover chrome and have no counterpart on a row that opens a native
// <select>:
//   model            — the list model ({ value, label }[]) (get/set). `Adw.ComboRow:model`'s
//     own name, per ADR 0034 clause 1; it replaced `options`/`items`, which were two
//     further spellings of one GTK property.
//   selected         — the selected index (get/set). PERMISSIVE, and this is the one row of
//     `ComboState`'s contract the two selectors answer differently: an index past the end
//     is ACCEPTED here and reads back with an empty `selectedValue`/label, where
//     `<gtk-drop-down>` rejects the set outright (gtk-drop-down.ts). Neither is a bug —
//     `ComboState.hasIndex` is where the bounds live and why the policy is each
//     renderer's. Stated here because a consumer of THIS element reads this file.
//   selectedValue    — the selected option's value ('' when empty) (get/set-by-value).
//   selectedItem     — the selected option descriptor, or null (get).
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

import { ComboState, deriveRowLabels, normalizeComboOptions, parseListModel } from '@gjsify/adwaita-core';
import type { AdwComboOption, AdwListItemsChanged, AdwListModelInput } from '@gjsify/adwaita-core';

export class AdwComboRow extends HTMLElement {
    private _select!: HTMLSelectElement;
    private _valueEl!: HTMLSpanElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'model', 'selected'];
    }

    /** The list model (`Adw.ComboRow:model`). Setting it splices the <select> and clamps the selection. */
    get model(): AdwComboOption[] {
        return this._state.model;
    }

    set model(value: AdwListModelInput) {
        // `setModel` re-runs autoselect, so an index the new model does not have falls
        // back to 0 — the clamp is core's, exactly as `<gtk-drop-down>` gets it.
        this._state.setModel(normalizeComboOptions(value));
    }

    /**
     * The selected index (Adw.ComboRow:selected). PERMISSIVE: an index past the end is
     * accepted and reads back with an empty {@link selectedValue}, mirroring the `guint`
     * property that takes any position — where `<gtk-drop-down>` rejects the same set, as
     * its own docs promise. `ComboState.hasIndex` owns the bounds and records why the
     * POLICY is each renderer's; `COMBO_SELECTION_VECTORS` drives both answers.
     */
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
        const index = this._state.model.findIndex((option) => option.value === value);
        if (index >= 0) this.selected = index;
    }

    /**
     * The selected option descriptor, or `null` (Adw.ComboRow:selected-item).
     *
     * Read-only, as the GObject property is. `null` and not a blank descriptor: the
     * sentinel and an index past the end both address no option, and inventing an empty
     * one would make "nothing is selected" indistinguishable from an option with no text.
     */
    get selectedItem(): AdwComboOption | null {
        return this._state.model[this._state.selectedIndex] ?? null;
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
        if (this._state.count === 0) this._state.setModel(parseListModel(this.getAttribute('model')));
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

        // WHERE the model changed — applied before the selection change below, which is
        // the ordering that lets that subscriber's index write land on the new list.
        this._state.subscribeItems((change) => this._applyItemsChanged(change));

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
        if (name === 'model') {
            this._state.setModel(parseListModel(value));
        } else if (name === 'selected') {
            // A programmatic set — the core state notifies `interactive: false`,
            // so the subscriber re-syncs the display without emitting an event.
            this._state.setSelectedIndex(parseInt(value || '0', 10));
        } else {
            this._renderText();
        }
    }

    /**
     * Build one `<option>` for a model item.
     *
     * ITS `value` IS THE MODEL'S value, not the position. The position used to be written
     * there with a comment defending it, and nothing in this package or its consumers ever
     * read it back — while it made every insertion renumber the whole tail, which is the
     * one thing a splice exists to avoid. The element still addresses its model by
     * POSITION (`selectedIndex`); what the attribute now carries is the descriptor's own
     * value, which is also what a form submission would have wanted.
     */
    private _createOption(option: AdwComboOption): HTMLOptionElement {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        return el;
    }

    /**
     * Apply one `items-changed` to the `<option>` list — remove `removed` nodes at
     * `position`, insert `added` fresh ones there, touch nothing else.
     *
     * A no-op before `connectedCallback` has built the DOM, which is what lets `model` be
     * assigned to a detached element: the state keeps the model and the connect path
     * renders it whole.
     */
    private _applyItemsChanged(change: AdwListItemsChanged): void {
        if (!this._initialized) return;
        for (let i = 0; i < change.removed; i++) this._select.remove(change.position);
        const before = this._select.options[change.position] ?? null;
        for (let i = 0; i < change.added; i++) {
            const option = this._state.model[change.position + i];
            if (option) this._select.insertBefore(this._createOption(option), before);
        }
    }

    /**
     * Build the whole `<option>` list — the CONNECT path only, where there is no previous
     * list to splice against.
     *
     * Every later assignment goes through {@link _applyItemsChanged}.
     */
    private _renderOptions(): void {
        if (!this._initialized) return;
        this._select.replaceChildren(...this._state.model.map((option) => this._createOption(option)));
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
