// <adw-combo-row> — row with a title/subtitle and a dropdown select. The model is a real
// `Gio.ListModel` on the PROPERTY and a JSON array in the `model` ATTRIBUTE (`["a","b"]` or
// `[{"value":"a","label":"A"}]`), `selected` an index, and the native <select> is stretched
// invisibly over the row so clicking anywhere opens it.
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
// THE PROPERTY TAKES A LIST MODEL, THE ATTRIBUTE TAKES JSON (ADR 0122). `model` is an object
// property over `Gio.ListModel`, held by identity, and an array written to it is a
// `TypeError`. The ATTRIBUTE is untouched — a `Gio.ListModel` has no attribute spelling — and
// it fills the element's own `GjsifyOptionList`, whose identity survives an edit so appending
// one option to `model='[…]'` splices rather than replacing the list and resetting the
// selection. `readModelWrite` in core is the one door both go through.
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
//   tooltip-text     — `Gtk.Widget:tooltip-text` (`src/row-tooltip.ts`).
//   title-lines      — clamp title to N lines (0 = unlimited, default)
//   subtitle-lines   — clamp subtitle to N lines (0 = unlimited, default)
// Properties — the `<gtk-drop-down>` set minus `enableSearch` and `active`, which are that
// element's own popover chrome and have no counterpart on a row that opens a native
// <select>:
//   model            — the list model, a `Gio.ListModel` (get/set), held BY IDENTITY.
//     `Adw.ComboRow:model`'s own name, per ADR 0034 clause 1; it replaced
//     `options`/`items`, which were two further spellings of one GTK property. An ARRAY is a
//     `TypeError` naming the type (ADR 0122 § 4) — `options` is the descriptor side.
//   options          — the held model's items as `{ value, label }` descriptors (get).
//   selected         — the selected index (get/set). An index past the end is IGNORED, as
//     measured in libadwaita and as on `<gtk-drop-down>`; the two selectors no longer
//     answer this differently. `ComboState.hasIndex` is where the bounds live.
//   selectedValue    — the selected option's value ('' when empty) (get/set-by-value).
//   selectedItem     — the model's own selected item, or null (get).
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

import { ComboState, deriveRowLabels, GjsifyOptionList, parseListModel, readModelWrite } from '@gjsify/adwaita-core';
import type { AdwComboOption, AdwListItemsChanged, ComboWatchableModel } from '@gjsify/adwaita-core';

import { applyRowTooltip } from '../row-tooltip.js';
import { bindSlottedChildren } from '../slotted-children.js';
import { stringListSlot } from '../string-list-slot.js';
import { applyRowLineClamp, parseRowLinesAttribute } from '../row-line-clamp.js';
import { TooltipElement } from '../widget-element.js';

export class AdwComboRow extends TooltipElement {
    private _select!: HTMLSelectElement;
    private _valueEl!: HTMLSpanElement;
    /** The label column — kept for `tooltip-text`, which the browser reads off a PART. */
    private _textEl!: HTMLDivElement;
    private _titleEl!: HTMLSpanElement;
    private _subtitleEl!: HTMLSpanElement;
    /** The headless options list + selectedIndex↔selectedValue state machine (ADR 0004). */
    private readonly _state = new ComboState();
    /**
     * The list the MARKUP doors fill — the `model` ATTRIBUTE is JSON text and a
     * `<gtk-string-list slot="model">` child is strings, and a real `Gio.ListModel` has no
     * spelling in either (ADR 0122 § 5). Held for the element's whole life so re-parsing the
     * attribute splices the list the element already points at rather than replacing it, which
     * would reset the selection.
     */
    private readonly _authored = GjsifyOptionList.new(null);
    private _initialized = false;

    static get observedAttributes() {
        return ['title', 'subtitle', 'model', 'selected', 'tooltip-text', 'title-lines', 'subtitle-lines'];
    }

    /**
     * The list model (`Adw.ComboRow:model`) — the OBJECT that was assigned, by identity, as
     * `row.model === model` is measured to hold in libadwaita (ADR 0122 § 4). The normalised
     * descriptors are {@link options}. Assigning splices the `<select>` and re-runs autoselect.
     */
    get model(): ComboWatchableModel | null {
        return this._state.model;
    }

    set model(value: ComboWatchableModel | string | null) {
        // ONE door for every surface: a real model by identity, `null` for none, a STRING for
        // the `model` attribute (JSON), and a `TypeError` in the property's own words for
        // anything else, an array included.
        this._state.setModel(readModelWrite(value, this._authored));
    }

    /** The held model's items as `{ value, label }` descriptors. */
    get options(): AdwComboOption[] {
        return this._state.options;
    }

