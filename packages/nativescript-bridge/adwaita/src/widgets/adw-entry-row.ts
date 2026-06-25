// AdwEntryRow — a Libadwaita-style inline entry row for NativeScript.
//
// Extends {@link AdwActionRow} but RESTRUCTURES column 0 into the signature
// `Adw.EntryRow` look: the title becomes a small dim label ABOVE the editable
// value, and a REAL NativeScript `TextField` sits directly beneath it — both
// left-aligned, stacked in the text column (NOT title-left / field-right). The
// inherited suffix slot is left free (a consumer can still add an icon). `text`
// is two-way bound to the field; typing emits a `notify::text` event, mirroring
// the GObject `notify::text` signal naming used by `Adw.EntryRow`.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `_row.scss` + libadwaita entries.
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { TextField, type EventData } from '@nativescript/core';
import { AdwActionRow } from './adw-action-row.js';

/** Event name emitted when {@link AdwEntryRow.text} changes. Mirrors GObject `notify::text`. */
export const NOTIFY_TEXT = 'notify::text';

/** Payload of the `notify::text` event. */
export interface NotifyTextEventData extends EventData {
    /** The new text value. */
    text: string;
}

export class AdwEntryRow extends AdwActionRow {
    /** The TextField stacked below the title in column 0. */
    protected readonly _field: TextField;

    constructor() {
        super();

        this.className = 'adw-row adw-action-row adw-entry-row';

        // EntryRow look: the inherited title shrinks to a small dim label, and the
        // field is stacked directly beneath it in the SAME column-0 text stack.
        this._titleLabel.className = 'adw-row-title adw-entry-title';

        const field = new TextField();
        field.className = 'adw-entry-field';
        // Android's Material TextField draws a bottom underline; Adwaita EntryRow
        // has none (just the floating title + the value text). Strip it by making
        // the field chrome-less — transparent background, no border.
        field.set('backgroundColor', 'transparent');
        field.set('borderWidth', 0);
        this._textStack.addChild(field);
        this._field = field;

        // Re-emit the TextField's textChange as a GObject-style notify::text so
        // consumers subscribe with a single, runtime-agnostic event name.
        field.addEventListener('textChange', () => {
            const data: NotifyTextEventData = {
                eventName: NOTIFY_TEXT,
                object: this,
                text: field.text ?? '',
            };
            this.notify(data);
        });
    }

    /** The editable text. Two-way bound to the suffix `TextField.text`. */
    get text(): string {
        return this._field.text ?? '';
    }

    set text(value: string) {
        const next = value ?? '';
        if (this._field.text !== next) {
            this._field.text = next;
        }
    }
}
