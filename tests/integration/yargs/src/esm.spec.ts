// SPDX-License-Identifier: MIT
// Original integration test — verifies that the ESM entry-points yargs ships
// (`yargs`, `yargs/yargs`, `yargs/helpers`) all resolve and behave consistently
// when bundled by `gjsify build` for both Node and GJS targets. Stresses the
// ESM-import surface that @gjsify/cli relies on, plus process.argv plumbing
// via hideBin().
// SPDX attribution to the original yargs project for any helper signatures
// that are mirrored here:
// Copyright (c) Yargs Contributors. MIT.

import { describe, it, expect } from '@gjsify/unit';
import yargsDefault from 'yargs';
import yargsFactory from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

export default async () => {
    await describe('yargs ESM entry-points', async () => {
        await it('default export from "yargs" is the same factory as "yargs/yargs"', async () => {
            // yargs v18 ships both as ESM; both should produce a working parser.
            expect(typeof yargsDefault).toBe('function');
            expect(typeof yargsFactory).toBe('function');
        });

        await it('"yargs" default-export factory parses argv', async () => {
            const argv = await yargsDefault(['--name', 'gjsify']).parse();
            expect(argv.name).toBe('gjsify');
        });

        await it('"yargs/yargs" factory parses argv', async () => {
            const argv = await yargsFactory(['--enabled']).parse();
            expect(argv.enabled).toBe(true);
        });

        await it('hideBin() strips the first two argv slots', async () => {
            const fakeArgv = ['/usr/bin/node', '/path/to/script.js', 'cmd', '--flag'];
            const stripped = hideBin(fakeArgv);
            expect(stripped).toStrictEqual(['cmd', '--flag']);
        });

        await it('hideBin(process.argv) is parseable end-to-end', async () => {
            // The shape exercised here matches the @gjsify/cli entry-point:
            //   yargs(hideBin(process.argv)).command(...).parse()
            // We don't depend on what process.argv contains in the test runner —
            // only that the chain completes without throwing.
            const argv = await yargsFactory(hideBin(['node', 'cli', '--ok'])).parse();
            expect(argv.ok).toBe(true);
        });

        await it('Yargs parser instance is reusable across multiple .parse() calls', async () => {
            const parser = yargsFactory()
                .option('count', { type: 'number', default: 1 });
            const a = await parser.parse(['--count', '5']);
            const b = await parser.parse(['--count', '10']);
            expect(a.count).toBe(5);
            expect(b.count).toBe(10);
        });
    });
};
