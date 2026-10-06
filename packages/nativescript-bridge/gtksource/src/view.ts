// GtkSource.View for NativeScript — a leaf view over an Android `EditText` (see
// `native-editor.android.ts`). The class is a thin shell: properties, buffer, highlighting and
// the light/dark re-tint live in `EditorSession`, which runs and is tested off-device.
//
// It imports `@nativescript/core` at module-eval, so specs must not import this file.

import { View as NsView } from '@nativescript/core';
import { adwaitaColorScheme, onAdwaitaColorSchemeChanged, withGtkWidgetLayout } from '@gjsify/adwaita-nativescript';

import type { Buffer } from './buffer.js';
import { toBoolean, toNumber } from './coerce.js';
import { EditorSession } from './editor-session.js';
import { createEditorDriver } from './native-editor.js';
import type { NativeEditorDriver } from './native-editor.js';

// Named by its GIR name, as the Adw and Gtk widgets are: the shared-tree builder reads a class off
// the barrel and refuses one whose name is not the tag the `.blp` wrote (`GtkSourceView`).
export class GtkSourceView extends withGtkWidgetLayout(NsView) {
    private readonly driver: NativeEditorDriver = createEditorDriver();
    private readonly session: EditorSession;
    private unsubscribe: (() => void) | null = null;

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
