// Explicit Resource Management (`using` / `await using`) support for streams.
//
// GJS / SpiderMonkey (as of gjs 1.88) does not expose the well-known symbols
// `Symbol.dispose` / `Symbol.asyncDispose`. The universal downlevel convention
// emitted by tsc / esbuild / babel for `using` declarations resolves the symbol
// as `Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose")`, i.e. it falls
// back to the REGISTERED symbol when the native one is missing. We therefore
// register our dispose methods under the very same registered symbol so that
// third-party `await using stream = …` code interoperates with our streams.
//
// Reference: refs/node/lib/internal/streams/readable.js
//            (Readable.prototype[SymbolAsyncDispose])
//            refs/node/lib/internal/streams/writable.js
//            (Writable.prototype[SymbolAsyncDispose])

import { finished } from '../utils/finished.js';
import type { Readable_ } from '../readable.js';
import type { Writable_ } from '../writable.js';

/** The `Symbol.asyncDispose` key, resolved through the registered-symbol fallback. */
export const kAsyncDispose: symbol =
    (Symbol as { asyncDispose?: symbol }).asyncDispose ?? Symbol.for('Symbol.asyncDispose');

/** The `Symbol.dispose` key, resolved through the registered-symbol fallback. */
export const kDispose: symbol = (Symbol as { dispose?: symbol }).dispose ?? Symbol.for('Symbol.dispose');

/** AbortError matching Node's shape — used to mark a not-yet-ended stream that dispose tore down. */
function createAbortError(): Error {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    (err as Error & { code?: string }).code = 'ABORT_ERR';
    return err;
}

/**
 * Shared `[Symbol.asyncDispose]` body for Readable and Writable.
 *
 * Mirrors Node: if the stream is not already destroyed, destroy it — passing an
 * AbortError when it had not finished/ended so consumers can tell a disposed
 * stream from a cleanly completed one — then resolve once it has fully closed.
 * Only an error *other* than the one we injected rejects the dispose.
 */
export async function streamAsyncDispose(
    stream: Readable_ | Writable_,
    alreadyEnded: boolean,
): Promise<void> {
    let injected: Error | undefined;
    if (!stream.destroyed) {
        injected = alreadyEnded ? undefined : createAbortError();
        stream.destroy(injected);
    }
    await new Promise<void>((resolve, reject) => {
        finished(stream, (err) => {
            if (err && err !== injected) reject(err);
            else resolve();
        });
    });
}
