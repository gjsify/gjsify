// Reference: Node.js lib/internal/errors.js — filesystem error helpers
// Reimplemented for GJS using Gio error codes

import type { PathLike } from 'node:fs';
import { createNodeError as createNodeErrorGeneric, isNotFoundError } from '@gjsify/utils/core';

export { isNotFoundError };

/**
 * Create a Node.js-style ErrnoException from a Gio error, with fs-specific path/dest fields.
 *
 * An error that ALREADY carries a Node code passes through untouched. The
 * generic mapper reads `err.code` as a NUMERIC `Gio.IOErrorEnum` and looks it
 * up in a table, so a string code misses and falls through to the `|| 'EIO'`
 * default — which means every `try { … } catch (e) { throw createNodeError(e,
 * …) }` in this package silently DOWNGRADED the precise codes `fd-io.ts`
 * reconstructs (EACCES, EEXIST, ENOTDIR, ELOOP, ENAMETOOLONG, EBADF, ESPIPE) to
 * a generic I/O error, and stamped its own syscall and path over them. Since
 * this redesign the precise ones are the common case inside those blocks, so
 * the guard belongs here rather than at each call site: the alternative is
 * remembering to hoist every throw out of every try, once per site, forever.
 */
export function createNodeError(err: unknown, syscall: string, path: PathLike, dest?: PathLike): NodeJS.ErrnoException {
    if (typeof (err as NodeJS.ErrnoException | null)?.code === 'string') return err as NodeJS.ErrnoException;
    const pathStr = path.toString();
    const error = createNodeErrorGeneric(err, syscall, {
        path: pathStr,
        dest: dest?.toString(),
    });
    return error;
}

/**
 * Node's `validateFunction(cb, 'cb')`, which every callback-form `fs` entry point
 * runs before it does any work.
 *
 * Why it is a shared helper and not a line per site: the seventeen call sites that
 * need it all spelled the same non-null assertion — `callback!`, `maybeCb!` — and
 * that assertion is the defect, not a symptom of it. It silences the one type the
 * compiler had, so a missing callback survived into the async body and surfaced as
 * `callback is not a function` INSIDE a promise chain. Under GJS that is invisible:
 * there is no host hook for `unhandledRejection`, so the runner never learns the
 * caller made a mistake. Grep for `!` in a callback position and the class stays
 * closed.
 *
 * MEASURED against node v24.15.0, all seventeen — `copyFile`, `access`,
 * `appendFile`, `readlink`, `truncate`, `mkdir`, `rmdir`, `readFile`, `writeFile`,
 * `fstat`, `ftruncate`, `readv`, `writev`, `glob`, `opendir`, `cp`, `statfs` —
 * throw `ERR_INVALID_ARG_TYPE` synchronously. `fs.close(fd)` and
 * `WriteStream.close()` are the two that genuinely are optional and stay silent;
 * #1039 settled those and `fs-semantics.spec.ts` K-16 pins them, so do NOT route
 * them through here.
 *
 * `argName` is a parameter because Node is not uniform: `opendir` says `"callback"`
 * and the other sixteen say `"cb"`.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- the return type is the caller's own callback type, which each of the seventeen overload-impl signatures already narrows; a generic here would have to be instantiated at every site to say the same thing.
export function requireCallback<T>(value: T, argName: 'cb' | 'callback' = 'cb'): T & ((...args: any[]) => void) {
    if (typeof value === 'function') return value as T & ((...args: never[]) => void);
    const error = new TypeError(
        `The "${argName}" argument must be of type function. Received ${describeReceived(value)}`,
    ) as NodeJS.ErrnoException;
    error.code = 'ERR_INVALID_ARG_TYPE';
    throw error;
}

/**
 * Node's `Received …` clause, reproduced from measurement rather than from its
 * source: `42` → `type number (42)`, `'x'` → `type string ('x')`, `null` → `null`,
 * `{}` → `an instance of Object`, `[]` → `an instance of Array`.
 */
function describeReceived(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'object') {
        const name = (value as { constructor?: { name?: string } }).constructor?.name;
        return `an instance of ${name && name.length > 0 ? name : 'Object'}`;
    }
    if (typeof value === 'string') return `type string ('${value}')`;
    if (typeof value === 'symbol') return `type symbol (${value.toString()})`;
    return `type ${typeof value} (${String(value)})`;
}

/**
 * Node's `ERR_INVALID_STATE`, whose message is the literal `Invalid state: ` prefix
 * plus the caller's clause — measured on v24.15.0 via
 * `fh.readableWebStream()` twice ("Invalid state: The FileHandle is locked") and on
 * a closed handle ("Invalid state: The FileHandle is closed").
 *
 * A plain `Error`, NOT a TypeError — measured, because the guess went the other
 * way: `e instanceof TypeError` is false and `e.name` is `'Error'` on the second
 * `readableWebStream()` call. `ERR_INVALID_STATE` has both an `Error` and a
 * `TypeError` form in `lib/internal/errors.js`, and this is the one the file-handle
 * lock raises.
 */
export function invalidState(clause: string): NodeJS.ErrnoException {
    const error = new Error(`Invalid state: ${clause}`) as NodeJS.ErrnoException;
    error.code = 'ERR_INVALID_STATE';
    return error;
}
