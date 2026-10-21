// AdwEntryRow — a Libadwaita-style inline entry row for NativeScript.
//
// Extends {@link AdwActionRow} but RESTRUCTURES column 0 into the signature
// `Adw.EntryRow` look: the title doubles as placeholder text above a REAL
// NativeScript `TextField`, with the pencil / caps-lock indicator / apply button
// cluster in the suffix column.
//
// The DERIVATION — `update_empty`'s five-output truth table, the `text_changed`
// apply latch, character-counted max-length truncation, the two-way return-key
// dispatch — is HEADLESS in `@gjsify/adwaita-core` (ADR 0004) as the pure functions
// `deriveEntryRowState` / `entryRowLatches` / `clampEntryText` /
// `resolveEntryRowActivation`, shared with `@gjsify/adwaita-web` and held to one
// conformance table. This class keeps only the NS render half; the painting sits in
// `entry-row-view.ts` (free of `@nativescript/core` value imports) so the spec suite
// can drive the REAL applier off-device.
//
// THE SIX PROPERTIES ARE DECLARED, NOT HELD IN AN `EntryRowState` (ADR 0105 § 2, route D).
// `text`, `text-length`, `max-length`, `editable`, `show-apply-button` and
// `activates-default` are GObject properties of this class, so on Android they live in the
// GObject's own store — which is what `bind_property` binds to and what `NodeGiGetProperty`
// reads. Keeping an `EntryRowState` beside them would be the defect `adw-switch-row.ts`
// names: two stores, one of them stale. What the state object DID own that a property cannot
// — the `update_empty` table and the latch rule — moved into `@gjsify/adwaita-core` as
// functions, so there is still exactly one copy of the derivation and the conformance
// vectors still drive it. `EntryRowState` stays in the core for `@gjsify/adwaita-web`.
//
// `text-length` IS READ-ONLY, AND ITS NORMALIZER IS HOW. Upstream declares it
// `G_PARAM_READABLE` only; this seam has no read-only flag, so the property's `normalize`
// derives the value from the row's OWN `text` and ignores what was written. A write
// therefore resolves to the value already held, the equal-write rule drops it, and the only
// thing that can move it is `text` moving — which is what read-only means here.
//
// WHAT THE THREE EVENT PAYLOADS BECAME. `NotifyTextEventData` / `NotifyTextLengthEventData`
// carried the new value; a real `notify::` carries a `GParamSpec`, never a value, so a
// handler reads the emitter — `(self) => self.text`. `EntryActivatedEventData` carried
// `activateDefault`, which was only ever this row's own `activates-default`: upstream's
// `AdwEntryRow::entry-activated` takes no parameters, and the value a handler wants is on
// the emitter too. All three are gone rather than kept as aliases — this port carries no
// backward compatibility (`status/open-todos/nativescript.md`).
//
// COMPROMISES, all CSS-subset limits rather than logic: the two titles swap at the
// endpoints instead of cross-fading (no transform or animation in NS CSS); there is
// no insensitive widget state, so the desensitized pencil is an opacity; and the
// caps-lock indicator falls back to `dialog-warning-symbolic`, because
// `caps-lock-symbolic` is not in the vendored `@gjsify/adwaita-icons` theme.
//
// Reference: refs/libadwaita/src/adw-entry-row.c, adw-entry-row.ui
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Label, StackLayout, TextField, type View } from '@nativescript/core';
import { documentEditSymbolic, objectSelectSymbolic } from '@gjsify/adwaita-icons/actions';
import {
    ADW_ACCENT_FG_COLOR,
    clampEntryMaxLength,
    clampEntryText,
    deriveEntryRowState,
    entryRowLatches,
    entryTextLength,
    resolveEntryRowActivation,
    type EntryRowRenderState,
} from '@gjsify/adwaita-core';

