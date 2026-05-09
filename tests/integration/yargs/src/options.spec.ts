// SPDX-License-Identifier: MIT
// Ported from yargs upstream test/yargs.cjs (sections covering option
// configuration: aliases, defaults, choices, demandOption, coerce, count).
// Source not vendored — see header in parser.spec.ts.
// Original: Copyright (c) Yargs Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, mocha/chai dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import yargs from 'yargs/yargs';

export default async () => {
    await describe('yargs option configuration', async () => {
        await it('respects .alias() — both names resolve to the same value', async () => {
            const argv = await yargs(['-f', 'in.txt'])
                .alias('f', 'file')
                .parse();
            expect(argv.f).toBe('in.txt');
            expect(argv.file).toBe('in.txt');
        });

        await it('applies .default() when the flag is missing', async () => {
            const argv = await yargs([])
                .default('port', 3000)
                .parse();
            expect(argv.port).toBe(3000);
        });

        await it('skips .default() when an explicit value is provided', async () => {
            const argv = await yargs(['--port', '9999'])
                .default('port', 3000)
                .parse();
            expect(argv.port).toBe(9999);
        });

        await it('enforces .choices() and rejects out-of-set values', async () => {
            const parser = yargs(['--mode', 'banana'])
                .choices('mode', ['dev', 'prod'])
                .fail((msg) => {
                    throw new Error(msg);
                });
            expect(() => parser.parseSync()).toThrow();
        });

        await it('accepts in-set choices', async () => {
            const argv = await yargs(['--mode', 'dev'])
                .choices('mode', ['dev', 'prod'])
                .parse();
            expect(argv.mode).toBe('dev');
        });

        await it('counts repeated boolean flags via .count()', async () => {
            const argv = await yargs(['-vvv'])
                .count('v')
                .parse();
            expect(argv.v).toBe(3);
        });

        await it('coerces values through a user .coerce() function', async () => {
            const argv = await yargs(['--list', 'a,b,c'])
                .coerce('list', (raw: string) => raw.split(','))
                .parse();
            expect(argv.list).toStrictEqual(['a', 'b', 'c']);
        });

        await it('treats .array() values as arrays even with a single item', async () => {
            const argv = await yargs(['--items', 'one'])
                .array('items')
                .parse();
            expect(argv.items).toStrictEqual(['one']);
        });

        await it('collects multiple .array() values', async () => {
            const argv = await yargs(['--items', 'a', '--items', 'b', '--items', 'c'])
                .array('items')
                .parse();
            expect(argv.items).toStrictEqual(['a', 'b', 'c']);
        });

        await it('reports demandOption violations through .fail()', async () => {
            let captured: string | null = null;
            const parser = yargs([])
                .demandOption('config', 'config is required')
                .fail((msg) => {
                    captured = msg;
                    throw new Error(msg);
                });
            expect(() => parser.parseSync()).toThrow();
            expect(captured).toBeTruthy();
        });
    });
};
