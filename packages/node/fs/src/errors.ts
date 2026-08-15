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
 * Why it is a shared helper and not a line per site: the sites that need it all
 * spelled the same non-null assertion — `callback!`, `maybeCb!` — and that
 * assertion is the defect, not a symptom of it. It silences the one type the
 * compiler had, so a missing callback survived into the async body and surfaced as
 * `callback is not a function` INSIDE a promise chain. Under GJS that is invisible:
 * there is no host hook for `unhandledRejection`, so the runner never learns the
 * caller made a mistake.
 *
 * THE `!` HEURISTIC IS NOT THE RULE, which is how the first sweep missed a third of
 * them. `fs.chmod` declares its callback REQUIRED, so it needed no assertion — and a
 * type is not enforced at a JS boundary. The rule is: every callback-form entry
 * point validates, checked against Node one at a time.
 *
 * Node validates all of them synchronously with `ERR_INVALID_ARG_TYPE`. The two
 * exceptions are `fs.close(fd)` and `WriteStream.close()`, genuinely optional and
 * silent — #1039 settled those and `fs-semantics.spec.ts` K-16 pins them, so do NOT
 * route them through here — plus `fs.rm`, which Node does not validate either (it
 * crashes inside `internal/fs/rimraf` instead; `status/open-todos.md` records it).
 *
 * `argName` is a parameter because Node is not uniform: `opendir` says `"callback"`
 * and `watchFile` says `"listener"`, while the rest say `"cb"`.
 */
export function requireCallback<T>(
    value: T,
    argName: 'cb' | 'callback' | 'listener' = 'cb',
    // oxlint-disable-next-line typescript/no-explicit-any -- the return type is the caller's own callback type, which each overload-impl signature already narrows; a generic here would have to be instantiated at every site to say the same thing.
): T & ((...args: any[]) => void) {
    if (typeof value === 'function') return value as T & ((...args: never[]) => void);
    const error = new TypeError(
        `The "${argName}" argument must be of type function. Received ${describeReceived(value)}`,
    ) as NodeJS.ErrnoException;
    error.code = 'ERR_INVALID_ARG_TYPE';
    throw error;
}

/**
 * Node's `Received …` clause, from measurement rather than from its source:
 *
 *   undefined            → `undefined`
 *   null                 → `null`
 *   42                   → `type number (42)`
 *   10n                  → `type bigint (10n)`      the `n` is part of it
 *   'x'                  → `type string ('x')`
 *   "it's"               → `type string ("it's")`   quotes swap, not escape
 *   'y'.repeat(40)       → `type string ('yyy…yyy...')`  truncated at 25 + `...`
 *   {} / [] / new Map()  → `an instance of Object|Array|Map`
 *
 * NOT reproduced, deliberately: Node reaches `util.inspect` for exotic values, so a
 * null-prototype object renders `[Object: null prototype] {}` there and
 * `an instance of Object` here. Chasing that means importing an inspector into a
 * message nobody matches on — callers branch on `err.code`. The claim is scoped to
 * the rows above rather than to "whatever Node prints".
 */
function describeReceived(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'object') {
        const name = (value as { constructor?: { name?: string } }).constructor?.name;
        return `an instance of ${name && name.length > 0 ? name : 'Object'}`;
    }
    if (typeof value === 'string') {
        const shown = value.length > 25 ? `${value.slice(0, 25)}...` : value;
        // Node swaps the quote rather than escaping it.
        return shown.includes("'") ? `type string ("${shown}")` : `type string ('${shown}')`;
    }
    if (typeof value === 'bigint') return `type bigint (${value}n)`;
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
