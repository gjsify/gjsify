// <gtk-text-view> — `Gtk.TextView`, GTK's multi-line editable text widget.
//
// THE TEXT IS THE BUFFER, AND A BUFFER IS NOT AN ATTRIBUTE. `Gtk.TextView` has no `text`
// property of its own: the text lives in a `Gtk.TextBuffer` handed over by `set_buffer`
// (gtktextview.c), which is why an authored tree cannot carry one and the gallery block
// for this widget is refused a static tree. Here the buffer's text is the light-DOM text of
// the element, read once when it connects, plus a `text` attribute for the programmatic
// door — the same shape `<gtk-entry>` has with `value`.
//
// `wrap-mode` and `justification` are Pango's, so they reach real CSS mechanisms rather
// than being declared unreachable: `JUSTIFY_TEXT_ALIGN` answers the justification through
// Pango's switch, which `<gtk-label>` reads for the same enum
// (`Gtk.TextView:justification` and `Gtk.Label:justify` are one), and `wrap-mode` becomes
// `white-space` plus the break CSS offers. `monospace` is libadwaita's own `.monospace`
// class rather than a font stack written here again.
//
// THE FOUR PARAGRAPH SPACINGS ARE NOT PORTED, one reason: `indent`, `pixels-above-lines`,
// `pixels-below-lines` and `pixels-inside-wrap` are Pango's PARAGRAPH model — a document
// with paragraph breaks this widget does not have. CSS has one `line-height` for every
// line, so there is no value of it that spaces paragraphs apart from the lines inside
// them, and a `<textarea>` has no paragraphs to tell apart. They are declared in
// `check-adwaita-element-properties.mjs` rather than silently dropped. The four MARGINS
// are the other half of that pspec family and DO have a CSS mechanism: GTK's own property
// doc says it — "this property is confusingly named. In CSS terms, the value set here is
// padding" (gtktextview.c:1050-1057) — so they are `padding` here.
//
// `accepts-tab` is GTK's default (TRUE: Tab inserts a tab character,
// gtktextview.c:1147-1151), which is the opposite of a browser's — so this element
// intercepts Tab and inserts one rather than letting the UA move focus, and
// `accepts-tab="false"` gives the UA its default back.
//
// A11y: GTK gives the widget `AccessibleRole.text_box` (gtktextview.c:1949), and the
// native `<textarea>` this element builds already carries exactly that role — the host
// does not repeat it, because a `role="textbox"` wrapping another textbox is worse for a
// screen reader than no role at all.
//
// NOT PORTED, one line each: `im-module`, `input-hints` and `input-purpose` (the input
// method and the on-screen keyboard it steers — a browser owns its own), and `overwrite`
// (a mode that draws a block cursor and makes every keystroke replace the next character,
// where a native text control overwrites an existing selection and exposes no mode
// besides).
//
// Reference: refs/gtk/gtk/gtktextview.c:983-1201 (the pspecs and their defaults),
//   1050-1057 (margins ARE padding), 1147-1151 (`accepts-tab` defaults TRUE),
//   1949 (the `textbox` role), 3540-3600 (justification)
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss:1-45 (`%view`, `textview`)
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { normalizeLabelJustify, type LabelJustification } from '@gjsify/adwaita-core';

import { JUSTIFY_TEXT_ALIGN } from './justification.js';

/** `Gtk.WrapMode`'s four nicks, in enum order — Pango's enum, and the DEFAULT is `none`. */
const WRAP_MODES = ['none', 'char', 'word', 'word-char'] as const;

type TextViewWrapMode = (typeof WRAP_MODES)[number];

/**
 * `Gtk.TextView:wrap-mode` from its nick, at Pango's own default of `none`.
 *
 * NOT `normalizeLabelWrapMode`, which reads the same enum but for `Gtk.Label`, whose
 * pspec default is `word` and which has no `none` member to hold: reusing it here would
 * wrap a text view that was asked not to, on every unknown value.
 */
