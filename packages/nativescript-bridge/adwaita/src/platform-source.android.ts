// Android: `Intent.ACTION_VIEW` for a URI and `View.setOnKeyListener` for keys. Unverified on a
// device; the APIs are the documented ones.

import { Application, type View } from '@nativescript/core';

declare const android: any;

const SHIFT = 1 << 0;
const CONTROL = 1 << 2;
const ALT = 1 << 3;
const SUPER = 1 << 26;

export function openPlatformUri(uri: string): void {
    const context = Application.android?.foregroundActivity ?? Application.android?.startActivity;
    if (!context) throw new Error('Android has no activity to open a URI from');
    const intent = new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(uri));
    (context as any).startActivity(intent);
}

/** Android names keys by `KeyEvent` code; the printable ones go through `getDisplayLabel`. */
const NAMED: Record<number, string> = {
    62: ' ',
    66: 'Enter',
    111: 'Escape',
    21: 'ArrowLeft',
    19: 'ArrowUp',
    22: 'ArrowRight',
    20: 'ArrowDown',
};

export function listenPlatformKeys(
    view: View,
    deliver: (key: string, keycode: number, state: number, pressed: boolean) => boolean,
): () => void {
    const native = (view as any).android;
    if (!native?.setOnKeyListener) return () => {};
    native.setFocusable?.(true);
    native.setOnKeyListener(
        new android.view.View.OnKeyListener({
            onKey(_v: unknown, code: number, event: any) {
                const label = event.getDisplayLabel?.();
                const key = NAMED[code] ?? (label ? String.fromCharCode(label).toLowerCase() : '');
                const state =
                    (event.isShiftPressed() ? SHIFT : 0) |
                    (event.isCtrlPressed() ? CONTROL : 0) |
                    (event.isAltPressed() ? ALT : 0) |
                    (event.isMetaPressed() ? SUPER : 0);
                return deliver(key, code, state, event.getAction() === 0);
            },
        }),
    );
    return () => native.setOnKeyListener(null);
}
