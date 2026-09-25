// `readDesktopAppearance` / `watchDesktopAppearance` — one question, answered
// per OS (ADR 0078).
//
// FOR A PROCESS WITHOUT A WINDOW. A GTK app already has this answer:
// `Adw.StyleManager` reads the same sources (portal, WinRT, AppKit) and applies
// them to its widgets. What it cannot serve is a process that never opens a
// display — the GJS server behind a web app, a bridge, a CLI — because every
// libadwaita backend except the portal needs a `GdkDisplay`. This reader needs
// none, so it can hand the desktop's appearance to a web page
// (`renderAppearanceMeta`) or anything else.
//
// TOTAL: it never throws and never guesses. A source that is missing, refuses
// or times out contributes nothing, and a field no source could answer is
// absent from the result.

import GLib from 'gi://GLib?version=2.0';
import type { DesktopAppearance } from '@gjsify/adwaita-core';

import { readDarwinAppearance, watchDarwinAppearance } from './darwin.js';
import {
    type GnomeSettingsSource,
    gnomeSettingsSource,
    readGnomeSettings,
    watchGnomeSettings,
} from './gnome-settings.js';
import { isGnomeDesktop, mergeAppearance, sameAppearance } from './mapping.js';
import { type PortalEndpoint, readPortalAppearance, sessionPortalEndpoint, watchPortalAppearance } from './portal.js';
import { readWin32Appearance, watchWin32Appearance } from './win32.js';

/** Overrides for the sources, mainly so a test can point the reader at a fake. */
export interface DesktopAppearanceOptions {
    /** `process.platform` by default. Anything other than `win32`/`darwin` takes the portal route. */
    readonly platform?: string;
    /** Linux: the portal to ask. Default: `org.freedesktop.portal.Desktop` on the session bus; `null` skips it. */
    readonly portal?: PortalEndpoint | null;
    /** Linux: the GSettings fallback. Default: `org.gnome.desktop.interface` if installed; `null` skips it. */
    readonly gnomeSettings?: GnomeSettingsSource | null;
    /**
     * Linux: `XDG_CURRENT_DESKTOP`, read from the environment by default. GSettings is
     * consulted only when it names GNOME: elsewhere the schema answers its defaults.
     */
    readonly currentDesktop?: string | null;
}

interface Backend {
    read(): Promise<DesktopAppearance>;
    watch(changed: () => void): () => void;
}

function currentPlatform(options: DesktopAppearanceOptions): string | undefined {
    if (options.platform) return options.platform;
    return typeof process === 'undefined' ? undefined : process.platform;
}

/**
 * Linux and every other free desktop: the portal first, GSettings for what it
 * left unknown. The sources are resolved once, on first use, and kept — a
 * watcher holds the bus connection and the `Gio.Settings` its signals live on.
 */
function linuxBackend(options: DesktopAppearanceOptions): Backend {
    let resolved: Promise<{ portal: PortalEndpoint | null; settings: GnomeSettingsSource | null }> | undefined;
    const sources = () => {
        resolved ??= (async () => ({
            portal: options.portal !== undefined ? options.portal : await sessionPortalEndpoint(),
            settings: !isGnomeDesktop(
                options.currentDesktop !== undefined ? options.currentDesktop : GLib.getenv('XDG_CURRENT_DESKTOP'),
            )
                ? null
                : options.gnomeSettings !== undefined
                  ? options.gnomeSettings
                  : gnomeSettingsSource(),
        }))();
        return resolved;
    };
    return {
        async read() {
            const { portal, settings } = await sources();
            const fromPortal = portal ? await readPortalAppearance(portal) : null;
            const fromSettings = settings ? readGnomeSettings(settings) : {};
            return mergeAppearance(fromPortal ?? {}, fromSettings);
        },
        watch(changed) {
            let stops: (() => void)[] = [];
            let stopped = false;
            void sources().then(({ portal, settings }) => {
                if (stopped) return;
                if (portal) stops.push(watchPortalAppearance(portal, changed));
                if (settings) stops.push(watchGnomeSettings(settings, changed));
            });
            return () => {
                stopped = true;
                for (const stop of stops) stop();
                stops = [];
            };
        },
    };
}

function backendFor(options: DesktopAppearanceOptions): Backend {
    const platform = currentPlatform(options);
    if (platform === 'win32') return { read: readWin32Appearance, watch: watchWin32Appearance };
    if (platform === 'darwin') return { read: readDarwinAppearance, watch: watchDarwinAppearance };
    return linuxBackend(options);
}

/** The desktop's accent and colour-scheme preference, as far as this OS can tell. Never rejects. */
export function readDesktopAppearance(options: DesktopAppearanceOptions = {}): Promise<DesktopAppearance> {
    return backendFor(options).read();
}

/**
 * Call `callback` with the current appearance, then again whenever it changes
 * (duplicate reports are dropped). Returns the unsubscribe — HOLD it: the
 * returned closure is what keeps the bus subscription, the settings object or
 * the file monitor alive.
 */
export function watchDesktopAppearance(
    callback: (appearance: DesktopAppearance) => void,
    options: DesktopAppearanceOptions = {},
): () => void {
    const backend = backendFor(options);
    let last: DesktopAppearance | undefined;
    let stopped = false;
    // Reads are serialised, so a slow read can never overwrite the answer of a later one.
    let queue: Promise<void> = Promise.resolve();
    const refresh = () => {
        queue = queue.then(async () => {
            const next = await backend.read();
            if (stopped || (last && sameAppearance(last, next))) return;
            last = next;
            callback(next);
        });
    };
    const stopWatching = backend.watch(refresh);
    refresh();
    return () => {
        stopped = true;
        stopWatching();
    };
}
