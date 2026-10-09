// <gtk-source-view> — `GtkSource.View`, built on `@gjsify/gtksource-core`.
//
// WHY NOT <adw-source-view>. That element is CodeMirror with its own grammar; this one reads the
// same `.lang` and style-scheme files GtkSourceView does, through the same `EditorSession` the
// Android port runs, so GNOME, Android and the web have one source of truth for highlighting.
//
// THE SURFACE IS A TRUE SUBSET of GtkSource.View: the names and semantics below are GtkSourceView's,
// and what is absent is absent. The editing itself is the browser's (see `web-editor-driver.ts`).
//
// IN THIS SLICE: `buffer`, `auto-indent`, `indent-width` (held and read back, as on Android),
// `show-line-numbers`, `highlight-current-line`, `monospace`, `editable`, `cursor-visible`, the four
// margins, `connect`/`disconnect`, the GJS snake_case accessors, `vadjustment`/`hadjustment`,
// `set_direction`, `get_first_child`/`get_next_sibling`, `get_gutter` (the model; no column is painted yet).
//
// Reference: GtkSourceView 5 gtksourceview.c, upstream GNOME/gtksourceview (properties and defaults)
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { adwaitaColorScheme, GtkAdjustment, onAdwaitaColorSchemeChanged } from '@gjsify/adwaita-core';
import type { Buffer, Gutter } from '@gjsify/gtksource-core';
import { EditorSession, GutterSet, toBoolean, toNumber } from '@gjsify/gtksource-core';

import { WebEditorDriver } from './web-editor-driver.js';

const STYLE_ID = 'gjsify-gtk-source-view-style';

const STYLE = `
gtk-source-view {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 12em;
  height: 100%;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
  background: var(--gsv-bg, var(--view-bg-color));
  color: var(--gsv-fg, var(--view-fg-color));
  font: inherit;
  --gsv-line-height: 1.4;
}
gtk-source-view.monospace { font-family: var(--monospace-font-family, ui-monospace, monospace); }
gtk-source-view .gsv-gutter {
  display: none;
  flex: none;
  overflow: hidden;
  box-sizing: content-box;
  padding: var(--gsv-margin-top, 0px) var(--gsv-gutter-padding, 8px) 0;
  width: var(--gsv-gutter-width, 2ch);
  text-align: end;
  line-height: var(--gsv-line-height);
  color: var(--gsv-number-fg);
  background: var(--gsv-number-bg);
  user-select: none;
}
gtk-source-view.show-line-numbers .gsv-gutter { display: block; }
gtk-source-view .gsv-number.current { color: var(--gsv-current-number-fg); background: var(--gsv-current-number-bg); }
gtk-source-view .gsv-stage { position: relative; flex: 1 1 auto; min-width: 0; }
gtk-source-view .gsv-backdrop,
gtk-source-view .gsv-area {
  position: absolute;
  inset: 0;
  margin: 0;
  border: 0;
  box-sizing: border-box;
  padding: var(--gsv-margin-top, 0px) var(--gsv-margin-right, 0px) var(--gsv-margin-bottom, 0px) var(--gsv-margin-left, 0px);
  font: inherit;
  line-height: var(--gsv-line-height);
  white-space: pre;
  tab-size: 8;
  letter-spacing: normal;
}
gtk-source-view .gsv-backdrop { overflow: hidden; pointer-events: none; }
gtk-source-view .gsv-line { min-height: calc(1em * var(--gsv-line-height)); }
gtk-source-view .gsv-line.current { background: var(--gsv-current-line); }
gtk-source-view .gsv-area {
  resize: none;
  overflow: auto;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--gsv-fg, currentColor);
}
gtk-source-view.cursor-hidden .gsv-area { caret-color: transparent; }
gtk-source-view .gsv-area::selection { background: var(--gsv-selection); color: transparent; }
`;

function ensureStyleInjected(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
}

type Coerce = (value: unknown, name: string) => boolean | number;

/** attribute → [property, default, coercion] */
const ATTRIBUTES: Readonly<Record<string, readonly [string, boolean | number, Coerce]>> = {
    'auto-indent': ['autoIndent', false, toBoolean],
    'indent-width': ['indentWidth', -1, toNumber],
    'show-line-numbers': ['showLineNumbers', false, toBoolean],
    'highlight-current-line': ['highlightCurrentLine', false, toBoolean],
    monospace: ['monospace', false, toBoolean],
    editable: ['editable', true, toBoolean],
    'cursor-visible': ['cursorVisible', true, toBoolean],
    'left-margin': ['leftMargin', 0, toNumber],
    'right-margin': ['rightMargin', 0, toNumber],
    'top-margin': ['topMargin', 0, toNumber],
    'bottom-margin': ['bottomMargin', 0, toNumber],
};