function normalizeWrapMode(value: string | null): TextViewWrapMode {
    return (WRAP_MODES as readonly string[]).includes(value ?? '') ? (value as TextViewWrapMode) : 'none';
}

/** `Gtk.TextView:wrap-mode` as the two CSS mechanisms it maps onto. */
const WRAP_WHITE_SPACE: Record<TextViewWrapMode, string> = {
    none: 'pre',
    word: 'pre-wrap',
    'word-char': 'pre-wrap',
    char: 'pre-wrap',
};

export class GtkTextView extends HTMLElement {
    private _area!: HTMLTextAreaElement;
    private _initialized = false;

    static get observedAttributes() {
        return [
            'text',
            'editable',
            'wrap-mode',
            'justification',
            'monospace',
            'accepts-tab',
            'cursor-visible',
            'top-margin',
            'bottom-margin',
            'left-margin',
            'right-margin',
        ];
    }

    /** The buffer's text — the light-DOM text of the element, then whatever is typed. */
    get text(): string {
        return this._area ? this._area.value : (this.getAttribute('text') ?? this._seedText());
    }

    set text(value: string) {
        if (this._area) this._area.value = value ?? '';
        else this.setAttribute('text', value ?? '');
    }

    /** `Gtk.TextView:editable` — defaults TRUE, so the attribute carries a VALUE. */
    get editable(): boolean {
        return this._bool('editable', true);
    }

    set editable(value: boolean) {
        this._setBool('editable', value, true);
    }

    /** `Gtk.TextView:wrap-mode` — where a line may break. Defaults to `none`, no wrapping. */
    get wrapMode(): TextViewWrapMode {
        return normalizeWrapMode(this.getAttribute('wrap-mode'));
    }

    set wrapMode(value: TextViewWrapMode) {
        this.setAttribute('wrap-mode', value);
    }

    /** `Gtk.TextView:justification` — how the lines align with each other. Defaults `left`. */
    get justification(): LabelJustification {
        return normalizeLabelJustify(this.getAttribute('justification'));
    }

    set justification(value: LabelJustification) {
        this.setAttribute('justification', value);
    }

    /** `Gtk.TextView:monospace` — whether the text is drawn in a monospace font. */
    get monospace(): boolean {
        return this._bool('monospace', false);
    }

    set monospace(value: boolean) {
        this._setBool('monospace', value, false);
    }

    /** `Gtk.TextView:accepts-tab` — whether Tab inserts a tab character. Defaults TRUE. */
    get acceptsTab(): boolean {
        return this._bool('accepts-tab', true);
    }

    set acceptsTab(value: boolean) {
        this._setBool('accepts-tab', value, true);
    }

    /** `Gtk.TextView:cursor-visible` — whether the insertion cursor is drawn. Defaults TRUE. */
    get cursorVisible(): boolean {
        return this._bool('cursor-visible', true);
    }

    set cursorVisible(value: boolean) {
        this._setBool('cursor-visible', value, true);
    }

    /** `Gtk.TextView:top-margin` — pixels of blank space above the text, in `padding`. */
    get topMargin(): number {
        return this._margin('top-margin');
    }

    set topMargin(value: number) {
        this.setAttribute('top-margin', String(value));
    }

    /** `Gtk.TextView:bottom-margin` — pixels of blank space below the text. */
    get bottomMargin(): number {
        return this._margin('bottom-margin');
    }

    set bottomMargin(value: number) {
        this.setAttribute('bottom-margin', String(value));
    }

    /** `Gtk.TextView:left-margin` — pixels of blank space to the left of the text. */
    get leftMargin(): number {
        return this._margin('left-margin');
    }

    set leftMargin(value: number) {
        this.setAttribute('left-margin', String(value));
    }

