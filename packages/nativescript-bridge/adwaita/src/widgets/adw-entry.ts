// AdwEntry — a standalone Adwaita text entry for NativeScript.
//
// The bare input — what `Gtk.Entry` is, and the counterpart of
// `@gjsify/adwaita-web`'s `<adw-entry>`: a filled, rounded field that stands on
// its own in a toolbar, a search bar or a form, NOT inside a boxed-list row.
// `AdwEntryRow` is the row form and keeps its floating title, pencil and apply
// button; none of that applies here.
//
// NO CORE STATE MACHINE, DELIBERATELY: `EntryRowState`'s render state is row-shaped
// (`titleAsPlaceholder`, `showEdit`, `showApply`, the apply latch) and a bare entry has
// none of it. What the two share is the character arithmetic, which is where a port
// actually goes wrong: `clampEntryText` and `entryTextLength` count CODE POINTS, so
// `'🔒é'` is two characters and a truncation never splits a surrogate pair. Both come
// from `@gjsify/adwaita-core` (ADR 0004).
//
// STRUCTURE: a box around a `TextField`, not a `TextField` subclass, because the two
// halves of the appearance are set in different places. Android's Material `EditText`
// draws a bottom underline Adwaita has nowhere, and stripping it takes an INLINE
// `backgroundColor: 'transparent'` + `borderWidth: 0` on the field. An inline value is
// not overridable from CSS, so the field cannot also carry the Adwaita FILL — the box
// does, out of `theme/adwaita.css`, where a `.ns-dark` rule can answer the light/dark
// question an inline value could not.
//
// `Gtk.Entry:activates-default` is deliberately absent: libadwaita vendors no
// `adw-entry.c`, so it would be a guess. `AdwEntryRow` carries an `activatesDefault`
// because `Adw.EntryRow` IS vendored and states its semantics, and the `max-length`
// ceiling below comes from that same vendored declaration.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss (the `entry`
//   surface: min-height 34, 9px horizontal padding, `$button_color` fill)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, TextField, type EventData } from '@nativescript/core';
import { ENTRY_ROW_MAX_LENGTH_LIMIT, clampEntryText, entryTextLength } from '@gjsify/adwaita-core';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** Event name emitted when {@link AdwEntry.text} changes. Mirrors GObject `notify::text`. */
export const NOTIFY_TEXT = 'notify::text';

/** Event name emitted when the return key is pressed — `Gtk.Entry::activate`. */
export const ACTIVATE = 'activate';

/** Payload of the `notify::text` event. */
export interface NotifyEntryTextEventData extends EventData {
    /** The new text value (already truncated to `maxLength`). */
    text: string;
    /** The new number of CHARACTERS (not UTF-16 units). */
    textLength: number;
}

export class AdwEntry extends GridLayout {
    /** The real input. Chrome-less: the box around it paints the Adwaita surface. */
    protected readonly _field: TextField;
    private _text = '';
    private _maxLength = 0;

    constructor() {
        super();

        this.className = 'adw-entry';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const field = new TextField();
        field.className = 'adw-entry-input';
        // Android's Material TextField draws a bottom underline; an Adwaita entry
        // has none — its outline IS the filled rounded box. Strip it by making
        // the field chrome-less, exactly as `AdwEntryRow` does; `.set()` because
        // `borderWidth` is outside the ambient `ns-core.d.ts` slice.
        field.set('backgroundColor', 'transparent');
        field.set('borderWidth', 0);
        this.addChild(field);
        this._field = field;

        // Route every edit through the clamp so max-length counts CHARACTERS —
        // the same reason `AdwEntryRow` never reads `TextField.text` straight.
        field.addEventListener('textChange', () => this._applyText(this._field.text ?? ''));
        field.addEventListener('returnPress', () => {
            const data: EventData = { eventName: ACTIVATE, object: this };
            this.notify(data);
        });
    }

    /**
     * Truncate, write the field, and notify on a real change.
     *
     * Writing the field re-enters through `textChange`; the nested call finds the
     * text already applied and settles it, and the outer one then sees its own
     * value in `_text` and stops — so a truncated keystroke notifies exactly once.
     */
    private _applyText(next: string): void {
        const clamped = clampEntryText(next, this._maxLength);
        if (this._field.text !== clamped) this._field.text = clamped;
        if (clamped === this._text) return;
        this._text = clamped;
        const data: NotifyEntryTextEventData = {
            eventName: NOTIFY_TEXT,
            object: this,
            text: clamped,
            textLength: entryTextLength(clamped),
        };
        this.notify(data);
    }

    /** The editable text. */
    get text(): string {
        return this._text;
    }

    set text(value: string) {
        this._applyText(value ?? '');
    }

    /** The number of CHARACTERS in {@link text}, not UTF-16 units. */
    get textLength(): number {
        return entryTextLength(this._text);
    }

    /** Maximum number of characters, `0` = unlimited. */
    get maxLength(): number {
        return this._maxLength;
    }

    set maxLength(raw: number | string) {
        const value = xmlNumber(raw, this.maxLength);
        // The 16-bit ceiling is `Adw.EntryRow:max-length`'s
        // (`ENTRY_ROW_MAX_LENGTH_LIMIT`, adw-entry-row.c:678-682); `Gtk.Entry`'s
        // own range is not verifiable in this tree, and the two are the same
        // `GTK_ENTRY_BUFFER_MAX_SIZE` upstream.
        this._maxLength = Number.isFinite(value)
            ? Math.min(ENTRY_ROW_MAX_LENGTH_LIMIT, Math.max(0, Math.trunc(value)))
            : 0;
        this._applyText(this._text);
    }

    /** Placeholder shown while the entry is empty (`Gtk.Entry:placeholder-text`). */
    get placeholder(): string {
        return this._field.hint ?? '';
    }

    set placeholder(value: string) {
        this._field.hint = value ?? '';
    }

    /** Whether the entry accepts edits (`GtkEditable:editable`). */
    get editable(): boolean {
        return this._field.editable;
    }

    set editable(raw: boolean | string) {
        const value = xmlBoolean(raw, this.editable);
        this._field.editable = !!value;
    }

    /** The inner `TextField` — for focus, selection and host-specific keyboard options. */
    get field(): TextField {
        return this._field;
    }
}
