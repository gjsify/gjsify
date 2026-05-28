// SPDX-License-Identifier: BSD-2-Clause
// Ported from https://github.com/motdotla/dotenv/blob/v17.4.2/tests/test-config.js
// Original: Copyright (c) 2015, Scott Motte. BSD-2-Clause.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// config() is the part of the library that mutates process.env.
// This is the primary cross-platform smoke test for the @gjsify/process
// process.env Proxy (GLib.{get,set,unset}env round-trip on GJS,
// native object on Node). Each test cleans up the env keys it sets so
// subsequent suites observe a clean environment.
//
// sinon-based stub coverage (CLI tips, debug logging, ~ expansion via
// os.homedir stub, fs.readFileSync stub) is intentionally skipped —
// those exercise mocking infra, not dotenv or `@gjsify/*` semantics.

import { describe, it, expect } from '@gjsify/unit';
import { config } from 'dotenv';
import { pathToFileURL } from 'node:url';
import { ENV_PATH, ENV_LOCAL_PATH } from './fixtures.js';

// Keys this suite touches in process.env. Reset before/after each test.
const TOUCHED_KEYS = [
    'BASIC',
    'LOCAL',
    'SINGLE_QUOTES',
    'AFTER_LINE',
    'EMPTY',
    'EMPTY_SINGLE_QUOTES',
    'EMPTY_DOUBLE_QUOTES',
    'EMPTY_BACKTICKS',
    'DOUBLE_QUOTES',
    'EXPAND_NEWLINES',
    'USERNAME',
    'SPACED_KEY',
    'EXPORT_IS_DECLARED',
    'INLINE_COMMENTS',
    'EQUAL_SIGNS',
    'RETAIN_INNER_QUOTES',
    'TRIM_SPACE_FROM_UNQUOTED',
    'EXPORT_IS_DECLARED_WITH_SPACING',
    'EXPORT_IS_DECLARED_WITH_SOME_VALUE',
    'EXPORT_IS_DECLARED_WITH_SOME_VALUE_SPACED',
    'EXPORT_IS_DECLARED_WITH_SOME_VALUE_AND_SPACING',
];

function resetEnv(): void {
    for (const k of TOUCHED_KEYS) delete process.env[k];
}

