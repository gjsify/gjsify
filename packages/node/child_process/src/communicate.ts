// Bounded synchronous `Gio.Subprocess` communication.
//
// Reference: Node.js lib/child_process.js `spawnSync` (`options.timeout` →
// `ETIMEDOUT` + the child killed with `options.killSignal`).
//
// WHY THIS EXISTS
// ---------------
// `Gio.Subprocess.communicate()` blocks the calling thread and never iterates a
// GLib main context, so a `GLib.timeout_add()` armed around it can never fire.
// The previous implementation worked around that by prepending the GNU
// coreutils `timeout(1)` binary to argv and decoding its exit code 124. That is
// three problems in one: it only exists on GNU userlands (macOS ships it as
// `gtimeout` only via Homebrew, Windows not at all), it reports the wrapper's
// pid instead of the child's, and it cannot report the real termination signal.
//
// Instead we drive `communicate_async()` on a PRIVATE main context pushed as
// the thread-default. GIO captures the thread-default context when the GTask is
// created, so both the task completion and its internal stdio sources land on
// our context — iterating it dispatches ONLY our own sources. No application
// timer, GTK event or unrelated GIO callback can run, which keeps the
// re-entrancy profile identical to the blocking `communicate()` it replaces,
// while a timeout source attached to the same context is still free to fire.
//
// Portable by construction: no external binary, correct child pid, real kill
// signal, same code path on every platform GIO runs on.

import GLib from '@girs/glib-2.0';
import type Gio from '@girs/gio-2.0';

export interface CommunicateResult {
    stdout: GLib.Bytes | null;
    stderr: GLib.Bytes | null;
    /** `true` when the deadline elapsed and `onTimeout` was invoked. */
    timedOut: boolean;
    /** Error thrown by `communicate_finish()`, if any. */
    error: unknown;
}

/**
 * Run `proc.communicate()` semantics with a wall-clock deadline.
 *
 * Returns once the child's stdio has been fully drained and the child reaped —
 * exactly like the blocking `communicate()`. When `timeoutMs` elapses first,
 * `onTimeout` is invoked (the caller kills the child there) and the loop keeps
 * running until the now-dying child closes its pipes, so the partial output is
 * still returned. `timedOut` records that the deadline was hit.
 *
 * @param proc        the spawned subprocess
 * @param stdinBytes  data to write to the child's stdin, or `null`
 * @param timeoutMs   deadline in milliseconds (must be > 0)
 * @param onTimeout   invoked on the deadline; expected to kill `proc`
 */
export function communicateWithTimeout(
    proc: Gio.Subprocess,
    stdinBytes: GLib.Bytes | null,
    timeoutMs: number,
    onTimeout: () => void,
): CommunicateResult {
    const result: CommunicateResult = { stdout: null, stderr: null, timedOut: false, error: null };
    const context = GLib.MainContext.new();
    let timer: GLib.Source | null = null;
    let done = false;

    context.push_thread_default();
    try {
        proc.communicate_async(stdinBytes, null, (_source: Gio.Subprocess | null, res: Gio.AsyncResult) => {
            try {
                const ret = proc.communicate_finish(res);
                result.stdout = ret[1] ?? null;
                result.stderr = ret[2] ?? null;
            } catch (err: unknown) {
                result.error = err;
            }
            done = true;
        });

        timer = GLib.timeout_source_new(timeoutMs);
        timer.set_callback(() => {
            result.timedOut = true;
            onTimeout();
            return GLib.SOURCE_REMOVE;
        });
        timer.attach(context);

        // `iteration(true)` blocks until one of OUR sources is ready, so this is
        // a real wait and not a spin. The async op always completes through the
        // context (GIO never finishes a task synchronously), so `done` is
        // guaranteed to be reached for a child that terminates.
        while (!done) context.iteration(true);
    } finally {
        if (timer !== null) timer.destroy();
        context.pop_thread_default();
    }

    return result;
}