import { AdwActionRow } from './adw-action-row.js';
import { GtkImage } from './gtk-image.js';
import { AdwImageButton } from './adw-image-button.js';
import { NS_EDIT_ICON_CLASS, NS_ENTRY_ROW_CLASS, applyEntryRowState } from './entry-row-view.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { readDeclaredValue, withProperties } from './signals.js';

// Re-exported so consumers reach the vector-driven painter's vocabulary from
// `@gjsify/adwaita-nativescript` without a second import path.
export type { EntryRowRenderState, EntryRowActivation } from '@gjsify/adwaita-core';

/** Event name emitted when {@link AdwEntryRow.text} changes. Mirrors GObject `notify::text`. */
export const NOTIFY_TEXT = 'notify::text';

/** Event name emitted when the character count changes. */
export const NOTIFY_TEXT_LENGTH = 'notify::text-length';

/** Event name emitted when {@link AdwEntryRow.maxLength} changes. */
export const NOTIFY_MAX_LENGTH = 'notify::max-length';

/** Event name emitted when {@link AdwEntryRow.editable} changes. */
export const NOTIFY_EDITABLE = 'notify::editable';

/** Event name emitted when {@link AdwEntryRow.showApplyButton} changes. */
export const NOTIFY_SHOW_APPLY_BUTTON = 'notify::show-apply-button';

/** Event name emitted when {@link AdwEntryRow.activatesDefault} changes. */
export const NOTIFY_ACTIVATES_DEFAULT = 'notify::activates-default';

/** `AdwEntryRow::apply` — the apply button, or the return key while it shows. */
export const SIGNAL_APPLY = 'apply';

/**
 * `AdwEntryRow::entry-activated` — the return key when there is nothing to apply.
 *
 * No parameters, as upstream declares it. The C activates the default widget itself before
 * emitting and NativeScript has no default-widget concept, so that ordering is the host's
 * here — and what it needs to know is the row's own `activates-default`, which a handler
 * reads off the emitter: `(self) => self.activatesDefault`.
 */
export const SIGNAL_ENTRY_ACTIVATED = 'entry-activated';

/**
 * The row a declared property's {@link DeclaredProperty.normalize} reads its siblings off.
 * Structural, because `normalize` is handed a bare `object` — the seam knows nothing of this
 * class, and a cast to `AdwEntryRow` would be a lie while the instance is still constructing.
 */
interface EntryRowValues {
    readonly text: string;
    readonly maxLength: number;
}