const OBSERVED_ATTRIBUTES = [
    'auto-indent',
    'indent-width',
    'show-line-numbers',
    'highlight-current-line',
    'monospace',
    'editable',
    'cursor-visible',
    'left-margin',
    'right-margin',
    'top-margin',
    'bottom-margin',
];

export class GtkSourceView extends HTMLElement {
    static get observedAttributes(): string[] {
        return OBSERVED_ATTRIBUTES;
    }

    private readonly session: EditorSession;
    private readonly driver: WebEditorDriver;
    private unsubscribe: (() => void) | null = null;
    private built = false;
    private readonly gutter = document.createElement('div');
    private readonly backdrop = document.createElement('div');
    private readonly area = document.createElement('textarea');
    private readonly vadj = new GtkAdjustment();
    private readonly hadj = new GtkAdjustment();
    private direction = 1;
    private readonly gutters = new GutterSet(this);

    constructor() {
        super();
        this.gutter.className = 'gsv-gutter';
        this.backdrop.className = 'gsv-backdrop';
        this.area.className = 'gsv-area';
        this.area.wrap = 'off';
        this.area.spellcheck = false;
        this.area.autocapitalize = 'off';
        this.area.autocomplete = 'off';
        this.driver = new WebEditorDriver({
            root: this,
            area: this.area,
            backdrop: this.backdrop,
            gutter: this.gutter,
        });
        this.session = new EditorSession(this.driver, undefined, adwaitaColorScheme());
    }

    private syncAdjustments(): void {
        const { area } = this;
        this.vadj.configure(area.scrollTop, 0, area.scrollHeight, 20, area.clientHeight, area.clientHeight);
        this.hadj.configure(area.scrollLeft, 0, area.scrollWidth, 20, area.clientWidth, area.clientWidth);
    }

    private readonly onAreaScroll = (): void => this.syncAdjustments();

    connectedCallback(): void {
        ensureStyleInjected();
        this.area.addEventListener('scroll', this.onAreaScroll);
        if (!this.built) {
            this.built = true;
            const stage = document.createElement('div');
            stage.className = 'gsv-stage';
            stage.append(this.backdrop, this.area);
            this.append(this.gutter, stage);
        }
        this.driver.attach();
        this.unsubscribe = onAdwaitaColorSchemeChanged(() => this.session.setColorScheme(adwaitaColorScheme()));
        this.session.setColorScheme(adwaitaColorScheme());
    }

    disconnectedCallback(): void {
        this.area.removeEventListener('scroll', this.onAreaScroll);
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.driver.detach();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
        const [property, fallback, coerce] = ATTRIBUTES[name];
        // Presence is true for a boolean written as a bare attribute (`toggleAttribute`).
        const next =
            value === null
                ? fallback
                : value === '' && typeof fallback === 'boolean'
                  ? true
                  : coerce(value, `GtkSource.View.${property}`);
        (this as unknown as Record<string, unknown>)[property] = next;
    }

    /** `GtkSource.View:buffer`. */
    get buffer(): Buffer {
        return this.session.buffer;
    }
    set buffer(value: Buffer) {
        this.session.buffer = value;
    }

    get autoIndent(): boolean {
        return this.session.autoIndent;
    }
    set autoIndent(value: boolean | string) {
        this.session.autoIndent = toBoolean(value, 'GtkSource.View.autoIndent');
    }

    /** Held and read back; a textarea has no indent step to apply it to (ADR 0094). */
    get indentWidth(): number {
        return this.session.indentWidth;
    }
    set indentWidth(value: number | string) {
        this.session.indentWidth = toNumber(value, 'GtkSource.View.indentWidth');
    }

    get showLineNumbers(): boolean {
        return this.session.showLineNumbers;
    }
    set showLineNumbers(value: boolean | string) {
        this.session.showLineNumbers = toBoolean(value, 'GtkSource.View.showLineNumbers');
    }

    get highlightCurrentLine(): boolean {
        return this.session.highlightCurrentLine;
    }
    set highlightCurrentLine(value: boolean | string) {
        this.session.highlightCurrentLine = toBoolean(value, 'GtkSource.View.highlightCurrentLine');
    }

