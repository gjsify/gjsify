// The native text widget behind `GtkSource.View`, off Android.
//
// `native-editor.android.ts` replaces this file on Android (`platformResolvePlugin` resolves the
// platform file first). Everywhere else — iOS, GJS, Node, the specs — the driver below remembers
// nothing and refuses to create a native view, with the message `assertNativeScript()` uses.

import type { EditorDriver, EditorHost } from '@gjsify/gtksource-core';

export interface NativeEditorDriver extends EditorDriver {
    /** Called from `createNativeView()` with the Android `Context`. */
    createNativeView(context: unknown): object;
    /** The view `createNativeView()` returned is live: apply everything remembered so far. */
    attach(nativeView: unknown): void;
    detach(): void;
}

class UnsupportedEditorDriver implements NativeEditorDriver {
    bind(_host: EditorHost): void {}
    createNativeView(): never {
        throw new Error('Platform not supported: GtkSource.View is implemented for Android only');
    }
    attach(): void {}
    detach(): void {}
    setText(): void {}
    replaceRange(): void {}
    setSelection(): void {}
    setLineCount(): void {}
    setLayout(): void {}
    invalidateGutter(): void {}
    spliceLines(): void {}
    paintLine(): void {}
    clearAll(): void {}
    setPalette(): void {}
}

export function createEditorDriver(): NativeEditorDriver {
    return new UnsupportedEditorDriver();
}