export class AdwEntryRow extends withProperties(AdwActionRow, {
    GTypeName: 'AdwEntryRow',
    Properties: {
        text: {
            kind: 'string',
            default: '',
            blurb: 'The entry text',
            // Truncation belongs HERE and not in a `notify::text` handler: a handler runs
            // after the store already took the over-long value, and a refusal or a rewrite
            // from one cannot be seen at all (see `signals.ts` on logged handler exceptions).
            normalize: (value, self) => clampEntryText(String(value ?? ''), (self as EntryRowValues).maxLength),
        },
        'text-length': {
            kind: 'uint',
            default: 0,
            blurb: 'The length of the text, in characters',
            // Read-only upstream, and read-only here BY DERIVATION — see the module header.
            normalize: (_value, self) => entryTextLength((self as EntryRowValues).text),
        },
        'max-length': {
            kind: 'int',
            default: 0,
            blurb: 'The maximum length of the text, in characters',
            // `readDeclaredValue` first, so `<AdwEntryRow maxLength="12">` reads the same as
            // on a property with no normalizer at all; the clamp is what this one ADDS.
            normalize: (value) => clampEntryMaxLength(readDeclaredValue('max-length', 'int', value) as number),
        },
        editable: { kind: 'boolean', default: true, blurb: 'Whether the entry is editable' },
        'show-apply-button': { kind: 'boolean', default: false, blurb: 'Whether to show the apply button' },
        'activates-default': {
            kind: 'boolean',
            default: false,
            blurb: 'Whether activating the embedded entry can activate the default widget',
        },
    },
    Signals: {
        apply: {},
        'entry-activated': {},
    },
}) {
    static readonly GTypeName: string = 'AdwEntryRow';

    /** `AdwEntryRow` derives from `AdwPreferencesRow` in C, so the preferences search
     *  must NOT read the text typed into it. */
    override readonly isActionRow: boolean = false;

    /** The editable text, truncated to {@link maxLength} by the property's normalizer. */
    declare text: string;

    /**
     * `Adw.EntryRow:text-length` — the number of CHARACTERS, not UTF-16 units.
     *
     * READ-ONLY, as upstream declares it: a write is normalized back to the count derived from
     * this row's own {@link text}, so it resolves to the value already held and changes nothing
     * (module header). Not `readonly` in TypeScript, because the seam installs one accessor pair
     * per declared property and the row itself is what writes the derived value.
     */
    declare textLength: number;

    /** `Adw.EntryRow:max-length` — maximum number of characters, `0` = unlimited. */
    declare maxLength: number;

    /** Whether the entry accepts edits (`GtkEditable:editable`). */
    declare editable: boolean;

    /** `Adw.EntryRow:show-apply-button` — typing reveals an apply button. */
    declare showApplyButton: boolean;

    /** `Adw.EntryRow:activates-default` — read by the host on `entry-activated`. */
    declare activatesDefault: boolean;

    /**
     * `priv->editing` — whether the embedded entry has focus. A private field and NOT a declared
     * property, because it is not one upstream either: `text_state_flags_changed_cb` keeps it,
     * nothing outside the widget may set it, and the focus events below are its only writers.
     */
    private _editing = false;
    /** The private `adw_entry_row_set_show_indicator` hook's state — see {@link setShowIndicator}. */
    private _showIndicator = false;
    /** `priv->text_changed` — the pending-apply latch. Private upstream too. */
    private _textChanged = false;
    /** The TextField stacked below the title in column 0. */
    protected readonly _field: TextField;
    /** The large placeholder title (`empty_title` in adw-entry-row.ui). */
    protected readonly _emptyTitle: Label;
    /** The trailing affordance box — `Adw.EntryRow`'s suffixes BOX, not a slot. */
    protected readonly _suffixes: StackLayout;
    /** The pencil (`edit_icon`). Non-interactive, like its `can-target=False` original. */
    protected readonly _editIcon: GtkImage;
    /** The caps-lock warning slot (`indicator`). */
    protected readonly _indicator: GtkImage;
    protected readonly _applyButton: AdwImageButton;
    /** The suffix installed through the inherited single-slot {@link add_suffix}. */
    private _slotSuffix: View | null = null;

    constructor(props?: ConstructProps<AdwEntryRow>) {
        super();

        // `className` is NOT set here — the render below owns it, because the
        // `focused` / `empty` state classes ride on the same string and a subclass
        // contributes its own base through `_baseClassName`.

        // TWO titles stacked above the field, as in adw-entry-row.ui: `empty_title` is
        // the large placeholder shown while the row is empty, the inherited title
        // shrinks to the small floating label above the value.
        this._titleLabel.className = 'adw-row-title adw-entry-title';
        // The inherited `string_is_not_empty` title binding does NOT apply: which of
        // the two titles shows is the empty↔filled cross-fade's answer, owned by
        // `applyEntryRowState`.
        this._managesTitleVisibility = false;
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

        // The trailing cluster. libadwaita snapshots indicator → apply → pencil inside
        // the editable area and puts the suffixes box after it; here one horizontal box
        // carries both in that order, so a consumer suffix lands last instead of
        // replacing anything.
        const suffixes = new StackLayout();
        suffixes.orientation = 'horizontal';
        suffixes.className = 'adw-entry-row-suffixes';
        this._suffixes = suffixes;

        // The indicator slot starts EMPTY, as upstream's does — `AdwPasswordEntryRow`
        // fills it in. Its visibility (and the apply button's) comes from the first
        // render below, reproducing `adw_entry_row_init`'s hidden start.
        const indicator = new GtkImage();
        indicator.className = 'gtk-image adw-entry-indicator';
        suffixes.addChild(indicator);
        this._indicator = indicator;

        // `adw-entry-apply-symbolic` is a libadwaita-internal icon; the checkmark
        // from the vendored theme is its counterpart.
        const applyButton = new AdwImageButton();
        applyButton.className = `${applyButton.className} adw-entry-apply`.trim();
        applyButton.iconName = objectSelectSymbolic;
        // `suggested-action` (adw-entry-row.ui:99) is an accent fill with
        // `--accent-fg-color` on top — white in BOTH schemes, so pinning it here
        // is not a light-mode choice. It cannot come from the stylesheet: the
        // fill is baked into the rendered bitmap, and CSS `color` on an `Image`
        // reaches nothing. Without it the checkmark stayed scheme-coloured and
        // went near-black on the blue.
        applyButton.iconColor = ADW_ACCENT_FG_COLOR;
        applyButton.addEventListener('tap', () => this.apply());
        suffixes.addChild(applyButton);
        this._applyButton = applyButton;

        const editIcon = new GtkImage();
        editIcon.className = NS_EDIT_ICON_CLASS;
        editIcon.iconName = documentEditSymbolic;
        suffixes.addChild(editIcon);
        this._editIcon = editIcon;

        super.add_suffix(suffixes);

        this._field.addEventListener('textChange', () => {
            // Into the PROPERTY, not past it: `text`'s normalizer is what makes max-length
            // truncation count CHARACTERS, and its equal-write rule is what stops the loop
            // back out of the render below (the same single-funnel shape `adw-switch-row.ts`
            // uses for `checkedChange`).
            this.text = this._field.text ?? '';
        });
        // The focus input the whole derivation hangs off. The NS CSS subset cannot
        // express `:focus-within`, so this flag is the ONLY route to focus
        // feedback on this port.
        this._field.addEventListener('focus', () => this._setEditing(true));
        this._field.addEventListener('blur', () => this._setEditing(false));
        this._field.addEventListener('returnPress', () => this._activate());

        // The four declared inputs of `update_empty`, each on its own notify — the property is
        // the gate, so an equal write re-derives nothing and no setter needs its own guard.
        this.connect(NOTIFY_TEXT, (self) => self._onTextChanged());
        this.connect(NOTIFY_MAX_LENGTH, (self) => self._onMaxLengthChanged());
        this.connect(NOTIFY_EDITABLE, (self) => self._update());
        this.connect(NOTIFY_SHOW_APPLY_BUTTON, (self) => self._onShowApplyButtonChanged());

        // `adw_entry_row_init`'s hidden start — the pencil showing, apply and indicator away.
        this._update();

        applyConstructProps(this, props);
    }

    /** Whether the field currently has focus — `priv->editing`, not a property upstream. */
    get editing(): boolean {
        return this._editing;
    }

    /** The pending-apply latch — `true` exactly while the apply button shows. */
    get textChanged(): boolean {
        return this._textChanged;
    }

    /**
     * Append a suffix — `adw_entry_row_add_suffix` appends into a BOX, so suffixes
     * COEXIST here as upstream, unlike the one-slot rule `AdwActionRow.add_suffix` states.
     *
     * The override matters for the password row: the base's one-slot `add_suffix` would
     * detach the row's own peek toggle to make room, leaving `_peekButton` pointing at a
     * detached view so the row could never be revealed again.
     */
    override add_suffix(view: View): void {
        view.className = `${view.className ?? ''} adw-row-suffix`.trim();
        this._suffixes.addChild(view);
        this._slotSuffix = view;
    }

    /** Remove a suffix added through {@link add_suffix} — `adw_entry_row_remove`. */
    override remove(view: View): void {
        if (view === this.prefix) {
            super.remove(view);
            return;
        }
        this._suffixes.removeChild(view);
        if (view === this._slotSuffix) this._slotSuffix = null;
    }

    /** The suffix most recently installed through {@link add_suffix}, or `null`. */
    override get suffix(): View | null {
        return this._slotSuffix;
    }

    /**
     * Drive the trailing indicator — `adw_entry_row_set_show_indicator`. Private to
     * the library upstream, public here because `AdwPasswordEntryRow` composes rather
     * than reaching into a private header.
     */
    setShowIndicator(show: boolean): void {
        // UNGUARDED on purpose: the C assigns and calls `update_empty` with no equality check
        // (C:1281-1296), so a redundant call still re-derives. That is why it stayed a method
        // and did not become a declared property — a property would add the guard it must not
        // have, and upstream does not expose one either.
        this._showIndicator = !!show;
        this._update();
    }

    /** `adw_entry_row_set_indicator_icon_name`, as an Adwaita symbolic SVG. */
    setIndicatorIcon(svg: string): void {
        this._indicator.iconName = svg;
    }

    /** Apply the pending edit — the apply button tap (`apply_button_clicked_cb`). */
    apply(): void {
        this._textChanged = false;
        this._update();
        this.emit(SIGNAL_APPLY);
    }

    /** `text_activated_cb` — exactly one of the two signals, never both. */
    private _activate(): void {
        const activation = resolveEntryRowActivation(this._textChanged, this.activatesDefault);
        if (activation.signal === 'apply') {
            this.apply();
            return;
        }
        // `activateDefault` is NOT a signal argument: upstream's `entry-activated` has none, and
        // the host reads `activates-default` off the emitter (see the constant's doc).
        this.emit(SIGNAL_ENTRY_ACTIVATED);
    }

    /**
     * Re-run `update_empty` over the row's current inputs and paint the result — the one place
     * the derivation is read, standing in for the subscription the state object used to push.
     */
    protected _update(): void {
        this._render(
            deriveEntryRowState({
                text: this.text,
                editing: this._editing,
                editable: this.editable,
                showIndicator: this._showIndicator,
                textChanged: this._textChanged,
            }),
        );
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

    /** Feed the focus state in — `text_state_flags_changed_cb`, guarded as the C's flag is. */
    private _setEditing(editing: boolean): void {
        if (editing === this._editing) return;
        this._editing = editing;
        this._update();
    }

    /**
     * `text_changed_cb` (C:166-174) plus the derived count.
     *
     * `text-length` SETTLES INSIDE THIS EMISSION, so a handler of `notify::text` reads the new
     * count off the emitter — and a handler of both sees `notify::text-length` first, because a
     * notify emitted from within another one nests. That is what deriving a property from a
     * property costs in GObject, with no `g_object_freeze_notify` in this seam to reorder it;
     * the old payload-carrying events had the opposite order and no emitter to read.
     */
    private _onTextChanged(): void {
        if (entryRowLatches(this.showApplyButton, this._editing)) this._textChanged = true;
        this._update();
        // The written value is ignored — the normalizer derives it. Spelled out anyway, so the
        // line says what it means rather than relying on a `0` being rewritten out of sight.
        this.textLength = entryTextLength(this.text);
    }

    /** Over-long contents are truncated the moment the limit drops — `adw_entry_row_set_max_length`. */
    private _onMaxLengthChanged(): void {
        // Written through the PROPERTY rather than into a field, so the truncation notifies
        // `notify::text` and re-derives like any other text change. A limit that truncates
        // nothing produces an equal write, which the property drops.
        this.text = clampEntryText(this.text, this.maxLength);
    }

    /** Turning the apply button OFF retracts a pending apply; turning it on derives nothing (C:989-992). */
    private _onShowApplyButtonChanged(): void {
        if (this.showApplyButton || !this._textChanged) return;
        this._textChanged = false;
        this._update();
    }
}
