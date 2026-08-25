// <adw-entry-row> — A boxed-list row that is itself a text entry: the title
// doubles as placeholder text and the editable value sits inline on the row.
//
// The DERIVATION behind all of that — `update_empty`'s five-output truth table,
// the `text_changed` apply latch with both of its reset paths, character-counted
// max-length truncation and the two-way <kbd>Enter</kbd> dispatch — is HEADLESS
// and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link EntryRowState}. This
// element composes it and keeps only the DOM half; `@gjsify/adwaita-nativescript`
// composes the same state machine, so both ports share one behaviour and are
// held to one table (`@gjsify/adwaita-core/conformance`).
//
// Attributes: title, text, editable, max-length, show-apply-button,
//   activates-default. `text-length` is REFLECTED (read-only, mirrors
//   `Adw.EntryRow:text-length`).
// Properties: text, editable, maxLength, textLength, showApplyButton,
//   activatesDefault, editing.
// Events:
//   `changed` + `notify::text` — every buffer change. libadwaita implements
//     GtkEditable through a delegate, so it emits BOTH spellings and so does this:
//     code written against either runs against the other.
//   `notify::text-length` — `on_length_changed`.
//   `apply` — the apply button, or Enter while it shows.
//   `entry-activated` — Enter otherwise, AFTER the default was activated.
//
// Reference: refs/libadwaita/src/adw-entry-row.c, adw-entry-row.ui
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/entryrow.md
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// edit icon node is <adw-icon>.

import {
    ENTRY_ROW_APPLY_ICON_NAME,
    ENTRY_ROW_APPLY_TOOLTIP,
    ENTRY_ROW_EDIT_ICON_NAME,
    EntryRowState,
    type EntryRowRenderState,
} from '@gjsify/adwaita-core';

import { bindSlottedChildren, type AdwSlottedChildren } from '../slotted-children.js';
import { type AdwIcon, createAdwIcon } from './adw-icon.js';

/**
 * Show/hide a rendered part. `hidden` carries the semantics and is what the conformance
 * suite reads, but author CSS beats the UA `[hidden]` rule: `.adw-icon` ships its own
 * `&[hidden]` override in `_icon.scss` and `.adw-button` does not, so a hidden apply
 * button would still paint without the inline `display`.
 */
function setPartVisible(part: HTMLElement, visible: boolean): void {
    part.hidden = !visible;
    part.style.display = visible ? '' : 'none';
}

/** Read a boolean attribute the HTML way, with an explicit `="false"` opt-out. */
function boolAttribute(value: string | null): boolean {
    return value !== null && value !== 'false';
}

export class AdwEntryRow extends HTMLElement {
    /** The headless `update_empty` derivation + apply latch (ADR 0004). */
    protected readonly _state = new EntryRowState();
    protected _input!: HTMLInputElement;
    /** The large placeholder title (`empty_title` in adw-entry-row.ui). */
    protected _emptyTitle!: HTMLSpanElement;
    /** The small label above the value (`title` in adw-entry-row.ui). */
    protected _title!: HTMLSpanElement;
    /** The `editable-area` gizmo: both titles plus the input. */
    protected _area!: HTMLDivElement;
    protected _editIcon!: AdwIcon;
    protected _indicator!: HTMLSpanElement;
    protected _applyButton!: HTMLButtonElement;
    protected _prefixes!: HTMLDivElement;
    protected _suffixes!: HTMLDivElement;
    protected _initialized = false;
    /**
     * The two slots, installed after `_onConnected` rather than inside `_build`: the order
     * IS the contract — see the `install` call in `connectedCallback`.
     */
    private _slots!: AdwSlottedChildren;
    private _lastText = '';
    private _lastLength = 0;

    static get observedAttributes(): string[] {
        return ['title', 'text', 'editable', 'max-length', 'show-apply-button', 'activates-default'];
    }

    /**
     * Class-name prefix for this row's parts. `<adw-password-entry-row>`
     * overrides it so `_password_entry_row.scss` keeps matching its own parts —
     * the two SCSS partials are near-identical but each scopes to its own tag.
     */
    protected get _classPrefix(): string {
        return 'adw-entry-row';
    }

    get text(): string {
        return this._state.text;
    }

