// Windows: the accent and app mode from the current user's registry.
//
// WHY reg.exe AND NOT GLib's GWin32RegistryKey: its value getters
// (`g_win32_registry_key_get_value`, `g_win32_registry_value_iter_get_data`)
// return the data through an untyped `gpointer` out-parameter, which
// introspection cannot marshal into a JS value, and `…_key_watch` takes a
// callback with no scope annotation. So no JS runtime can read a registry value
// through it; `reg.exe query` is the reachable API, run with an argv array.
//
// WHY POLLING: for the same reason there is no change notification to
// subscribe to. The watcher re-reads every few seconds while it is held, and
// stops when unsubscribed.
//
// NOT MEASURED ON WINDOWS. The parser and the mapping are tested on every host
// (`mapping.spec.ts`); spawning reg.exe and the registry layout are not.

import GLib from 'gi://GLib?version=2.0';
import type { DesktopAppearance } from '@gjsify/adwaita-core';

import { appearanceFromWindowsRegistry, parseRegQuery } from './mapping.js';
import { runTool } from './run-tool.js';

const ACCENT_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent';
const DWM_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM';
const PERSONALIZE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

/** How often a watcher re-reads. Settings change by hand, so seconds are fast enough. */
export const WIN32_POLL_INTERVAL_S = 3;

async function queryValue(key: string, name: string): Promise<number | Uint8Array | null> {
    const stdout = await runTool(['reg', 'query', key, '/v', name]);
    return stdout === null ? null : parseRegQuery(stdout, name);
}

export async function readWin32Appearance(): Promise<DesktopAppearance> {
    const [palette, light] = await Promise.all([
        queryValue(ACCENT_KEY, 'AccentPalette'),
        queryValue(PERSONALIZE_KEY, 'AppsUseLightTheme'),
    ]);
    const accentPalette = palette instanceof Uint8Array ? palette : null;
    // DWM's value is only the fallback, so it costs a spawn only when the palette is missing.
    const dwm = accentPalette ? null : await queryValue(DWM_KEY, 'AccentColor');
    return appearanceFromWindowsRegistry({
        accentPalette,
        dwmAccentColor: typeof dwm === 'number' ? dwm : null,
        appsUseLightTheme: typeof light === 'number' ? light : null,
    });
}

export function watchWin32Appearance(changed: () => void): () => void {
    const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WIN32_POLL_INTERVAL_S, () => {
        changed();
        return GLib.SOURCE_CONTINUE;
    });
    return () => GLib.source_remove(id);
}
