// SPDX-License-Identifier: BSD-2-Clause
// Ported from https://github.com/motdotla/dotenv/blob/v17.4.2/tests/test-populate.js
// Original: Copyright (c) 2015, Scott Motte. BSD-2-Clause.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// populate(target, parsed, options?) is the lower-level write
// surface. Upstream uses sinon to stub `fs.readFileSync` and
// `dotenv.parse` — we drop those stubs and call populate() directly
// against plain JS objects + process.env (the real Proxy on GJS).

import { describe, it, expect } from '@gjsify/unit';
import { populate } from 'dotenv';

const TOUCHED_KEYS = ['test', 'GJSIFY_POP_KEEP', 'GJSIFY_POP_OVERRIDE', 'GJSIFY_POP_NEW'];

function resetEnv(): void {
    for (const k of TOUCHED_KEYS) delete process.env[k];
}

export default async () => {
    await describe('populate() — plain target object', async () => {
        await it('applies all keys to an empty target', () => {
            const parsed = { test: '1', home: '2' };
            const processEnv: Record<string, string | undefined> = {};
            populate(processEnv, parsed);
            expect(processEnv).toStrictEqual(parsed);
        });

        await it('does not overwrite a key that already exists on the target', () => {
            const existing = 'bar';
            const parsed = { test: 'fromfile' };
            const target: Record<string, string | undefined> = { test: existing };
            populate(target, parsed);
            expect(target.test).toBe(existing);
        });

        await it('writes over an existing key when override:true', () => {
            const existing = 'bar';
            const parsed = { test: 'fromfile' };
            const target: Record<string, string | undefined> = { test: existing };
            populate(target, parsed, { override: true });
            expect(target.test).toBe(parsed.test);
        });

        await it('throws OBJECT_REQUIRED when parsed is not an object', () => {
            let threw: unknown = null;
            try {
                // upstream test passes '' as `parsed` — typeof === 'string', not 'object'
                populate({} as Record<string, string | undefined>, '' as unknown as Record<string, string>);
            } catch (e) {
                threw = e;
            }
            expect(threw).toBeTruthy();
            expect((threw as Error).message).toBe(
                'OBJECT_REQUIRED: Please check the processEnv argument being passed to populate',
            );
        });

        await it('returns the populated key set (only newly-written keys)', () => {
            const target: Record<string, string | undefined> = { skipme: 'keep' };
            const populated = populate(target, { skipme: 'change', newkey: 'added' });
            // skipme is preserved on target
            expect(target.skipme).toBe('keep');
            expect(target.newkey).toBe('added');
            // populated reports only what changed — newkey only, not skipme
            expect(populated).toStrictEqual({ newkey: 'added' });
        });

        await it('returns both keys in populated when override:true forces both writes', () => {
            const target: Record<string, string | undefined> = { a: 'old' };
            const populated = populate(target, { a: 'new', b: 'fresh' }, { override: true });
            expect(target.a).toBe('new');
            expect(target.b).toBe('fresh');
            expect(populated).toStrictEqual({ a: 'new', b: 'fresh' });
        });
    });

    await describe('populate() — process.env target (the GJS-sensitive path)', async () => {
        await it('writes a new key into process.env', () => {
            resetEnv();
            try {
                populate(process.env, { GJSIFY_POP_NEW: 'created' });
                expect(process.env.GJSIFY_POP_NEW).toBe('created');
            } finally {
                resetEnv();
            }
        });

        await it('does not overwrite an existing process.env key without override', () => {
            resetEnv();
            try {
                process.env.GJSIFY_POP_KEEP = 'kept';
                populate(process.env, { GJSIFY_POP_KEEP: 'fromfile' });
                expect(process.env.GJSIFY_POP_KEEP).toBe('kept');
            } finally {
                resetEnv();
            }
        });

        await it('overwrites an existing process.env key when override:true', () => {
            resetEnv();
            try {
                process.env.GJSIFY_POP_OVERRIDE = 'kept';
                populate(process.env, { GJSIFY_POP_OVERRIDE: 'fromfile' }, { override: true });
                expect(process.env.GJSIFY_POP_OVERRIDE).toBe('fromfile');
            } finally {
                resetEnv();
            }
        });

        await it('delete on process.env round-trips through the GLib.unsetenv path', () => {
            // Direct test of the @gjsify/process delete trap (sets, then deletes).
            process.env.GJSIFY_POP_NEW = 'transient';
            expect(process.env.GJSIFY_POP_NEW).toBe('transient');
            delete process.env.GJSIFY_POP_NEW;
            expect(process.env.GJSIFY_POP_NEW).toBeUndefined();
        });

        await it('in operator reports presence for keys we just wrote', () => {
            resetEnv();
            try {
                process.env.GJSIFY_POP_NEW = 'present';
                expect('GJSIFY_POP_NEW' in process.env).toBe(true);
                delete process.env.GJSIFY_POP_NEW;
                expect('GJSIFY_POP_NEW' in process.env).toBe(false);
            } finally {
                resetEnv();
            }
        });
    });
};
