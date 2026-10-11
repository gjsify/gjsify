// The web door's `Gtk.StyleContext`, `Gtk.Settings`, `Gtk.IconTheme`, `Gtk.show_uri` and
// `Gtk.EventControllerKey`: the behaviour is `@gjsify/adwaita-core`'s `gtk-platform.ts`, the browser
// is `../platform-host.ts`.

import { createGtkPlatform } from '@gjsify/adwaita-core';

import { webPlatformHost } from '../platform-host.js';

const platform = createGtkPlatform(webPlatformHost);

export const CssProvider = platform.CssProvider;
export const StyleContext = platform.StyleContext;
export const Settings = platform.Settings;
export const IconTheme = platform.IconTheme;
export const EventControllerKey = platform.EventControllerKey;
export const show_uri = platform.show_uri;
