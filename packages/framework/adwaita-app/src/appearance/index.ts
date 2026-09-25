// @gjsify/adwaita-app/appearance — the desktop's accent and colour scheme for a
// process without a window, and the handoff to a web page (ADR 0078).
//
// A SUBPATH, not part of the root barrel: the root pulls in GTK and Adwaita,
// and the processes this serves — a web server, a bridge — load neither. This
// entry reaches Gio and GLib only.

export { readDesktopAppearance, watchDesktopAppearance } from './reader.js';
export type { DesktopAppearanceOptions } from './reader.js';

export {
    appearanceFromGnomeSettings,
    appearanceFromMacDefaults,
    appearanceFromPortal,
    appearanceFromWindowsRegistry,
    isGnomeDesktop,
    MACOS_ACCENT_COLORS,
    mergeAppearance,
    parseRegQuery,
    sameAppearance,
} from './mapping.js';
export type { MacDefaultsValues, WindowsRegistryValues } from './mapping.js';

export { readPortalAppearance, watchPortalAppearance } from './portal.js';
export type { PortalEndpoint } from './portal.js';
export type { GnomeSettingsLike, GnomeSettingsSource } from './gnome-settings.js';

// The format's writer lives in `@gjsify/adwaita-core` beside its reader, so the two
// cannot drift; re-exported here because the server that reads the desktop is the one
// that renders the tags.
export { parseDesktopAppearance, renderAppearanceMeta } from '@gjsify/adwaita-core';
export type { AdwSystemColorScheme, DesktopAppearance } from '@gjsify/adwaita-core';
