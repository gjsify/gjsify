// macOS's system accent, read where libadwaita does not read it for you.
//
// A GTK app needs none of this: libadwaita ≥ 1.6 follows the macOS accent on its
// own (`adw-settings-impl-macos.c`, measured on macOS 27 / libadwaita 1.10:
// `Adw.StyleManager:accent-color` is PURPLE with purple set), and the property is
// read-only anyway. So `AdwaitaApp` applies nothing. This module is for what has
// no libadwaita in the process — a headless GJS companion (a bridge, a CLI) and
// the web views an app hosts, where WebKit resolves CSS `AccentColor` to blue
// whatever the setting — so that they can match the desktop the way a GTK window
// already does. Interpreting the value is `@gjsify/adwaita-core`'s
// (`adwAccentFromAppleAccentColor`); this is only the reading and the watching.
//
// Deliberately GTK-free: it imports Gio and GLib only, and is published as the
// `@gjsify/adwaita-app/system-accent` subpath so a headless consumer does not
// load Gtk through the barrel.
//
// WHY A POLL. The change signal macOS has is the distributed notification
// `AppleColorPreferencesChangedNotification` — what libadwaita observes — and it
// is reachable only through AppKit's NSDistributedNotificationCenter, which GI
// cannot bind. A file monitor on `~/Library/Preferences/.GlobalPreferences.plist`
// would be event-driven, but cfprefsd owns that file and flushes it when IT
// decides, so its timing is an unmeasured promise. One `defaults read` costs
// about 7 ms (measured, macOS 27), an accent changes a few times a year, and it
// is cosmetic: a default of five seconds on `timeout_add_seconds`, whose wakeups
// GLib coalesces with the process's other second-granular timers, is the cheap
// and certain choice.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { adwAccentFromAppleAccentColor, type AdwAccentColorName } from '@gjsify/adwaita-core';

/** The command that prints the accent: `AppleAccentColor` in the global domain. */
export const APPLE_ACCENT_COLOR_ARGV: readonly string[] = ['defaults', 'read', '-g', 'AppleAccentColor'];

/** How often {@link onMacosAccentColorChanged} re-reads the preference by default. */
export const MACOS_ACCENT_POLL_SECONDS = 5;

/**
 * What `defaults` says on stderr when the key is not set — "Multicolor".
 * Measured on macOS 27: `Could not find key 'AppleAccentColor' in domain
 * 'kCFPreferencesAnyApplication'.`, exit status 1.
 */
const KEY_ABSENT = /Could not find key|does not exist/;

export interface ReadMacosAccentColorOptions {
    /** The command to run instead of {@link APPLE_ACCENT_COLOR_ARGV}. For tests. */
    readonly argv?: readonly string[];
}

/**
 * The macOS system accent as one of Adwaita's nine, or `null` where there is
 * none to follow: not macOS (no `defaults`), or a value macOS does not define.
 * "Multicolor" gives blue — an Adwaita app's own accent, as libadwaita shows it.
 *
 * Synchronous: it waits for one short-lived `defaults` process (~7 ms).
 */
export function readMacosAccentColor(options: ReadMacosAccentColorOptions = {}): AdwAccentColorName | null {
    const argv = [...(options.argv ?? APPLE_ACCENT_COLOR_ARGV)];
    let status: { ok: boolean; stdout: string; stderr: string };
    try {
        const child = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const [, stdout, stderr] = child.communicate_utf8(null, null);
        status = { ok: child.get_successful(), stdout: stdout ?? '', stderr: stderr ?? '' };
    } catch {
        // Both calls are `throws="1"`: spawning fails where there is no `defaults`
        // (every host but macOS), communicating on an I/O error. Either way there
        // is no system accent to follow, which is an answer, not an error.
        return null;
    }
    if (status.ok) return adwAccentFromAppleAccentColor(status.stdout);
    return KEY_ABSENT.test(status.stderr) ? adwAccentFromAppleAccentColor(null) : null;
}

export interface OnMacosAccentColorChangedOptions {
    /** Seconds between reads. Defaults to {@link MACOS_ACCENT_POLL_SECONDS}. */
    readonly intervalSeconds?: number;
    /** The reader. Defaults to {@link readMacosAccentColor}; tests pass their own. */
    readonly read?: () => AdwAccentColorName | null;
}

/**
 * Call `listener` with the new accent whenever the macOS system accent changes.
 * Reads once now as the baseline (without calling `listener`), then re-reads
 * every `intervalSeconds` on the default main context. Returns the unsubscribe,
 * which the caller must hold and call: the timer lives until then.
 */
export function onMacosAccentColorChanged(
    listener: (accent: AdwAccentColorName | null) => void,
    options: OnMacosAccentColorChangedOptions = {},
): () => void {
    const read = options.read ?? (() => readMacosAccentColor());
    let last = read();
    let sourceId: number | null = GLib.timeout_add_seconds(
        GLib.PRIORITY_LOW,
        options.intervalSeconds ?? MACOS_ACCENT_POLL_SECONDS,
        () => {
            const next = read();
            if (next !== last) {
                last = next;
                listener(next);
            }
            return GLib.SOURCE_CONTINUE;
        },
    );
    return () => {
        if (sourceId === null) return;
        GLib.source_remove(sourceId);
        sourceId = null;
    };
}
