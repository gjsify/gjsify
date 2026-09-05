// SPDX-License-Identifier: MIT
//
// The one adapter every GIO call in this package goes through.

import Gio from 'gi://Gio?version=2.0';
import type GObject from 'gi://GObject?version=2.0';

import { Effect } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import { toPlatformError } from './errors.js';

/**
 * The one adapter every method below goes through: a GIO async pair
 * (`x_async`/`x_finish`) as an interruptible Effect.
 *
 * `Effect.callback`'s `signal` is what makes it interruptible for real. Aborting it
 * cancels the `Gio.Cancellable`, GIO completes the operation with
 * `Gio.IOErrorEnum.CANCELLED`, and the `finish` call throws it — at which point
 * nobody is listening, because `resume` after an interrupt is a no-op. So the
 * catch is not swallowing an error, it is declining to report one for work whose
 * requester is gone; anything else would be a defect raised in a dead fiber.
 *
 * `source` IS A PARAMETER, and it has to be. `g_task_is_valid(result, source)`
 * checks that the object finishing an operation is the object that started it, and
 * `Gio.File.new_for_path(p)` returns a NEW GFile every call — two files for the
 * same path are not the same source. Measured on the first run of this showcase:
 * a `finish` on a freshly constructed GFile logged
 * `g_file_real_enumerate_children_finish: assertion 'g_task_is_valid (res, file)'
 * failed`, returned `null`, and the failure surfaced one call later as
 * `can't access property "next_files_async", r is null` — a null-dereference that
 * names nothing about the actual mistake.
 */
export const gioAsync = <A, S extends GObject.Object>(options: {
    readonly method: string;
    readonly path: string;
    /** The object the operation is started ON, and finished on. */
    readonly source: S;
    readonly start: (source: S, cancellable: Gio.Cancellable, done: (result: Gio.AsyncResult) => void) => void;
    readonly finish: (source: S, result: Gio.AsyncResult) => A;
}): Effect.Effect<A, PlatformError> =>
    Effect.callback<A, PlatformError>((resume, signal) => {
        const cancellable = new Gio.Cancellable();
        const onAbort = () => cancellable.cancel();
        signal.addEventListener('abort', onAbort);

        options.start(options.source, cancellable, (result) => {
            signal.removeEventListener('abort', onAbort);
            if (cancellable.is_cancelled()) return;
            try {
                resume(Effect.succeed(options.finish(options.source, result)));
            } catch (error) {
                resume(Effect.fail(toPlatformError({ method: options.method, pathOrDescriptor: options.path, error })));
            }
        });
    });
