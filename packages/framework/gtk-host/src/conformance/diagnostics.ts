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
/**
 * What a log record SAYS — and never the empty string.
 *
 * `MESSAGE` is a structured field like any other, and a record is allowed to
 * arrive without one. The first version answered `String(raw ?? '')`, so such a
 * record was counted and then described as nothing: a CI run failed with
 * `GTK reported 1 diagnostic(s) that would have passed at exit 0:` followed by a
 * BLANK LIST, over a test that had just constructed 164 widgets. A gate that can
 * count a failure but not name it sends the reader back to guessing, which is the
 * state this whole module exists to end.
 *
 * So a record with no `MESSAGE` is rendered from the fields it does carry.
 */
export function describeLogRecord(fields: unknown, decoder: TextDecoder = new TextDecoder()): string {
    const text = (value: unknown): string => (value instanceof Uint8Array ? decoder.decode(value) : String(value));
    const record = fields as Record<string, unknown> | null;
    const raw = record?.MESSAGE;
    if (raw !== undefined && raw !== null) {
        const message = text(raw);
        if (message !== '') return message;
    }
    const rest = record
        ? Object.keys(record)
              .filter((key) => key !== 'MESSAGE' && record[key] !== undefined && record[key] !== null)
              .map((key) => `${key}=${text(record[key])}`)
        : [];
    return rest.length > 0
        ? `<no MESSAGE field> ${rest.join(' ')}`
        : '<a log record with no MESSAGE and no other field>';
}

export function installDiagnosticsGate(): DiagnosticsGate {
    if (installed) return installed;

    const seen: string[] = [];
    const decoder = new TextDecoder();
    const verbose = GLib.getenv('G_MESSAGES_DEBUG') !== null;

    GLib.log_set_writer_func((level, fields) => {
        // A throw in here is logged, which re-enters this function.
        try {
            const message = describeLogRecord(fields, decoder);
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
