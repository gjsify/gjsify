// AdwEntryRow — a Libadwaita-style inline entry row for NativeScript.
//
// Extends {@link AdwActionRow} but RESTRUCTURES column 0 into the signature
// `Adw.EntryRow` look: the title doubles as placeholder text above a REAL
// NativeScript `TextField`, with the pencil / caps-lock indicator / apply button
// cluster in the suffix column.
//
// The DERIVATION behind all of that — `update_empty`'s five-output truth table,
// the `text_changed` apply latch, character-counted max-length truncation and
// the two-way return-key dispatch — is HEADLESS and lives in
// `@gjsify/adwaita-core` (ADR 0004) as {@link EntryRowState}. This class composes
// it and keeps only the NS render half; the painting itself sits in
// `entry-row-view.ts` (free of `@nativescript/core` value imports) so the spec
// suite can drive the REAL applier off-device. `@gjsify/adwaita-web` composes the
// same state machine, so both ports share one behaviour and are held to one
// table (`@gjsify/adwaita-core/conformance`).
//
// COMPROMISES on this port, all of them CSS-subset limits rather than logic:
// libadwaita cross-fades the two titles over 150 ms — NS has no transform or
// animation in CSS, so they swap at the animation's endpoints; there is no
// insensitive widget state, so the desensitized pencil is an opacity; and the
// caps-lock indicator slot is filled by the password subclass, which
// falls back to `dialog-warning-symbolic` because `caps-lock-symbolic` is not
// in the vendored `@gjsify/adwaita-icons` theme.
//
// Reference: refs/libadwaita/src/adw-entry-row.c, adw-entry-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, TextField, type EventData, type View } from '@nativescript/core';
import { documentEditSymbolic, objectSelectSymbolic } from '@gjsify/adwaita-icons/actions';
import { EntryRowState, type EntryRowRenderState } from '@gjsify/adwaita-core';

import { AdwActionRow } from './adw-action-row.js';
import { AdwIcon } from './adw-icon.js';
import { AdwImageButton } from './adw-image-button.js';
import { NS_EDIT_ICON_CLASS, NS_ENTRY_ROW_CLASS, applyEntryRowState } from './entry-row-view.js';

// Re-exported so consumers reach the headless state machine (and the vector-driven
// painter) from `@gjsify/adwaita-nativescript` without a second import path.
export { EntryRowState } from '@gjsify/adwaita-core';
export type { EntryRowRenderState, EntryRowActivation } from '@gjsify/adwaita-core';

/** Event name emitted when {@link AdwEntryRow.text} changes. Mirrors GObject `notify::text`. */
export const NOTIFY_TEXT = 'notify::text';

/** Event name emitted when the character count changes — `on_length_changed` (adw-entry-row.c:268-273). */
export const NOTIFY_TEXT_LENGTH = 'notify::text-length';

/** Event name emitted by the apply button, or by the return key while it shows — `AdwEntryRow::apply` (C:240). */
export const SIGNAL_APPLY = 'apply';

/** Event name emitted by the return key when there is nothing to apply — `AdwEntryRow::entry-activated` (C:256). */
export const SIGNAL_ENTRY_ACTIVATED = 'entry-activated';

/** Payload of the `notify::text` event. */
export interface NotifyTextEventData extends EventData {
    /** The new text value. */
    text: string;
}

/** Payload of the `notify::text-length` event. */
export interface NotifyTextLengthEventData extends EventData {
    /** The new number of CHARACTERS (not UTF-16 units). */
    textLength: number;
}

/** Payload of the `entry-activated` event. */
export interface EntryActivatedEventData extends EventData {
    /**
     * Whether the host must activate its default action FIRST — the C calls
     * `gtk_widget_activate_default` on line 254 and emits the signal on line 256,
     * and NS has no default-widget concept, so the ordering becomes the host's.
     */
    activateDefault: boolean;
}

