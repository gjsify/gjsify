// Linux fallback: GSettings `org.gnome.desktop.interface`, for a GNOME session
// whose portal does not answer (no xdg-desktop-portal running, a stripped
// container). Outside a sandbox it is the same value the portal would relay.

import Gio from 'gi://Gio?version=2.0';
import type { DesktopAppearance } from '@gjsify/adwaita-core';

import { appearanceFromGnomeSettings } from './mapping.js';

export const GNOME_INTERFACE_SCHEMA = 'org.gnome.desktop.interface';

/** The slice of `Gio.Settings` this reader touches, so a test can hand in a fake. */
export interface GnomeSettingsLike {
    get_string(key: string): string;
    connect(signal: string, callback: () => void): number;
    disconnect(id: number): void;
}

/** A GSettings source and which of the two keys its installed schema actually has. */
export interface GnomeSettingsSource {
    readonly settings: GnomeSettingsLike;
    readonly keys: readonly ('accent-color' | 'color-scheme')[];
}

/**
 * The installed schema, or `null`. Looked up in the schema source FIRST because
 * `new Gio.Settings` on a missing schema aborts the whole process instead of
 * throwing, and a missing KEY aborts `get_string` the same way — so each key is
 * checked too (`accent-color` exists only since GNOME 47).
 */
export function gnomeSettingsSource(): GnomeSettingsSource | null {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(GNOME_INTERFACE_SCHEMA, true);
    if (!schema) return null;
    const keys = (['accent-color', 'color-scheme'] as const).filter((key) => schema.has_key(key));
    if (keys.length === 0) return null;
    return { settings: new Gio.Settings({ settings_schema: schema }), keys };
}

export function readGnomeSettings(source: GnomeSettingsSource): DesktopAppearance {
    const read = (key: 'accent-color' | 'color-scheme') =>
        source.keys.includes(key) ? source.settings.get_string(key) : null;
    return appearanceFromGnomeSettings({ accentColor: read('accent-color'), colorScheme: read('color-scheme') });
}

/** Call `changed` on a change to either key. Returns the unsubscribe. */
export function watchGnomeSettings(source: GnomeSettingsSource, changed: () => void): () => void {
    const ids = source.keys.map((key) => source.settings.connect(`changed::${key}`, () => changed()));
    return () => {
        for (const id of ids) source.settings.disconnect(id);
    };
}
