// iOS: `UIApplication.openURL`. Hardware-keyboard events need a responder subclass, which this
// door does not have: keys never arrive. Unverified on a device.

import type { View } from '@nativescript/core';

declare const UIApplication: any;
declare const NSURL: any;

export function openPlatformUri(uri: string): void {
    UIApplication.sharedApplication.openURL(NSURL.URLWithString(uri));
}

export function listenPlatformKeys(
    _view: View,
    _deliver: (key: string, keycode: number, state: number, pressed: boolean) => boolean,
): () => void {
    return () => {};
}
