// GtkSource.View for NativeScript — a leaf view over an Android `EditText` (see
// `native-editor.android.ts`). The class is a thin shell: properties, buffer, highlighting and
// the light/dark re-tint live in `EditorSession`, which runs and is tested off-device.
//
// It imports `@nativescript/core` at module-eval, so specs must not import this file.

import { View as NsView } from '@nativescript/core';
import { adwaitaColorScheme, onAdwaitaColorSchemeChanged, withGtkWidgetLayout } from '@gjsify/adwaita-nativescript';

import { GtkSourceBuffer, type Buffer } from '@gjsify/gtksource-core';
import { toBoolean, toNumber } from '@gjsify/gtksource-core';
import { EditorSession } from '@gjsify/gtksource-core';
import { Adjustment as GtkAdjustment } from '@gjsify/adwaita-nativescript/gtk';
import { createEditorDriver } from './native-editor.js';
import type { NativeEditorDriver } from './native-editor.js';

// Named by its GIR name, as the Adw and Gtk widgets are: the shared-tree builder reads a class off
// the barrel and refuses one whose name is not the tag the `.blp` wrote (`GtkSourceView`).
export class GtkSourceView extends withGtkWidgetLayout(NsView) {
    /** The one slot a `.blp` fills with an object: `buffer: GtkSource.Buffer { … }`. */
    static readonly builderSlots: readonly string[] = ['buffer'];

    private readonly driver: NativeEditorDriver = createEditorDriver();
    private readonly session: EditorSession;
    private unsubscribe: (() => void) | null = null;
    private readonly vadj = new GtkAdjustment();
    private readonly hadj = new GtkAdjustment();
    private direction = 1;

    constructor() {
        super();
        this.className = 'gtksource-view';
        this.session = new EditorSession(this.driver, undefined, adwaitaColorScheme());
    }

    createNativeView(): unknown {
        return this.driver.createNativeView(this._context);
    }

    initNativeView(): void {
        super.initNativeView();
        this.driver.attach(this.nativeViewProtected);
        this.unsubscribe = onAdwaitaColorSchemeChanged(() => this.session.setColorScheme(adwaitaColorScheme()));
        this.session.setColorScheme(adwaitaColorScheme());
    }

    disposeNativeView(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.driver.detach();
        super.disposeNativeView();
    }

    _addChildFromBuilder(name: string, child: object): void {
        if (name !== 'buffer' || !(child instanceof GtkSourceBuffer)) {
            throw new Error(`GtkSource.View takes only a \`buffer\` object child, not '${name}'.`);
        }
        this.buffer = child;
    }

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

    /** `GtkTextView:cursor-visible` — TRUE by default. */
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

    /** `GtkScrollable:vadjustment` — one stable adjustment (the platform scrolls the text itself). */
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

    /** `gtk_widget_set_direction`: held and read back; no widget mirrors under RTL here. */
    set_direction(direction: number): void {
        if (![0, 1, 2].includes(direction)) {
            throw new TypeError(`${direction} is not a valid value for enum argument dir`);
        }
        this.direction = direction;
    }
    get_direction(): number {
        return this.direction;
    }

    /** A view has no widget children of its own here: its parts are the platform's. */
    get_first_child(): null {
        return null;
    }
    get_next_sibling(): null {
        return null;
    }
    get_parent(): unknown {
        return (this as unknown as { parent?: unknown }).parent ?? null;
    }

    /** Gutters are slice 6 (ADR 0094). */
    get_gutter(_window_type: number): never {
        throw new Error('GtkSource.View.get_gutter is not implemented');
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

    connect(name: string, callback: (self: GtkSourceView, ...args: never[]) => void): number {
        return this.session.connect(name, callback as never);
    }

    disconnect(id: number): void {
        this.session.disconnect(id);
    }
}
