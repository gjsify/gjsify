// macOS: the accent and appearance from the global defaults domain.
//
// WHY `defaults` AND NOT A PLIST PARSE: cfprefsd owns the preferences and
// writes `.GlobalPreferences.plist` late and by replacing the file, so reading
// the file directly races a half-written or stale copy (measured on macOS 27,
// JumpLink/beifahrer#18). `defaults read` asks cfprefsd, which is the
// authority. libadwaita reads the same values through AppKit
// (`adw-settings-impl-macos.c`); a headless process has no AppKit application
// to ask.
//
// WHY A DIRECTORY MONITOR, DEBOUNCED: the plist is replaced rather than
// rewritten, which a monitor on the file itself can miss, and one change
// arrives as a burst of events. So the watcher monitors
// `~/Library/Preferences`, filters for the one file, and re-reads once the
// burst has settled.
//
// NOT MEASURED END-TO-END ON macOS. The mapping is tested on every host
// (`mapping.spec.ts`); spawning `defaults` and the monitor are not, and are
// verified on real hardware separately.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import type { DesktopAppearance } from '@gjsify/adwaita-core';

import { appearanceFromMacDefaults } from './mapping.js';
import { runTool } from './run-tool.js';

const GLOBAL_PREFERENCES = '.GlobalPreferences.plist';

/** Quiet time after the last file event before re-reading — cfprefsd writes in bursts. */
export const DARWIN_DEBOUNCE_MS = 750;

/** `defaults read -g <key>`, trimmed; `null` when the key does not exist (defaults exits 1). */
async function readDefault(key: string): Promise<string | null> {
    const stdout = await runTool(['defaults', 'read', '-g', key]);
    return stdout === null ? null : stdout.trim();
}

export async function readDarwinAppearance(): Promise<DesktopAppearance> {
    const [appleAccentColor, appleInterfaceStyle, appleInterfaceStyleSwitchesAutomatically] = await Promise.all([
        readDefault('AppleAccentColor'),
        readDefault('AppleInterfaceStyle'),
        readDefault('AppleInterfaceStyleSwitchesAutomatically'),
    ]);
    return appearanceFromMacDefaults({
        appleAccentColor,
        appleInterfaceStyle,
        appleInterfaceStyleSwitchesAutomatically,
    });
}

export function watchDarwinAppearance(changed: () => void): () => void {
    const directory = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), 'Library', 'Preferences']));
    let monitor: Gio.FileMonitor;
    try {
        monitor = directory.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
    } catch {
        // monitor_directory throws when the directory cannot be watched; the appearance
        // then stays what the first read said, which is the documented degraded answer.
        return () => undefined;
    }
    let pending = 0;
    const handler = monitor.connect('changed', (_monitor, file, other) => {
        if (file.get_basename() !== GLOBAL_PREFERENCES && other?.get_basename() !== GLOBAL_PREFERENCES) return;
        if (pending) GLib.source_remove(pending);
        pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DARWIN_DEBOUNCE_MS, () => {
            pending = 0;
            changed();
            return GLib.SOURCE_REMOVE;
        });
    });
    return () => {
        if (pending) GLib.source_remove(pending);
        monitor.disconnect(handler);
        monitor.cancel();
    };
}
