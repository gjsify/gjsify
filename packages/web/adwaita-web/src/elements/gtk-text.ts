// <gtk-text> — `Gtk.Text`, the single-line text widget GTK builds every entry out of.
//
// WHY IT EXISTS ALONGSIDE <gtk-entry>. `Gtk.Text` is "the common implementation of
// single-line text editing that is shared between Gtk.Entry, Gtk.PasswordEntry,
// Gtk.SpinButton" (gtktext.c:78-91), and its own `<gtk-text>` surface is what an author
// reaches when there is no entry AROUND it — a bare single-line field with a placeholder
// and a length limit. GTK gives that widget `AccessibleRole.none`, "which causes it to be
// skipped for accessibility … expected to be used as a delegate for a GtkEditable
// implementation" (gtktext.c:199-205); standing alone it IS the field, so the inner
// native input carries the textbox role here. That is a DECLARED divergence, and it is
// the only one about accessibility.
//
// THE LENGTH ARITHMETIC IS HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004):
// `clampEntryText` truncates on CODE POINTS, the same helper `<gtk-entry>` uses. The
// native `maxlength` attribute would not have closed the gap, because the browser counts
// UTF-16 code units — `'🔒é'` is 2 characters to GTK and 3 to `input.maxLength`.
//
// `visibility` IS A VALUE, NOT A PRESENCE: its pspec default is TRUE (gtktext.c:1778),
// so a bare `visibility` attribute would mean the same thing as leaving it off, and
// `editable` has the same default. `readBooleanAttribute` below reads both the HTML way
// (absent → the pspec default, an explicit `="false"` → off) and is what decides which
// spelling a boolean of this widget can carry.
//
// NOT PORTED, one line each, and declared in `check-adwaita-element-properties.mjs`:
// `activates-default` (GTK additionally activates the toplevel's default widget, and a
// document has none — `activate`, the signal Return is bound to at gtktext.c:1517-1520,
// fires either way), `enable-emoji-completion` (an Emoji chooser a browser has none of),
// `im-module` / `input-hints` / `input-purpose` (the input method and the on-screen
// keyboard it steers), `invisible-char` / `invisible-char-set` (GTK picks the masking
// glyph — `'*'`, the pspec default `42`, or a blank when only the flag is set,
// gtktext.c:2318-2322 — where a masked native input draws U+2022 and exposes no choice),
// `overwrite-mode` (a mode that draws a block cursor and makes every keystroke replace
// the next character; a native input overwrites an existing selection and no mode
// besides), and `truncate-multiline` (a single-line input drops every newline from a
// paste, so the property has nothing left to switch).
//
// Reference: refs/gtk/gtk/gtktext.c:78-91,1517-1520,155-167,2270-2322,2588-2611,
//   3605-3607,5742-5767,7400-7420
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss:1-18,20-45 (`%view`, `text`)
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss:19-28 (placeholder, block cursor)
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the length
//   arithmetic composed from @gjsify/adwaita-core.

import { ENTRY_ROW_MAX_LENGTH_LIMIT, clampEntryText, entryTextLength } from '@gjsify/adwaita-core';

export class GtkText extends HTMLElement {
    private _input!: HTMLInputElement;
    private _initialized = false;
    private _maxLength = 0;

    static get observedAttributes() {
        return ['text', 'editable', 'placeholder-text', 'max-length', 'visibility', 'propagate-text-width'];
    }

    /** `Gtk.Editable:text` — the buffer's contents, which is what the field shows. */
    get text(): string {
        return this._input ? this._input.value : (this.getAttribute('text') ?? '');
    }

    set text(value: string) {
        const clamped = clampEntryText(value ?? '', this._maxLength);
        if (this._input) this._input.value = clamped;
        else this.setAttribute('text', clamped);
        this._resizeToText();
    }

    /** `Gtk.Editable:editable` — defaults TRUE, so the attribute carries a VALUE. */
    get editable(): boolean {
        return readBooleanAttribute(this, 'editable', true);
    }

    set editable(value: boolean) {
        writeBooleanAttribute(this, 'editable', value, true);
    }

    /** `Gtk.Text:placeholder-text` — shown while the field is empty and unfocused. */
    get placeholderText(): string {
        return this.getAttribute('placeholder-text') ?? '';
    }

    set placeholderText(value: string) {
        this.setAttribute('placeholder-text', value ?? '');
    }

    /** `Gtk.Text:max-length` — 0 means unlimited. Counted in CODE POINTS. */
    get maxLength(): number {
        return this._maxLength;
    }

    set maxLength(value: number) {
        this._maxLength = Number.isFinite(value)
            ? Math.min(ENTRY_ROW_MAX_LENGTH_LIMIT, Math.max(0, Math.trunc(value)))
            : 0;
        if (this._input) this._input.value = clampEntryText(this._input.value, this._maxLength);
    }

