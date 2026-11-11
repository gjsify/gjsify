// How the NativeScript door reaches the platform for `Gtk.StyleContext`, `Gtk.Settings`,
// `Gtk.show_uri` and `Gtk.EventControllerKey` (the behaviour is in `@gjsify/adwaita-core`,
// `gtk-platform.ts`).
//
//   - styles: `Application.addCss`, which is APPEND-ONLY (`widgets/adw-accent.ts`): a provider's
//     rules are added when they are new or changed, and removing a provider cannot take them back.
//     GTK's `px` is a logical pixel, NativeScript's a physical one, so `px` is dropped on the way in
//     (`cssPxToDip`); the build does the same for `app.css` (`@gjsify/nativescript-vite`).
//     `:root { --window-bg-color: #… }` literals are turned into override rules for the theme
//     (`widgets/named-colors-theme.ts`), and undone by appending the theme's defaults again.
//     Every append is also a chance to lose: whatever was appended earlier — the named colours,
//     the interface scale (`./app-scale.ts`) — has to be appended again behind the new CSS.
//   - uris and keys: `./platform-source.ts` and its `.android` / `.ios` variants.
//   - font: the platform does not say, so `Gtk.Settings:gtk-font-name` is null until written.

import type { PlatformHost } from '@gjsify/adwaita-core';
import { cssPxToDip } from '@gjsify/adwaita-core/css-length';
import { Application, CSSHelper, type View } from '@nativescript/core';

import { reapplyAppScaleCss } from './app-scale.js';
import { type IdSelectorClass, provideIdSelector } from './name-selector.js';
import { publishWindowFg } from './widgets/status-icon-color.js';
import { createNamedColorsPublisher, parseAdwaitaRootColors } from './widgets/named-colors-theme.js';

import { listenPlatformKeys, openPlatformUri } from './platform-source.js';

// NativeScript's `IdSelector`, which `createSelector('#x')` answers an instance of.
provideIdSelector(() => (CSSHelper.createSelector('#x') as { constructor: IdSelectorClass }).constructor);

const applied = new Map<object, string>();
const namedColors = createNamedColorsPublisher();

export const nativePlatformHost: PlatformHost = {
    setStyles(list) {
        let appended = false;
        for (const { owner, css } of list) {
            if (applied.get(owner) === css) continue;
            applied.set(owner, css);
            if (css) {
                Application.addCss(cssPxToDip(css));
                appended = true;
            }
        }
        // The `:root` colour variables do nothing on NS, so they become override rules for the
        // theme's literals. Owners no longer in `list` are gone, so the variables are re-read from
        // what remains; `appended` forces a re-append because the new CSS now sits after the old
        // override.
        const values = new Map<string, string>();
        for (const { css } of list) for (const [name, value] of parseAdwaitaRootColors(css)) values.set(name, value);
        publishWindowFg(values.get('window-fg-color') ?? null);
        const override = namedColors.update(values, appended);
        if (override) Application.addCss(override);
        // Same reason, for the interface scale: the CSS just appended carries the theme's own
        // lengths, so the scaled ones have to go back on top of it.
        if (appended) reapplyAppScaleCss();
    },
    openUri: (uri) => openPlatformUri(uri),
    fontName: () => null,
    listenKeys: (widget, handler) =>
        listenPlatformKeys(widget as View, (key, keycode, state, pressed) => handler({ key, keycode, state, pressed })),
};