    set text(value: string) {
        this._state.setText(value ?? '');
    }

    /** `Adw.EntryRow:text-length` — the number of CHARACTERS, not UTF-16 units. */
    get textLength(): number {
        return this._state.textLength;
    }

    /** `Adw.EntryRow:max-length` — maximum number of characters, `0` = unlimited. */
    get maxLength(): number {
        return this._state.maxLength;
    }

    set maxLength(value: number) {
        this._state.setMaxLength(value);
    }

    /** Whether the entry accepts edits (`GtkEditable:editable`). */
    get editable(): boolean {
        return this._state.editable;
    }

    set editable(value: boolean) {
        this._state.setEditable(value);
    }

    /** `Adw.EntryRow:show-apply-button` — typing reveals an apply button. */
    get showApplyButton(): boolean {
        return this._state.showApplyButton;
    }

    set showApplyButton(value: boolean) {
        this._state.setShowApplyButton(value);
    }

    /** `Adw.EntryRow:activates-default` — Enter may submit the surrounding form. */
    get activatesDefault(): boolean {
        return this._state.activatesDefault;
    }

    set activatesDefault(value: boolean) {
        this._state.setActivatesDefault(value);
    }

    get editing(): boolean {
        return this._state.editing;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._build();

        // Seed from the attributes BEFORE subscribing, so building the initial
        // DOM is not driven by change notifications (the adw-spin-row pattern).
        // `text` is only taken when the attribute is present, so a property set
        // before the element was connected survives.
        this._state.setMaxLength(Number.parseInt(this.getAttribute('max-length') ?? '', 10));
        this._state.setEditable(this.getAttribute('editable') !== 'false');
        this._state.setShowApplyButton(boolAttribute(this.getAttribute('show-apply-button')));
        this._state.setActivatesDefault(boolAttribute(this.getAttribute('activates-default')));
        if (this.hasAttribute('text')) this._state.setText(this.getAttribute('text') ?? '');
        this._renderTitle();

        // Subclass parts first, THEN the author's children: `AdwPasswordEntryRow` installs
        // its peek toggle from its own `init`, so a consumer suffix lands after it and both
        // remain. That ordering is why the structure is installed HERE and not at the end of
        // `_build` — `install` routes the author's children on its way, and doing it a phase
        // earlier would put every declared suffix in front of the password row's toggle.
        this._onConnected();
        this._slots.install(
            this._prefixes,
            this._area,
            this._indicator,
            this._applyButton,
            this._editIcon,
            this._suffixes,
        );

        this._lastText = this._state.text;
        this._lastLength = this._state.textLength;
        this._render(this._state.state);
        this._state.subscribe((state) => this._onStateChanged(state));
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        switch (name) {
            case 'title':
                this._renderTitle();
                break;
            case 'text':
                this._state.setText(value ?? '');
                break;
            case 'editable':
                this._state.setEditable(value !== 'false');
                break;
            case 'max-length':
                this._state.setMaxLength(Number.parseInt(value ?? '', 10));
                break;
            case 'show-apply-button':
                this._state.setShowApplyButton(boolAttribute(value));
                break;
            case 'activates-default':
                this._state.setActivatesDefault(boolAttribute(value));
                break;
        }
    }

    /**
     * Add a widget after the editable area — `adw_entry_row_add_suffix`, which APPENDS
     * into a box, so several suffixes coexist and the password row's own peek toggle
     * survives a consumer's.
     */
    addSuffix(node: Node): void {
        this._suffixes.append(node);
        setPartVisible(this._suffixes, true);
    }

    /**
     * Add a widget before the editable area — `adw_entry_row_add_prefix`. PREPENDS, like
     * the `gtk_box_prepend` it mirrors, so several prefixes stack in reverse call order
     * exactly as they do in GTK.
     */
    addPrefix(node: Node): void {
        this._prefixes.prepend(node);
        setPartVisible(this._prefixes, true);
    }

    /**
     * Drive the trailing indicator — `adw_entry_row_set_show_indicator`
     * (adw-entry-row-private.h). Private-to-the-library upstream, public here because
     * `<adw-password-entry-row>` is a separate custom element rather than a C subclass
     * with access to the private header.
     */
    setShowIndicator(show: boolean): void {
        this._state.setShowIndicator(show);
    }

