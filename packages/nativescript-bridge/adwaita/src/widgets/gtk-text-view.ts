// GtkTextView — a multi-line text editor, for NativeScript.
//
// A box around a NativeScript `TextView`, for the reason `Gtk.Entry` is a box around a
// `TextField`: Android's Material `EditText` draws an underline Adwaita has nowhere, and
// stripping it takes inline values the box's CSS fill could then not override.
//
// THE BUFFER IS NOT MODELLED. `Gtk.TextView` edits a `Gtk.TextBuffer` (marks, tags, iters);
// the platform has a string. So the text is the widget's own `text` property — port-owned,
// recorded in the vocabulary ledger — and `buffer` is a small subset over it (text, cursor,
// insert_at_cursor, set_text); tags, `accepts-tab` and the indent are not here. `wrap-mode` is held and read back, but the platform's text view
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

/** The part of `Gtk.TextBuffer` the port carries (see {@link GtkTextView.buffer}). */
export interface GtkTextBufferSubset {
    text: string;
    readonly cursor_position: number;
    get_text(): string;
    set_text(text: string, len?: number): void;
    insert_at_cursor(text: string, len?: number): void;
}

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
        // GTK's enum parser takes `word_char` and `word-char` alike; Blueprint writes the former.
        const index =
            typeof value === 'number'
                ? (value as number)
                : GTK_WRAP_MODES.indexOf(String(value).replace(/_/g, '-') as GtkWrapModeNick);
        const next = GTK_WRAP_MODES[index];
        if (next === undefined) {
            throw new TypeError(
                `Gtk.TextView.wrapMode: ${JSON.stringify(value)} is not a Gtk.WrapMode; expected ${GTK_WRAP_MODES.join(', ')}.`,
            );
        }
        this._wrapMode = next;
    }

    /** `Gtk.TextView:top-margin` — the gap above the text, as padding on the inner field. */
    get topMargin(): number {
        return this._margin('paddingTop');
    }

    set topMargin(value: number | string) {
        this._field.paddingTop = Number(value);
    }

    /** `Gtk.TextView:bottom-margin`. */
    get bottomMargin(): number {
        return this._margin('paddingBottom');
    }

    set bottomMargin(value: number | string) {
        this._field.paddingBottom = Number(value);
    }

    /** `Gtk.TextView:left-margin`. */
    get leftMargin(): number {
        return this._margin('paddingLeft');
    }

    set leftMargin(value: number | string) {
        this._field.paddingLeft = Number(value);
    }

    /** `Gtk.TextView:right-margin`. */
    get rightMargin(): number {
        return this._margin('paddingRight');
    }

    set rightMargin(value: number | string) {
        this._field.paddingRight = Number(value);
    }

    private _margin(side: 'paddingTop' | 'paddingBottom' | 'paddingLeft' | 'paddingRight'): number {
        const raw = this._field[side] as unknown;
        const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? 0));
        return Number.isFinite(n) ? n : 0;
    }

    /**
     * `Gtk.TextView:buffer` — a SUBSET of `Gtk.TextBuffer` over the widget's own string: `text`,
     * `cursor_position`, `insert_at_cursor`, `set_text` and `get_text`. No marks, tags or iters.
     * The cursor is the insert mark's offset; programmatic inserts advance it, as in GTK.
     */
    get buffer(): GtkTextBufferSubset {
        return (this._buffer ??= this._makeBuffer());
    }

    private _buffer?: GtkTextBufferSubset;
    private _cursor = 0;

    private _makeBuffer(): GtkTextBufferSubset {
        const view = this;
        return {
            get text(): string {
                return view._text;
            },
            set text(value: string) {
                this.set_text(value, -1);
            },
            get cursor_position(): number {
                return Math.min(view._cursor, view._text.length);
            },
            get_text: () => view._text,
            set_text(text: string, len = -1): void {
                const next = len < 0 ? (text ?? '') : (text ?? '').slice(0, len);
                view._applyText(next);
                view._cursor = next.length;
            },
            insert_at_cursor(text: string, len = -1): void {
                const piece = len < 0 ? (text ?? '') : (text ?? '').slice(0, len);
                const at = Math.min(view._cursor, view._text.length);
                view._applyText(view._text.slice(0, at) + piece + view._text.slice(at));
                view._cursor = at + piece.length;
            },
        };
    }

    /** The inner `TextView` — for focus, selection and host-specific keyboard options. */
    get field(): TextView {
        return this._field;
    }
}