export class AdwEntryRow extends AdwActionRow {
    /** The headless `update_empty` derivation + apply latch (ADR 0004). */
    protected readonly _state = new EntryRowState();
    /** The TextField stacked below the title in column 0. */
    protected readonly _field: TextField;
    /** The large placeholder title (`empty_title` in adw-entry-row.ui). */
    protected readonly _emptyTitle: Label;
    /** The trailing affordance box — `Adw.EntryRow`'s suffixes BOX, not a slot. */
    protected readonly _suffixes: StackLayout;
    /** The pencil (`edit_icon`). Non-interactive, like its `can-target=False` original. */
    protected readonly _editIcon: AdwIcon;
    /** The caps-lock warning slot (`indicator`). */
    protected readonly _indicator: AdwIcon;
    /** The apply button. */
    protected readonly _applyButton: AdwImageButton;
    /** The suffix installed through the inherited single-slot {@link setSuffix}. */
    private _slotSuffix: View | null = null;
    private _lastText = '';
    private _lastLength = 0;

    constructor() {
        super();

        // NOTE: `className` is NOT set here — the render below owns it, because
        // the `focused` / `empty` state classes ride on the same string and a
        // subclass contributes its own base through `_baseClassName`.

        // EntryRow look: TWO titles stacked above the field, exactly like
        // adw-entry-row.ui. `empty_title` is the large placeholder shown while
        // the row is empty; the inherited title shrinks to the small floating
        // label above the value.
        this._titleLabel.className = 'adw-row-title adw-entry-title';
        const emptyTitle = new Label();
        emptyTitle.className = 'adw-row-title adw-entry-empty-title';
        emptyTitle.textWrap = true;
        this._textStack.insertChild(emptyTitle, 0);
        this._emptyTitle = emptyTitle;

        const field = new TextField();
        field.className = 'adw-entry-field';
        // Android's Material TextField draws a bottom underline; Adwaita EntryRow
        // has none (just the floating title + the value text). Strip it by making
        // the field chrome-less — transparent background, no border.
        field.set('backgroundColor', 'transparent');
        field.set('borderWidth', 0);
        this._textStack.addChild(field);
        this._field = field;

        // The trailing cluster. libadwaita snapshots indicator → apply → pencil
        // inside the editable area (C:429-431) and puts the suffixes box after
        // it; here one horizontal box carries both, in that order, so a consumer
        // suffix lands last instead of replacing anything.
        const suffixes = new StackLayout();
        suffixes.orientation = 'horizontal';
        suffixes.className = 'adw-entry-row-suffixes';
        this._suffixes = suffixes;

        // The indicator slot starts EMPTY: upstream's `AdwEntryRow` has no icon
        // of its own either — `AdwPasswordEntryRow` fills it in (C:169-171).
        // Its visibility (and the apply button's) comes from the first render
        // below, which reproduces `adw_entry_row_init`'s C:764-765 hidden start.
        const indicator = new AdwIcon();
        indicator.className = 'adw-icon adw-entry-indicator';
        suffixes.addChild(indicator);
        this._indicator = indicator;

        // `adw-entry-apply-symbolic` is a libadwaita-internal icon; the checkmark
        // from the vendored theme is its counterpart.
        const applyButton = new AdwImageButton();
        applyButton.className = `${applyButton.className} adw-entry-apply`.trim();
        applyButton.icon = objectSelectSymbolic;
        applyButton.addEventListener('tap', () => this.apply());
        suffixes.addChild(applyButton);
        this._applyButton = applyButton;

        const editIcon = new AdwIcon();
        editIcon.className = NS_EDIT_ICON_CLASS;
        editIcon.icon = documentEditSymbolic;
        suffixes.addChild(editIcon);
        this._editIcon = editIcon;

        super.setSuffix(suffixes);

        this._field.addEventListener('textChange', () => {
            // Route through the core so max-length truncation counts CHARACTERS.
            this._state.setText(this._field.text ?? '');
        });
        // `text_state_flags_changed_cb` (C:176-189) — the focus input the whole
        // derivation hangs off. The NS CSS subset cannot express `:focus-within`,
        // so this headless flag is the ONLY route to focus feedback on this port.
        this._field.addEventListener('focus', () => this._state.setEditing(true));
        this._field.addEventListener('blur', () => this._state.setEditing(false));
        this._field.addEventListener('returnPress', () => this._activate());

        this._lastText = this._state.text;
        this._lastLength = this._state.textLength;
        this._render(this._state.state);
        this._state.subscribe((state) => this._onStateChanged(state));
    }

