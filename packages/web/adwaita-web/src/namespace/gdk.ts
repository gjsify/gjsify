// The Gdk half of `@gjsify/adwaita-web`'s vocabulary, as far as the clipboard goes (ADR 0096
// Amendment 2): `Display.get_default().get_clipboard()`, `Clipboard.set_content` / `set` and
// `ContentProvider.new_for_value`. The behaviour lives once in `@gjsify/adwaita-core` (`gdk.ts`); this
// file hands it the browser's clipboard, `../clipboard-host.ts`.
//
// A TRUE SUBSET: everything else in Gdk is absent, and the `gi://Gdk` arm refuses it by name.

import { createGdk } from '@gjsify/adwaita-core';

import { webClipboardHost } from '../clipboard-host.js';

export const gdk = createGdk(webClipboardHost);

export const Display = gdk.Display;
export const Clipboard = gdk.Clipboard;
export const ContentProvider = gdk.ContentProvider;
export const ContentFormats = gdk.ContentFormats;
