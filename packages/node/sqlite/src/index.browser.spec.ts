// oxlint-disable typescript/no-explicit-any -- spec inspects thrown error .code on the browser stub
// SPDX-License-Identifier: MIT
// Browser-target conformance spec for @gjsify/sqlite.
//
// Imports the browser implementation directly (`./browser.js`) rather than
// `node:sqlite` — the package's `exports` map has no `browser` condition, so a
// bare `node:sqlite` import would not select the stub, and the GJS impl drags
// in `gi://Gda` which has no browser equivalent.
//
// Locks in the current honest browser behavior (slot: browser:partial — the
// capability-slot stub):
//   - The module imports without throwing (consumers can type-check + ship
//     code that conditionally uses SQLite).
//   - `constants` is present (re-exported from the GJS constants table).
//   - Constructing a `DatabaseSync` / `StatementSync`, or calling any database
//     op, throws a structured ERR_NOT_SUPPORTED.

import { describe, it, expect } from '@gjsify/unit';
import { DatabaseSync, StatementSync, constants } from './browser.js';

function thrownCode(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (e) {
        return (e as any).code;
    }
    return undefined;
}

export default async () => {
    await describe('sqlite (browser)', async () => {
        await describe('module surface', async () => {
            await it('imports without throwing and exposes the classes', async () => {
                expect(typeof DatabaseSync).toBe('function');
                expect(typeof StatementSync).toBe('function');
            });

            await it('exposes the SQLite constants table', async () => {
                expect(constants).toBeDefined();
                expect(constants.SQLITE_CHANGESET_OMIT).toBe(0);
            });
        });

        await describe('DatabaseSync', async () => {
            await it('constructor throws ERR_NOT_SUPPORTED', async () => {
                expect(thrownCode(() => new DatabaseSync(':memory:'))).toBe('ERR_NOT_SUPPORTED');
            });

            await it('constructor error message points at a WASM backend', async () => {
                let message = '';
                try {
                    // eslint-disable-next-line no-new
                    new DatabaseSync(':memory:');
                } catch (e) {
                    message = (e as Error).message;
                }
                expect(message).toContain('not available in the browser polyfill');
            });
        });

        await describe('StatementSync', async () => {
            await it('constructor throws ERR_NOT_SUPPORTED', async () => {
                expect(thrownCode(() => new StatementSync())).toBe('ERR_NOT_SUPPORTED');
            });

            await it('prototype ops throw ERR_NOT_SUPPORTED when invoked directly', async () => {
                // The constructor throws, so reach the unreachable prototype
                // methods via the prototype to lock in their failure contract.
                const proto = StatementSync.prototype as unknown as {
                    all: (this: unknown) => unknown;
                    run: (this: unknown) => unknown;
                };
                expect(thrownCode(() => proto.all.call({}))).toBe('ERR_NOT_SUPPORTED');
                expect(thrownCode(() => proto.run.call({}))).toBe('ERR_NOT_SUPPORTED');
            });
        });
    });
};
