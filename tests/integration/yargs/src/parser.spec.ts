// SPDX-License-Identifier: MIT
// Ported from yargs upstream test/yargs.cjs (sections covering parse() and
// argv access). Source not vendored under refs/ to avoid workspace drift —
// inspect with `cat node_modules/yargs/test/yargs.cjs` or upstream
// https://github.com/yargs/yargs/blob/main/test/yargs.cjs.
// Original: Copyright (c) Yargs Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, mocha/chai dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import yargs from 'yargs/yargs';

export default async () => {
    await describe('yargs parser — basic argv parsing', async () => {
        await it('parses positional bare strings into _', async () => {
            const argv = await yargs(['foo', 'bar', 'baz']).parse();
            expect(argv._).toStrictEqual(['foo', 'bar', 'baz']);
        });

        await it('parses long-form --flag values', async () => {
            const argv = await yargs(['--name', 'Indiana']).parse();
            expect(argv.name).toBe('Indiana');
        });

        await it('parses short-form -x values', async () => {
            const argv = await yargs(['-x', '42']).parse();
            expect(argv.x).toBe(42);
        });

        await it('treats lone --flag as boolean true', async () => {
            const argv = await yargs(['--verbose']).parse();
            expect(argv.verbose).toBe(true);
        });

        await it('treats --no-flag as explicit false', async () => {
            const argv = await yargs(['--no-color']).parse();
            expect(argv.color).toBe(false);
        });

        await it('honours -- to terminate option parsing into _', async () => {
            const argv = await yargs(['-x', '1', '--', 'a', '-b'])
                .parserConfiguration({ 'populate--': true })
                .parse();
            expect(argv.x).toBe(1);
            expect(argv['--']).toStrictEqual(['a', '-b']);
        });

        await it('parses synchronously when no async work is queued', async () => {
            // .parse() is sync when no .check()/.middleware() returns a promise.
            const argv = yargs(['--port', '8080']).parseSync();
            expect(argv.port).toBe(8080);
        });

        await it('exposes argv as a plain object via the .argv getter', async () => {
            const parser = yargs(['--foo', 'bar']);
            const argv = parser.argv as Record<string, unknown>;
            expect(argv.foo).toBe('bar');
        });

        await it('coerces numeric-looking strings into numbers by default', async () => {
            const argv = await yargs(['--n', '123']).parse();
            expect(typeof argv.n).toBe('number');
            expect(argv.n).toBe(123);
        });

        await it('keeps --string values as strings when declared', async () => {
            const argv = await yargs(['--id', '0007'])
                .string('id')
                .parse();
            expect(argv.id).toBe('0007');
        });
    });
};
