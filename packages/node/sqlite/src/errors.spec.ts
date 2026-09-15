// Coverage for `isNodeSqliteError` — the guard every translating catch in this
// package asks before wrapping.
//
// THE DRIFT THIS EXISTS FOR: the guard is a chain of `instanceof` tests, one per
// error class in `errors.ts`. Adding a ninth class and forgetting the chain
// costs nothing at the time and is invisible afterwards — the new error simply
// gets re-wrapped as a `SqliteError`, so a consumer branching on `code` sees
// `ERR_SQLITE_ERROR` for something that was never a SQLite error. Nothing about
// that looks wrong in a diff, in a type check, or in any other test here.
//
// So the chain is compared against the module's own exports rather than against
// a second list somebody has to remember.

import { describe, it, expect } from '@gjsify/unit';
import * as errors from './errors.js';

/**
 * Every error class this module exports, by name.
 *
 * Selected by PROTOTYPE, not by name. `name.endsWith('Error')` is the obvious
 * filter and it also matches `isNodeSqliteError`, the guard itself — measured,
 * this test's first run reported the guard as an error class it failed to
 * recognise.
 */
function exportedErrorClasses(): string[] {
    return Object.entries(errors)
        .filter(
            ([, value]) => typeof value === 'function' && (value as { prototype?: unknown }).prototype instanceof Error,
        )
        .map(([name]) => name)
        .sort();
}

/** One instance of each, constructed with the arguments its shape allows. */
function instantiate(name: string): unknown {
    const Klass = (errors as unknown as Record<string, new (...args: never[]) => unknown>)[name]!;
    // Every class here takes zero or more string-ish arguments; three covers all
    // of them, and a constructor that ignores the extras is unaffected.
    return new (Klass as unknown as new (...args: unknown[]) => unknown)('a', 'b', 'c');
}

export default async () => {
    await describe('isNodeSqliteError', async () => {
        await it('recognises every error class this module exports', async () => {
            const missed = exportedErrorClasses().filter((name) => !errors.isNodeSqliteError(instantiate(name)));
            // Named rather than counted: the failure message has to say WHICH
            // class was added without the chain, or it sends the reader hunting.
            expect(missed).toStrictEqual([]);
        });

        await it('covers more than one class, so the check above can fail', async () => {
            // A guard over an empty list passes trivially. This is the
            // discriminator for the discriminator.
            expect(exportedErrorClasses().length > 1).toBe(true);
        });

        await it('does not claim a foreign error', async () => {
            // The whole point: libgda's GLib.Error must NOT pass, or the catch
            // that translates it would hand the raw GError to the consumer.
            expect(errors.isNodeSqliteError(new Error('plain'))).toBe(false);
            expect(errors.isNodeSqliteError(new TypeError('typed'))).toBe(false);
            expect(errors.isNodeSqliteError({ message: 'no such table: t' })).toBe(false);
            expect(errors.isNodeSqliteError(null)).toBe(false);
            expect(errors.isNodeSqliteError(undefined)).toBe(false);
        });
    });

    await describe('sqliteErrorMessage', async () => {
        await it('reads the property rather than stringifying', async () => {
            // `String(e)` on a GJS GLib.Error yields
            // "GLib.Error gda_server_provider_error: no such table: t"; the
            // property alone is what node:sqlite reports.
            expect(errors.sqliteErrorMessage({ message: 'no such table: t' })).toBe('no such table: t');
            expect(errors.sqliteErrorMessage(new Error('boom'))).toBe('boom');
        });

        await it('falls back to a string for anything without a message', async () => {
            expect(errors.sqliteErrorMessage('raw')).toBe('raw');
            expect(errors.sqliteErrorMessage(null)).toBe('null');
            expect(errors.sqliteErrorMessage({ message: 42 })).toBe('[object Object]');
        });
    });
};
