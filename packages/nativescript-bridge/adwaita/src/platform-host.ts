// How the NativeScript door reaches the platform for `Gtk.StyleContext`, `Gtk.Settings`,
// `Gtk.show_uri` and `Gtk.EventControllerKey` (the behaviour is in `@gjsify/adwaita-core`,
// `gtk-platform.ts`).
//
//   - styles: `Application.addCss`, which is APPEND-ONLY (`widgets/adw-accent.ts`): a provider's
//     rules are added when they are new or changed, and removing a provider cannot take them back.
//   - uris and keys: `./platform-source.ts` and its `.android` / `.ios` variants.
//   - font: the platform does not say, so `Gtk.Settings:gtk-font-name` is null until written.

import type { PlatformHost } from '@gjsify/adwaita-core';
import { Application, type View } from '@nativescript/core';

import { listenPlatformKeys, openPlatformUri } from './platform-source.js';

const applied = new Map<object, string>();

export const nativePlatformHost: PlatformHost = {
    setStyles(list) {
        for (const { owner, css } of list) {
            if (applied.get(owner) === css) continue;
            applied.set(owner, css);
            if (css) Application.addCss(css);
        }
    },
    openUri: (uri) => openPlatformUri(uri),
    fontName: () => null,
    listenKeys: (widget, handler) =>
        listenPlatformKeys(widget as View, (key, keycode, state, pressed) => handler({ key, keycode, state, pressed })),
};
