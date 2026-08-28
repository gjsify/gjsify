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
    /** Warning-or-worse messages ABOUT THE TREE, seen since the last `reset()`. */
    readonly seen: readonly string[];
    /**
     * Warning-or-worse messages about the HOST's graphics stack, kept apart.
     *
     * Recorded rather than dropped: `assertQuiet` names the count so a run is
     * never quietly forgiven, and a caller that genuinely wants to assert on the
     * environment can read them.
     */
    readonly environment: readonly string[];
    reset(): void;
    /** Throw if anything about the tree was recorded, naming every message. */
    assertQuiet(context?: string): void;
}

/**
 * Diagnostics that describe THE MACHINE, not the tree under test.
 *
 * GSK brings up a renderer the first time a surface is realised, and whether that
 * succeeds is a property of the host: a CI container with no `/dev/dri` and a
 * PowerVR Vulkan ICD emits eight warnings about enumerating physical devices
 * before any widget of ours is drawn. MEASURED — the Fedora 44 CI leg turned a
 * green vector red on exactly that, while the same vector was silent on a desktop
 * with a working GPU. That is a claim about the runner wearing the costume of a
 * claim about the code, and this gate exists to catch the second kind.
 *
 * The prefix is safe to classify wholesale BECAUSE THIS CODEBASE ISSUES NO VULKAN
 * CALLS. Nothing here builds a `GskRenderer`, picks a backend or touches a device;
 * every `Vulkan:` record originates inside GSK/GDK bringing up the display. A
 * mis-parented widget, a refused property, a bad CSS rule — the whole class this
 * module was written for — never surfaces under this prefix.
 */
const ENVIRONMENT_PREFIXES: readonly string[] = ['Vulkan: '];

/** Whether `message` describes the host's graphics stack rather than the tree. */
export function isEnvironmentDiagnostic(message: string): boolean {
    return ENVIRONMENT_PREFIXES.some((prefix) => message.startsWith(prefix));
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
 * BLANK LIST, over a test that had just constructed the whole table. A gate that can
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
    const environment: string[] = [];
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
            if (severity <= GLib.LogLevelFlags.LEVEL_WARNING) {
                (isEnvironmentDiagnostic(message) ? environment : seen).push(message);
            }
            if (verbose || severity <= GLib.LogLevelFlags.LEVEL_MESSAGE) printerr(message);
        } catch {
            printerr('<gtk-host: a log message could not be decoded>');
        }
        return GLib.LogWriterOutput.HANDLED;
    });

    installed = {
        seen,
        environment,
        reset() {
            seen.length = 0;
            environment.length = 0;
        },
        assertQuiet(context?: string) {
            const setAside = environment.length;
            environment.length = 0;
            if (seen.length === 0) return;
            const count = seen.length;
            const messages = seen.join('\n  ');
            seen.length = 0; // do not blame the next test for this one's mess
            // The set-aside count is printed even though it did not cause the
            // failure: a filter nobody can see is a filter nobody can audit.
            const aside =
                setAside > 0
                    ? `\n  (plus ${setAside} diagnostic(s) about the HOST's graphics stack, not the tree — see isEnvironmentDiagnostic)`
                    : '';
            throw new Error(
                `${context ? context + ': ' : ''}GTK reported ${count} diagnostic(s) ` +
                    `that would have passed at exit 0:\n  ${messages}${aside}`,
            );
        },
    };
    return installed;
}