    /** `adw_combo_row_set_model`. */
    set_model(model: ComboWatchableModel | null): void {
        this.model = model;
    }

    /** `adw_combo_row_get_model`. */
    get_model(): ComboWatchableModel | null {
        return this.model;
    }

    /**
     * The selected index (Adw.ComboRow:selected). An index past the end is IGNORED — the
     * selection stays where it was, which is what libadwaita is measured to do (ADR 0122 § 4,
     * `combo-probe2.js`) and what `<gtk-drop-down>` already did. This element used to ACCEPT
     * such a set and read back an empty {@link selectedValue}, the one row of
     * `COMBO_SELECTION_VECTORS` the two selectors answered differently; the permissive half
     * was ours, not GTK's, and it is gone. `ComboState.hasIndex` owns the bounds.
     */
    get selected(): number {
        return this._initialized ? this._state.selectedIndex : parseInt(this.getAttribute('selected') || '0', 10);
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    get_selected(): number {
        return this.selected;
    }

    set_selected(position: number): void {
        this.selected = position;
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

    /**
     * The selected ITEM, or `null` (Adw.ComboRow:selected-item).
     *
     * Read-only, as the GObject property is, and the MODEL'S OWN object rather than a
     * descriptor, so the identity comparison a `selected-item` consumer writes holds (ADR
     * 0122 § 4). `null` and not a blank item: the sentinel and an index past the end both
     * address no option, and inventing an empty one would make "nothing is selected"
     * indistinguishable from an option with no text.
     */
    get selectedItem(): unknown {
        return this._state.selectedItem;
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
        const text = document.createElement('div');
        text.className = 'adw-row-text';
        this._textEl = text;
        this._titleEl = document.createElement('span');
        this._titleEl.className = 'adw-row-title';
        this._subtitleEl = document.createElement('span');
        this._subtitleEl.className = 'adw-row-subtitle';
        text.append(this._titleEl, this._subtitleEl);

        this._valueEl = document.createElement('span');
        this._valueEl.className = 'adw-row-value';

        this._select = document.createElement('select');

        // A `<gtk-string-list slot="model">` child is the list a `.blp` authored (ADR 0072),
        // consumed here BEFORE the attribute seed below, so the seed sees a model and leaves
        // it alone, and before the selection, so an authored index lands on the real list.
        // The slot hands over DESCRIPTORS, which the authored list adopts — the same list the
        // `model` attribute fills, because the two are one markup door and an author who wrote
        // both should not get two lists.
        bindSlottedChildren(this, [
            stringListSlot((options) => {
                this._authored.reconcile(options);
                this._state.setModel(this._authored);
            }),
        ]).install(text, this._valueEl, this._select);
        // Two tests, and both are needed. `model === null` and no longer "holds no items" is
        // the test for "the slot above did not already set it": a model is an object now, so
        // an EMPTY one is a model the author meant and the count test would have thrown it
        // away. The ATTRIBUTE'S PRESENCE is the test for whether to seed at all — a fresh
        // widget with no authored model has `model === null`, as GTK's does, and seeding the
        // empty authored list unconditionally would hand every unconfigured row a model.
        const authoredModel = this.getAttribute('model');
        if (this._state.model === null && authoredModel !== null) {
            this._authored.reconcile(parseListModel(authoredModel));
            this._state.setModel(this._authored);
        }
        this._state.setSelectedIndex(parseInt(this.getAttribute('selected') || '0', 10));

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
            this.model = value;
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
        // Read ONCE: `options` hands back a copy (ADR 0046), so reading it per item would make
        // a splice of n items O(n²) instead of the O(n) the splice is.
        const options = this._state.options;
        for (let i = 0; i < change.added; i++) {
            const option = options[change.position + i];
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
        this._select.replaceChildren(...this._state.options.map((option) => this._createOption(option)));
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
        // The <select> is stretched over the whole row (`position: absolute; inset: 0`,
        // `_combo_row.scss`), so it is what the pointer actually lands on — the label column
        // has `pointer-events: none`. A tooltip on the label parts alone would therefore
        // never be reached over the title half of the row.
        applyRowTooltip(this, [this._textEl, this._valueEl, this._select]);
        this._applyLineClamping();
    }

    /** Apply CSS line-clamping based on title-lines/subtitle-lines attributes. */
    private _applyLineClamping(): void {
        applyRowLineClamp({
            titleEl: this._titleEl,
            subtitleEl: this._subtitleEl,
            textContainerEl: this._titleEl.parentElement!,
            getTitleLines: () => parseRowLinesAttribute(this.getAttribute('title-lines')),
            getSubtitleLines: () => parseRowLinesAttribute(this.getAttribute('subtitle-lines')),
        });
    }
}

customElements.define('adw-combo-row', AdwComboRow);