    /** `adw_entry_row_set_indicator_icon_name`. */
    setIndicatorIconName(iconName: string): void {
        this._indicator.dataset.iconName = iconName;
    }

    /** `adw_entry_row_set_indicator_tooltip`. */
    setIndicatorTooltip(tooltip: string): void {
        this._indicator.title = tooltip;
        this._indicator.setAttribute('aria-label', tooltip);
    }

    /** Apply the pending edit — the apply button click. */
    apply(): void {
        this._state.apply();
        this.dispatchEvent(new CustomEvent('apply', { bubbles: true }));
    }

    /** Focus the entry without selecting — `adw_entry_row_grab_focus_without_selecting`. */
    grabFocusWithoutSelecting(): boolean {
        this._input.focus();
        return this._state.editing;
    }

    /** Subclass hook: runs after the DOM exists and the state is seeded, before the first render. */
    protected _onConnected(): void {}

    private _build(): void {
        const prefix = this._classPrefix;

        this._prefixes = document.createElement('div');
        this._prefixes.className = `${prefix}-prefixes`;
        this._suffixes = document.createElement('div');
        this._suffixes.className = `${prefix}-suffixes`;

        // TWO title labels, exactly like adw-entry-row.ui: `empty_title` is the large
        // placeholder shown while the row is empty, `title` the small label above the
        // value. GTK cross-fades them over EMPTY_ANIMATION_DURATION_MS; here it is a hard
        // swap at the two animation endpoints, which is why the render reads
        // `emptyTarget`.
        this._emptyTitle = document.createElement('span');
        this._emptyTitle.className = `adw-row-title ${prefix}-empty-title`;
        this._title = document.createElement('span');
        // `adw-row-title` is what the SCSS styles; the prefixed class is how the
        // conformance suite tells the two titles apart.
        this._title.className = `adw-row-title ${prefix}-title`;

        this._input = document.createElement('input');
        this._input.className = `${prefix}-input`;
        this._input.type = 'text';
        this._input.addEventListener('input', () => {
            // Route through the core so truncation counts CHARACTERS —
            // `input.maxLength` counts UTF-16 units and is deliberately unset.
            this._state.setText(this._input.value);
            if (this._input.value !== this._state.text) this._input.value = this._state.text;
        });
        this._input.addEventListener('focus', () => this._state.setEditing(true));
        this._input.addEventListener('blur', () => this._state.setEditing(false));
        this._input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            this._activate();
        });

        this._area = document.createElement('div');
        this._area.className = `${prefix}-text`;
        this._area.append(this._emptyTitle, this._title, this._input);

        // The caps-lock warning slot. `caps-lock-symbolic` is not in the curated
        // @gjsify/adwaita-icons set, so the glyph stands in and the canonical
        // name travels in `data-icon-name` — the same fallback the dialog close
        // buttons use.
        this._indicator = document.createElement('span');
        this._indicator.className = `${prefix}-indicator`;
        this._indicator.setAttribute('role', 'img');
        this._indicator.textContent = '⇪';

        this._applyButton = document.createElement('button');
        this._applyButton.type = 'button';
        this._applyButton.className = `adw-button suggested-action circular icon-only ${prefix}-apply`;
        this._applyButton.dataset.iconName = ENTRY_ROW_APPLY_ICON_NAME;
        this._applyButton.title = ENTRY_ROW_APPLY_TOOLTIP;
        this._applyButton.setAttribute('aria-label', ENTRY_ROW_APPLY_TOOLTIP);
        this._applyButton.textContent = '✓';
        this._applyButton.addEventListener('click', () => this.apply());

        // The libadwaita name travels in `data-icon-name`; the drawn glyph is
        // the curated @gjsify/adwaita-icons spelling of the same symbolic, which
        // is a different string (`adw-entry-edit-symbolic` vs `document-edit`).
        this._editIcon = createAdwIcon('document-edit', 'adw-row-edit', `${prefix}-edit`);
        this._editIcon.dataset.iconName = ENTRY_ROW_EDIT_ICON_NAME;

        // Author-supplied light-DOM children are KEPT and stay LIVE: `replaceChildren` used
        // to discard them silently, so `<adw-entry-row><adw-button>Go</adw-button>` rendered
        // without its button, and the snapshot that fixed that was still a one-shot read — a
        // suffix appended after connect sat outside the affordance box. ELEMENTS only, on
        // both paths: GtkBuildable also only ever adopts widgets, and keeping stray
        // whitespace would make an empty affordance box measure as non-empty. Consumed
        // through the two `add*` methods, because their insertion rules differ —
        // `addPrefix` PREPENDS, mirroring `gtk_box_prepend`. Structure order:
        // indicator → apply → edit icon inside the editable area, prefixes/suffixes outside.
        // `src/slotted-children.ts` has the incident.
        this._slots = bindSlottedChildren(this, [
            { name: 'prefix', consume: (node) => this.addPrefix(node) },
            { name: 'suffix', claims: (node) => node instanceof Element, consume: (node) => this.addSuffix(node) },
        ]);
        setPartVisible(this._prefixes, false);
        setPartVisible(this._suffixes, false);

        this.addEventListener('click', (event) => this._maybeFocus(event));
    }

    /**
     * `pressed_cb`: a click landing on the row, the editable area, the indicator or
     * either affordance box grabs focus; anything else (a suffix control, the apply
     * button) is left alone. The pencil is `can-target=False` in the .ui, so a click on
     * it picks the editable area — hence it focuses too.
     */
    private _maybeFocus(event: MouseEvent): void {
        const target = event.target;
        if (
            target === this ||
            target === this._area ||
            target === this._emptyTitle ||
            target === this._title ||
            target === this._editIcon ||
            target === this._indicator ||
            target === this._prefixes ||
            target === this._suffixes
        ) {
            this._input.focus();
        }
    }

    /** `text_activated_cb` — exactly one of the two signals. */
    private _activate(): void {
        const activation = this._state.activate();
        if (activation.signal === 'apply') {
            this.dispatchEvent(new CustomEvent('apply', { bubbles: true }));
            return;
        }
        // The default widget is activated BEFORE `entry-activated`; implicit form
        // submission is the web's default-widget activation.
        if (activation.activateDefault) this.closest('form')?.requestSubmit();
        this.dispatchEvent(new CustomEvent('entry-activated', { bubbles: true }));
    }

    private _renderTitle(): void {
        const title = this.getAttribute('title') ?? '';
        this._emptyTitle.textContent = title;
        this._title.textContent = title;
    }

    /** Paint one render snapshot. Overridden (via `super`) by the password row. */
    protected _render(state: EntryRowRenderState): void {
        if (this._input.value !== state.text) this._input.value = state.text;
        this._input.readOnly = !state.editable;
        this.classList.toggle('focused', state.editing);
        this.classList.toggle('empty', state.empty);
        // The two titles are the animation's endpoints; a renderer with a real
        // cross-fade would lerp between them over EMPTY_ANIMATION_DURATION_MS.
        setPartVisible(this._emptyTitle, state.emptyTarget === 0);
        setPartVisible(this._title, state.emptyTarget === 1);
        setPartVisible(this._editIcon, state.editIconVisible);
        this._editIcon.classList.toggle('disabled', !state.editIconSensitive);
        this._editIcon.setAttribute('aria-disabled', String(!state.editIconSensitive));
        setPartVisible(this._indicator, state.indicatorVisible);
        setPartVisible(this._applyButton, state.applyButtonVisible);
        this.setAttribute('text-length', String(state.textLength));
    }

    private _onStateChanged(state: EntryRowRenderState): void {
        this._render(state);

        if (state.text !== this._lastText) {
            this._lastText = state.text;
            const detail = { text: state.text };
            this.dispatchEvent(new CustomEvent('changed', { bubbles: true, detail }));
            this.dispatchEvent(new CustomEvent('notify::text', { bubbles: true, detail }));
        }
        if (state.textLength !== this._lastLength) {
            this._lastLength = state.textLength;
            this.dispatchEvent(
                new CustomEvent('notify::text-length', { bubbles: true, detail: { textLength: state.textLength } }),
            );
        }
    }
}

customElements.define('adw-entry-row', AdwEntryRow);