export default async () => {
    await describe('config() — file path loading', async () => {
        await it('takes a string for the path option (and writes to process.env)', () => {
            resetEnv();
            try {
                const env = config({ path: ENV_PATH, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                expect(process.env.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });

        await it('takes a single-element array for the path option', () => {
            resetEnv();
            try {
                const env = config({ path: [ENV_PATH], quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                expect(process.env.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });

        await it('takes two or more files in the array for the path option (first file key wins)', () => {
            resetEnv();
            try {
                const env = config({ path: [ENV_LOCAL_PATH, ENV_PATH], quiet: true });
                // .env.local has BASIC=local_basic — first file wins
                expect(env.parsed?.BASIC).toBe('local_basic');
                expect(process.env.BASIC).toBe('local_basic');
            } finally {
                resetEnv();
            }
        });

        await it('merges values from .env.local + .env — first-file-wins for collisions, union for unique keys', () => {
            resetEnv();
            try {
                const env = config({ path: [ENV_LOCAL_PATH, ENV_PATH], quiet: true });
                // BASIC in both — .env.local wins
                expect(env.parsed?.BASIC).toBe('local_basic');
                expect(process.env.BASIC).toBe('local_basic');
                // LOCAL only in .env.local
                expect(env.parsed?.LOCAL).toBe('local');
                expect(process.env.LOCAL).toBe('local');
                // SINGLE_QUOTES only in .env
                expect(env.parsed?.SINGLE_QUOTES).toBe('single_quotes');
                expect(process.env.SINGLE_QUOTES).toBe('single_quotes');
            } finally {
                resetEnv();
            }
        });

        await it('does NOT overwrite a value already present in process.env (no override)', () => {
            resetEnv();
            try {
                process.env.BASIC = 'existing';
                const env = config({ path: [ENV_LOCAL_PATH, ENV_PATH], quiet: true });
                // parsed object still reflects what the file said
                expect(env.parsed?.BASIC).toBe('local_basic');
                // process.env stays untouched
                expect(process.env.BASIC).toBe('existing');
            } finally {
                resetEnv();
            }
        });

        await it('accepts a URL instance for the path option', () => {
            resetEnv();
            try {
                const fileUrl = pathToFileURL(ENV_PATH);
                const env = config({ path: fileUrl, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                expect(process.env.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });
    });

    await describe('config() — override semantics', async () => {
        await it('does not write over keys already in process.env', () => {
            resetEnv();
            try {
                process.env.BASIC = 'bar';
                const env = config({ path: ENV_PATH, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                expect(process.env.BASIC).toBe('bar');
            } finally {
                resetEnv();
            }
        });

        await it('writes over keys already in process.env when override:true', () => {
            resetEnv();
            try {
                process.env.BASIC = 'bar';
                const env = config({ path: ENV_PATH, override: true, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                expect(process.env.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });

        await it('treats an empty-string process.env value as already-set (no override)', () => {
            resetEnv();
            try {
                process.env.BASIC = '';
                const env = config({ path: ENV_PATH, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                // The key is present (even if empty) — no overwrite without override
                expect(process.env.BASIC).toBe('');
            } finally {
                resetEnv();
            }
        });

        await it('overrides an empty-string process.env value when override:true', () => {
            resetEnv();
            try {
                process.env.BASIC = '';
                const env = config({ path: ENV_PATH, override: true, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                expect(process.env.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });
    });

    await describe('config() — processEnv option (alternate target object)', async () => {
        await it('writes to a custom object instead of process.env', () => {
            resetEnv();
            try {
                process.env.BASIC = 'other';
                const myObject: Record<string, string | undefined> = {};
                const env = config({ path: ENV_PATH, processEnv: myObject, quiet: true });
                expect(env.parsed?.BASIC).toBe('basic');
                // process.env left untouched
                expect(process.env.BASIC).toBe('other');
                // custom target populated
                expect(myObject.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });

        await it('custom processEnv preserves first-file-wins across multiple files', () => {
            const target: Record<string, string | undefined> = {};
            const env = config({
                path: [ENV_LOCAL_PATH, ENV_PATH],
                processEnv: target,
                quiet: true,
            });
            expect(env.parsed?.BASIC).toBe('local_basic');
            expect(target.BASIC).toBe('local_basic');
            expect(target.LOCAL).toBe('local');
            expect(target.SINGLE_QUOTES).toBe('single_quotes');
            // process.env not touched
            expect(process.env.BASIC).toBeUndefined();
        });

        await it('custom processEnv respects no-overwrite semantics (per-target, not global)', () => {
            const target: Record<string, string | undefined> = { BASIC: 'preset' };
            config({ path: ENV_PATH, processEnv: target, quiet: true });
            expect(target.BASIC).toBe('preset');
        });

        await it('custom processEnv with override:true overwrites preset values', () => {
            const target: Record<string, string | undefined> = { BASIC: 'preset' };
            config({ path: ENV_PATH, processEnv: target, override: true, quiet: true });
            expect(target.BASIC).toBe('basic');
        });
    });

    await describe('config() — return shape + error handling', async () => {
        await it('returns { parsed } with no error on success', () => {
            resetEnv();
            try {
                const env = config({ path: ENV_PATH, quiet: true });
                expect(env.error).toBeFalsy();
                expect(env.parsed?.BASIC).toBe('basic');
            } finally {
                resetEnv();
            }
        });

        await it('returns { error } when the .env file does not exist', () => {
            // Use a path nobody would ever have on disk
            const bogusPath = '/tmp/__dotenv-integration-does-not-exist__/.env';
            const env = config({ path: bogusPath, quiet: true });
            // dotenv catches the ENOENT and returns it on `error`
            expect(env.error).toBeTruthy();
            expect(env.error instanceof Error).toBe(true);
        });
    });
};
