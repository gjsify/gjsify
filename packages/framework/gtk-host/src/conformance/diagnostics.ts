// The counter that makes GTK's silent failures fail a test.
//
// GTK's failure mode is exit 0. A mis-parented widget emits `Gtk-WARNING` or
// `Adwaita-CRITICAL` and the process still succeeds, so a suite that asserts only
// on structure stays green while the window is wrong — measured: the 127 vectors
// in this package were green while a whole class of mis-parenting defects was
// live, because not one of them looked at stderr.
//
// Every adapter's vectors should install this. A renderer that emits a critical
// has not "worked with a warning"; it has produced a tree GTK refused.

import GLib from 'gi://GLib';

/**
 * Declared locally, deliberately: this module is GJS-only, and `console.error`
 * would be the wrong primitive here — it routes through the GLib log system,
 * i.e. straight back into the writer func below. `printerr` writes to stderr and
 * bypasses it, which is the only way to forward a message from inside the
 * handler that is capturing it.
 */
declare const printerr: (message: string) => void;

export interface DiagnosticsGate {
    /** Warning-or-worse messages seen since the last `reset()`. */
    readonly seen: readonly string[];
    reset(): void;
    /** Throw if anything was recorded, naming every message. */
    assertQuiet(context?: string): void;
}

let installed: DiagnosticsGate | null = null;

/**
 * Install the writer func once per process and return the gate.
 *
 * `GLib.log_set_writer_func` is process-global and replaces GLib's own writer, so
 * this forwards rather than swallows — a writer that ate its input would hide the
 * messages it exists to detect, including its own. The forward threshold matches
 * what GLib's default writer does with `G_MESSAGES_DEBUG` unset: message-and-above
 * is printed, info/debug is not.
 */
export function installDiagnosticsGate(): DiagnosticsGate {
    if (installed) return installed;

    const seen: string[] = [];
    const decoder = new TextDecoder();
    const verbose = GLib.getenv('G_MESSAGES_DEBUG') !== null;

    GLib.log_set_writer_func((level, fields) => {
        // A throw in here is logged, which re-enters this function.
        try {
            const raw = (fields as unknown as { MESSAGE?: unknown } | null)?.MESSAGE;
            const message = raw instanceof Uint8Array ? decoder.decode(raw) : String(raw ?? '');
            // MASK the level: `g_logv` ORs in `G_LOG_FLAG_FATAL` when the level is
            // in the fatal mask, so `WARNING|FATAL` is 18 and an unmasked `<= 16`
            // stops recording exactly the messages this exists to catch — under
            // `--g-fatal-warnings`, i.e. the strictest run there is.
            const severity = level & GLib.LogLevelFlags.LEVEL_MASK;
            if (severity <= GLib.LogLevelFlags.LEVEL_WARNING) seen.push(message);
            if (verbose || severity <= GLib.LogLevelFlags.LEVEL_MESSAGE) printerr(message);
        } catch {
            printerr('<gtk-host: a log message could not be decoded>');
        }
        return GLib.LogWriterOutput.HANDLED;
    });

    installed = {
        seen,
        reset() {
            seen.length = 0;
        },
        assertQuiet(context?: string) {
            if (seen.length === 0) return;
            const count = seen.length;
            const messages = seen.join('\n  ');
            seen.length = 0; // do not blame the next test for this one's mess
            throw new Error(
                `${context ? context + ': ' : ''}GTK reported ${count} diagnostic(s) ` +
                    `that would have passed at exit 0:\n  ${messages}`,
            );
        },
    };
    return installed;
}