    get monospace(): boolean {
        return this.session.monospace;
    }
    set monospace(value: boolean | string) {
        this.session.monospace = toBoolean(value, 'GtkSource.View.monospace');
    }

    get editable(): boolean {
        return this.session.editable;
    }
    set editable(value: boolean | string) {
        this.session.editable = toBoolean(value, 'GtkSource.View.editable');
    }

    /** `GtkTextView:cursor-visible` — whether the insertion cursor is drawn; TRUE by default. */
    get cursorVisible(): boolean {
        return this.session.cursorVisible;
    }
    set cursorVisible(value: boolean | string) {
        this.session.cursorVisible = toBoolean(value, 'GtkSource.View.cursorVisible');
    }

    // The GJS snake_case names of the same properties.
    get cursor_visible(): boolean {
        return this.cursorVisible;
    }
    set cursor_visible(value: boolean) {
        this.cursorVisible = value;
    }
    get_cursor_visible(): boolean {
        return this.cursorVisible;
    }
    set_cursor_visible(value: boolean): void {
        this.cursorVisible = value;
    }
    get_editable(): boolean {
        return this.editable;
    }
    set_editable(value: boolean): void {
        this.editable = value;
    }
    get highlight_current_line(): boolean {
        return this.highlightCurrentLine;
    }
    set highlight_current_line(value: boolean) {
        this.highlightCurrentLine = value;
    }
    get show_line_numbers(): boolean {
        return this.showLineNumbers;
    }
    set show_line_numbers(value: boolean) {
        this.showLineNumbers = value;
    }

    /** `GtkScrollable:vadjustment` — one stable adjustment that follows the textarea's scroll. */
    get vadjustment(): GtkAdjustment {
        return this.vadj;
    }
    get hadjustment(): GtkAdjustment {
        return this.hadj;
    }
    get_vadjustment(): GtkAdjustment {
        return this.vadj;
    }
    get_hadjustment(): GtkAdjustment {
        return this.hadj;
    }

    /** `gtk_widget_set_direction`: held, and mirrored onto `dir` for LTR and RTL. */
    set_direction(direction: number): void {
        if (![0, 1, 2].includes(direction)) {
            throw new TypeError(`${direction} is not a valid value for enum argument dir`);
        }
        this.direction = direction;
        if (direction === 0) this.removeAttribute('dir');
        else this.dir = direction === 2 ? 'rtl' : 'ltr';
    }
    get_direction(): number {
        return this.direction;
    }

    /** A view has no widget children of its own here: its parts are the browser's. */
    get_first_child(): null {
        return null;
    }
    get_next_sibling(): Element | null {
        return this.nextElementSibling;
    }
    get_parent(): Element | null {
        return this.parentElement;
    }

    /** `null` for any side but LEFT and RIGHT, as in GtkSourceView (ADR 0103). */
    get_gutter(window_type: number): Gutter | null {
        return this.gutters.get(window_type);
    }

    get leftMargin(): number {
        return this.session.leftMargin;
    }
    set leftMargin(value: number | string) {
        this.session.leftMargin = toNumber(value, 'GtkSource.View.leftMargin');
    }

    get rightMargin(): number {
        return this.session.rightMargin;
    }
    set rightMargin(value: number | string) {
        this.session.rightMargin = toNumber(value, 'GtkSource.View.rightMargin');
    }

    get topMargin(): number {
        return this.session.topMargin;
    }
    set topMargin(value: number | string) {
        this.session.topMargin = toNumber(value, 'GtkSource.View.topMargin');
    }

    get bottomMargin(): number {
        return this.session.bottomMargin;
    }
    set bottomMargin(value: number | string) {
        this.session.bottomMargin = toNumber(value, 'GtkSource.View.bottomMargin');
    }

    /** GJS `connect(name, cb) → id`; the handler's first argument is this view. */
    connect(name: string, callback: (self: GtkSourceView, ...args: never[]) => void): number {
        return this.session.connect(name, ((_session: unknown, ...args: never[]) => callback(this, ...args)) as never);
    }

    disconnect(id: number): void {
        this.session.disconnect(id);
    }

    /** The inner textarea, for focus and tests. */
    get textarea(): HTMLTextAreaElement {
        return this.area;
    }
}

customElements.define('gtk-source-view', GtkSourceView);
