// GtkTextView — a multi-line text editor, for NativeScript.
//
// A box around a NativeScript `TextView`, for the reason `Gtk.Entry` is a box around a
// `TextField`: Android's Material `EditText` draws an underline Adwaita has nowhere, and
// stripping it takes inline values the box's CSS fill could then not override.
//
// THE BUFFER IS NOT MODELLED. `Gtk.TextView` edits a `Gtk.TextBuffer` (marks, tags, iters);
// the platform has a string. So the text is the widget's own `text` property — port-owned,
// recorded in the vocabulary ledger — and `buffer`, tags, `accepts-tab`, the margins and
// the indent are not here. `wrap-mode` is held and read back, but the platform's text view
// always wraps at the edge, so `none` has no effect. `monospace` switches the font family.
//
// Reference: refs/gtk gtk/gtktextview.c (GtkTextView)
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss (textview)
// Copyright (c) The GTK Team and GNOME contributors. LGPLv2.1+.

import { GridLayout, ItemSpec, TextView, type EventData } from '@nativescript/core';
import { classNameWith } from './style-classes.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when {@link GtkTextView.text} changes. Mirrors `notify::text`. */
export const NOTIFY_TEXT_VIEW_TEXT = 'notify::text';

/** `Gtk.WrapMode`'s nicks, in the enum's order (NONE=0 … WORD_CHAR=3). */
export const GTK_WRAP_MODES = ['none', 'char', 'word', 'word-char'] as const;
export type GtkWrapModeNick = (typeof GTK_WRAP_MODES)[number];

export class GtkTextView extends withSignals(GridLayout) {
    static readonly GTypeName: string = 'GtkTextView';

    protected readonly _field: TextView;
    private _text = '';
    private _monospace = false;
    private _wrapMode: GtkWrapModeNick = 'none';

    constructor(props?: ConstructProps<GtkTextView>) {
        super();
        this.className = 'adw-text-view';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        const field = new TextView();
        field.className = 'adw-text-view-input';
        field.set('backgroundColor', 'transparent');
        field.set('borderWidth', 0);
        this.addChild(field);
        this._field = field;

        field.addEventListener('textChange', () => this._applyText(this._field.text ?? ''));
        applyConstructProps(this, props);
    }

    private _applyText(next: string): void {
        if (this._field.text !== next) this._field.text = next;
        if (next === this._text) return;
        this._text = next;
        const data: EventData = { eventName: NOTIFY_TEXT_VIEW_TEXT, object: this };
        this.notify(data);
    }

    /** The whole text — the port's stand-in for the `Gtk.TextBuffer`. */
    get text(): string {
        return this._text;
    }

    set text(value: string) {
        this._applyText(value ?? '');
    }

    /** `Gtk.TextView:editable`. */
    get editable(): boolean {
        return this._field.editable;
    }

    set editable(raw: boolean | string) {
        this._field.editable = !!xmlBoolean(raw, this.editable);
    }

    /** `Gtk.TextView:monospace`. */
    get monospace(): boolean {
        return this._monospace;
    }

    set monospace(raw: boolean | string) {
        this._monospace = !!xmlBoolean(raw, this._monospace);
        this.className = classNameWith('adw-text-view', this._monospace ? ['monospace'] : []);
    }

    /** `Gtk.TextView:wrap-mode` — held and read back; the platform always wraps. */
    get wrapMode(): GtkWrapModeNick {
        return this._wrapMode;
    }

    set wrapMode(value: GtkWrapModeNick) {
        const index = typeof value === 'number' ? (value as number) : GTK_WRAP_MODES.indexOf(value);
        const next = GTK_WRAP_MODES[index];
        if (next === undefined) {
            throw new TypeError(
                `Gtk.TextView.wrapMode: ${JSON.stringify(value)} is not a Gtk.WrapMode; expected ${GTK_WRAP_MODES.join(', ')}.`,
            );
        }
        this._wrapMode = next;
    }

    /** The inner `TextView` — for focus, selection and host-specific keyboard options. */
    get field(): TextView {
        return this._field;
    }
}
