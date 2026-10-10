// Publishing text on Android: `ClipboardManager.setPrimaryClip`, the same call an app's own code
// makes. Unverified on a device (ADR 0096 Amendment 2); the API is the documented one.

import { Application } from '@nativescript/core';

declare const android: any;

export function writePlatformText(text: string): void {
    const context = Application.android?.foregroundActivity ?? Application.android?.startActivity;
    const manager = context?.getSystemService?.(android.content.Context.CLIPBOARD_SERVICE) as any;
    if (!manager) throw new Error('Android has no ClipboardManager for this context');
    manager.setPrimaryClip(android.content.ClipData.newPlainText('text', text));
}
