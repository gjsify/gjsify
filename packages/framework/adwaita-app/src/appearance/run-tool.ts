// Run a system tool and collect its stdout — for the two OSes whose settings
// have no introspectable reader (see win32.ts and darwin.ts for why).

import Gio from 'gi://Gio?version=2.0';

/**
 * stdout of `argv` when it exits 0, `null` otherwise — including when the tool
 * is missing. Both tools exit non-zero for "no such value", which the readers
 * treat as absence, so the two cases need no distinction here.
 */
export function runTool(argv: readonly string[]): Promise<string | null> {
    return new Promise((resolve) => {
        let child: Gio.Subprocess;
        try {
            child = Gio.Subprocess.new([...argv], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            // Gio.Subprocess.new throws when the executable cannot be spawned (not on PATH).
            resolve(null);
            return;
        }
        child.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, stdout] = (source as Gio.Subprocess).communicate_utf8_finish(result);
                resolve((source as Gio.Subprocess).get_successful() ? (stdout ?? '') : null);
            } catch {
                // communicate_utf8_finish throws on a read error or invalid UTF-8; no value either way.
                resolve(null);
            }
        });
    });
}