    /** `Gtk.Text:visibility` — FALSE masks the contents (the "password mode"). Defaults TRUE. */
    get visibility(): boolean {
        return readBooleanAttribute(this, 'visibility', true);
    }

    set visibility(value: boolean) {
        writeBooleanAttribute(this, 'visibility', value, true);
    }

    /**
     * `Gtk.Text:propagate-text-width` — whether the widget grows and shrinks with its
     * content. GTK re-measures the Pango layout on every insertion and deletion while it
     * is set (gtktext.c:2588-2600,3605-3607,3639-3640); a native input has the same
     * mechanism, its `size`, which is why this is a real mapping and not a measurement.
     */
    get propagateTextWidth(): boolean {
        return readBooleanAttribute(this, 'propagate-text-width', false);
    }

    set propagateTextWidth(value: boolean) {
        writeBooleanAttribute(this, 'propagate-text-width', value, false);
    }

    /** `gtk_text_get_text_length` — code points, not UTF-16 units. */
    get textLength(): number {
        return entryTextLength(this.text);
    }

    /** The inner native input, for focus and selection. */
    get input(): HTMLInputElement {
        return this._input;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._maxLength = Number(this.getAttribute('max-length') ?? 0);
        const input = document.createElement('input');
        input.className = 'adw-text';
        input.type = this.visibility ? 'text' : 'password';
        input.value = clampEntryText(this.getAttribute('text') ?? '', this._maxLength);
        input.placeholder = this.placeholderText;
        input.readOnly = !this.editable;
        // Typing past the limit is clamped here, on the way in, so the field and the
        // buffer agree — the same place `<gtk-entry>` clamps.
        input.addEventListener('input', () => {
            const clamped = clampEntryText(input.value, this._maxLength);
            if (clamped !== input.value) input.value = clamped;
            this._resizeToText();
        });
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            this.dispatchEvent(new CustomEvent('activate', { bubbles: true, detail: { text: input.value } }));
        });

        this._input = input;
        this.replaceChildren(input);
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) {
            // Before the inner input exists `max-length` is still read: it decides what the
            // input is built with, so `_initialized` alone would drop a limit set in markup.
            if (name === 'max-length') this._maxLength = Number(value ?? 0);
            return;
        }
        if (name === 'text') this._input.value = clampEntryText(value ?? '', this._maxLength);
        else if (name === 'placeholder-text') this._input.placeholder = value ?? '';
        else if (name === 'max-length') {
            this._maxLength = Number(value ?? 0);
            this._input.value = clampEntryText(this._input.value, this._maxLength);
        } else if (name === 'editable') this._input.readOnly = !this.editable;
        else if (name === 'visibility') this._input.type = this.visibility ? 'text' : 'password';
        this._resizeToText();
        this._reflectReadOnly();
    }

    private _render(): void {
        this._resizeToText();
        this._reflectReadOnly();
    }

    /**
     * `text[.read-only]` (gtktext.c:155-167) is the node class a read-only text carries,
     * and libadwaita never styles it — it is a selector hook. GTK's own `set_editable`
     * adds the class on the way TO editable (gtktext.c:5762-5767), which is the inverse of
     * what the node documentation above it describes; the DOCUMENTED rule is what a node
     * author can rely on, so that is the one applied here.
     */
    private _reflectReadOnly(): void {
        this.classList.toggle('read-only', !this.editable);
    }

    private _resizeToText(): void {
        const propagate = this.propagateTextWidth;
        this.classList.toggle('propagate-text-width', propagate);
        // Only ever RAISED: `size` is a limited-to-positive-range IDL attribute, so
        // restoring it to the UA default means leaving it alone.
        if (this._input && propagate) this._input.size = Math.max(1, entryTextLength(this._input.value));
    }
}

/**
 * A boolean GObject property, read the way its pspec default decides an attribute can
 * spell it: absent is the default, a bare attribute is TRUE, and `="false"` is the opt-out.
 * `Gtk.Text:visibility` and `Gtk.Editable:editable` both default TRUE, so neither can be
 * carried by presence alone.
 */
function readBooleanAttribute(element: HTMLElement, name: string, fallback: boolean): boolean {
    const value = element.getAttribute(name);
    return value === null ? fallback : value !== 'false';
}

/** {@link readBooleanAttribute}'s writer: the default is left unwritten, anything else is. */
function writeBooleanAttribute(element: HTMLElement, name: string, value: boolean, fallback: boolean): void {
    if (value === fallback) element.removeAttribute(name);
    else element.setAttribute(name, value ? 'true' : 'false');
}

customElements.define('gtk-text', GtkText);