    /** `Gtk.TextView:right-margin` — pixels of blank space to the right of the text. */
    get rightMargin(): number {
        return this._margin('right-margin');
    }

    set rightMargin(value: number) {
        this.setAttribute('right-margin', String(value));
    }

    /** The inner native textarea, for focus and selection. */
    get textarea(): HTMLTextAreaElement {
        return this._area;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const area = document.createElement('textarea');
        area.className = 'adw-text-view';
        // The `text` attribute wins over the light-DOM text, because an attribute is the
        // explicit write and the light text is only what the author put where the buffer goes.
        area.value = this.getAttribute('text') ?? this._seedText();
        area.spellcheck = false;
        area.addEventListener('input', () => this._emitChanged());
        area.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab' || !this.acceptsTab) return;
            event.preventDefault();
            const start = area.selectionStart ?? area.value.length;
            const end = area.selectionEnd ?? start;
            // `setRangeText` does not fire `input`, so the insertion GTK reports through the
            // buffer's `changed` is dispatched here instead.
            area.setRangeText('\t', start, end, 'end');
            this._emitChanged();
        });

        this._area = area;
        this.replaceChildren(area);
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'text') this._area.value = value ?? '';
        else if (name === 'editable') this._area.readOnly = !this.editable;
        this._render();
    }

    private _render(): void {
        const wrapMode = this.wrapMode;
        const area = this._area;
        area.style.whiteSpace = WRAP_WHITE_SPACE[wrapMode];
        // `word-char` falls back to a CHARACTER break only where a word will not fit, which
        // is what `overflow-wrap: anywhere` means; `char` breaks anywhere, `word-break`.
        area.style.wordBreak = wrapMode === 'char' ? 'break-all' : 'normal';
        area.style.overflowWrap = wrapMode === 'word-char' ? 'anywhere' : 'normal';
        area.style.textAlign = JUSTIFY_TEXT_ALIGN[this.justification];
        area.style.caretColor = this.cursorVisible ? '' : 'transparent';
        this.classList.toggle('monospace', this.monospace);
        // The margins are custom properties the stylesheet ADDS to its own padding, because
        // GTK's doc says they are applied in addition to the theme's padding
        // (gtktextview.c:1050-1057) — writing `padding` from here would replace it.
        area.style.setProperty('--adw-text-view-margin-top', `${this.topMargin}px`);
        area.style.setProperty('--adw-text-view-margin-end', `${this.rightMargin}px`);
        area.style.setProperty('--adw-text-view-margin-bottom', `${this.bottomMargin}px`);
        area.style.setProperty('--adw-text-view-margin-start', `${this.leftMargin}px`);
    }

    /** The buffer's text before the inner control exists: the light-DOM text, or the attribute. */
    private _seedText(): string {
        return this.textContent;
    }

    /**
     * `Gtk.TextBuffer:changed`, the signal a text view's edits travel on. The buffer is a
     * separate GObject here (its text is the element's), so its `changed` is the one event
     * this widget has to re-emit.
     */
    private _emitChanged(): void {
        this.dispatchEvent(new CustomEvent('changed', { bubbles: true, detail: { text: this._area.value } }));
    }

    /** A boolean pspec read the way its default decides an attribute can spell it. */
    private _bool(name: string, fallback: boolean): boolean {
        const raw = this.getAttribute(name);
        return raw === null ? fallback : raw !== 'false';
    }

    /** {@link _bool}'s writer: the pspec default is left unwritten, anything else is written. */
    private _setBool(name: string, value: boolean, fallback: boolean): void {
        if (value === fallback) this.removeAttribute(name);
        else this.setAttribute(name, value ? 'true' : 'false');
    }

    /** A pixel margin, floored at 0 like every `g_param_spec_int` with a zero minimum. */
    private _margin(name: string): number {
        const parsed = Number.parseInt(this.getAttribute(name) ?? '', 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
}

customElements.define('gtk-text-view', GtkTextView);