    /** The editable text. */
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

    /** `Adw.EntryRow:activates-default` — reported on `entry-activated`, acted on by the host. */
    get activatesDefault(): boolean {
        return this._state.activatesDefault;
    }

    set activatesDefault(value: boolean) {
        this._state.setActivatesDefault(value);
    }

    /** Whether the field currently has focus. */
    get editing(): boolean {
        return this._state.editing;
    }

    /**
     * Append a suffix — `adw_entry_row_add_suffix` (adw-entry-row.c:885-899),
     * which appends into a BOX so suffixes COEXIST.
     */
    addSuffix(view: View): void {
        view.className = `${view.className ?? ''} adw-row-suffix`.trim();
        this._suffixes.addChild(view);
    }

    /**
     * The inherited single-slot API, kept working for existing consumers: it
     * replaces only the suffix a previous `setSuffix` installed.
     *
     * `AdwActionRow.setSuffix` removes whatever sat in the slot, which detached
     * the password row's own peek toggle the moment a consumer set a suffix —
     * while `_peekButton` kept pointing at the detached view, so the row could
     * never be revealed again. Upstream has no such conflict because there is no
     * single slot: `add_suffix` appends.
     */
    override setSuffix(view: View | null): void {
        if (this._slotSuffix) {
            this._suffixes.removeChild(this._slotSuffix);
            this._slotSuffix = null;
        }
        if (view) {
            this.addSuffix(view);
            this._slotSuffix = view;
        }
    }

    /** The suffix installed through {@link setSuffix}, or `null`. */
    override get suffix(): View | null {
        return this._slotSuffix;
    }

    /**
     * Drive the trailing indicator — `adw_entry_row_set_show_indicator`
     * (adw-entry-row-private.h, C:1281-1296). Private-to-the-library upstream,
     * public here because `AdwPasswordEntryRow` composes rather than reaching
     * into a private header.
     */
    setShowIndicator(show: boolean): void {
        this._state.setShowIndicator(show);
    }

    /** `adw_entry_row_set_indicator_icon_name` (C:1263-1273), as an Adwaita symbolic SVG. */
    setIndicatorIcon(svg: string): void {
        this._indicator.icon = svg;
    }

    /** Apply the pending edit — the apply button tap (C:229-241). */
    apply(): void {
        this._state.apply();
        this.notify({ eventName: SIGNAL_APPLY, object: this });
    }

    /** `text_activated_cb` (C:243-266) — exactly one of the two signals. */
    private _activate(): void {
        const activation = this._state.activate();
        if (activation.signal === 'apply') {
            this.notify({ eventName: SIGNAL_APPLY, object: this });
            return;
        }
        const data: EntryActivatedEventData = {
            eventName: SIGNAL_ENTRY_ACTIVATED,
            object: this,
            activateDefault: activation.activateDefault,
        };
        this.notify(data);
    }

    /** Paint one render snapshot through the shared (spec-driven) painter. */
    protected _render(state: EntryRowRenderState): void {
        applyEntryRowState(
            {
                row: this,
                emptyTitle: this._emptyTitle,
                title: this._titleLabel,
                field: this._field,
                editIcon: this._editIcon,
                indicator: this._indicator,
                applyButton: this._applyButton,
            },
            state,
            this._baseClassName,
        );
    }

    /** Base class list this row paints its state classes onto. */
    protected get _baseClassName(): string {
        return NS_ENTRY_ROW_CLASS;
    }

    private _onStateChanged(state: EntryRowRenderState): void {
        this._render(state);

        if (state.text !== this._lastText) {
            this._lastText = state.text;
            const data: NotifyTextEventData = { eventName: NOTIFY_TEXT, object: this, text: state.text };
            this.notify(data);
        }
        if (state.textLength !== this._lastLength) {
            this._lastLength = state.textLength;
            const data: NotifyTextLengthEventData = {
                eventName: NOTIFY_TEXT_LENGTH,
                object: this,
                textLength: state.textLength,
            };
            this.notify(data);
        }
    }
}
