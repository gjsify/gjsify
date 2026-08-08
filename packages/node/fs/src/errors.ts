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
