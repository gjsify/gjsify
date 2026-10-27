// The Gdk half of `@gjsify/adwaita-nativescript`'s vocabulary, as far as the clipboard goes (ADR 0096
// Amendment 2): `Display.get_default().get_clipboard()`, `Clipboard.set_content` / `set` and
// `ContentProvider.new_for_value`. The behaviour lives once in `@gjsify/adwaita-core` (`gdk.ts`);
// this file hands it the platform clipboard, `../clipboard-host.ts`.
//
// A TRUE SUBSET: everything else in Gdk is absent, and the `gi://Gdk` arm refuses it by name.

import { CURRENT_TIME as GDK_PLATFORM_CURRENT_TIME, GDK_KEYS, createGdk } from '@gjsify/adwaita-core';

import { nativeClipboardHost } from '../clipboard-host.js';

export { RGBA } from '@gjsify/adwaita-core';

export const gdk = createGdk(nativeClipboardHost);

export const Display = gdk.Display;
export const Clipboard = gdk.Clipboard;
export const ContentProvider = gdk.ContentProvider;
export const ContentFormats = gdk.ContentFormats;
export const AppLaunchContext = gdk.AppLaunchContext;

export const CURRENT_TIME = GDK_PLATFORM_CURRENT_TIME;
export const {
    KEY_space,
    KEY_a,
    KEY_d,
    KEY_e,
    KEY_q,
    KEY_s,
    KEY_w,
    KEY_Return,
    KEY_Escape,
    KEY_Left,
    KEY_Up,
    KEY_Right,
    KEY_Down,
} = GDK_KEYS;
