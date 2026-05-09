// SPDX-License-Identifier: MIT
// Ported from yargs upstream test/usage.cjs (sections covering
// .getHelp()/.help(), .version(), and .scriptName() output).
// Source not vendored — see header in parser.spec.ts.
// Original: Copyright (c) Yargs Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, mocha/chai dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import yargs from 'yargs/yargs';

export default async () => {
    await describe('yargs help & version output', async () => {
        await it('.getHelp() renders usage + options block', async () => {
            const help = await yargs([])
                .scriptName('mycli')
                .usage('$0 <cmd> [args]')
                .option('verbose', {
                    alias: 'v',
                    type: 'boolean',
                    describe: 'Run with verbose logging',
                })
                .getHelp();
            expect(help).toContain('mycli');
            expect(help).toContain('--verbose');
            expect(help).toContain('Run with verbose logging');
        });

        await it('.getHelp() lists registered commands', async () => {
            const help = await yargs([])
                .scriptName('tool')
                .command('build', 'build the project', () => {/* */}, () => {/* */})
                .command('serve', 'serve the project', () => {/* */}, () => {/* */})
                .getHelp();
            expect(help).toContain('build');
            expect(help).toContain('serve');
            expect(help).toContain('build the project');
        });

        await it('.version() registers a --version flag and exposes it in help', async () => {
            const help = await yargs([])
                .scriptName('vcli')
                .version('1.2.3')
                .getHelp();
            expect(help).toContain('--version');
        });

        await it('.epilogue() appends the trailing message', async () => {
            const help = await yargs([])
                .scriptName('ecli')
                .epilogue('See https://example.com for details.')
                .getHelp();
            expect(help).toContain('See https://example.com for details.');
        });

        await it('option groups appear under their .group() header', async () => {
            const help = await yargs([])
                .scriptName('gcli')
                .option('input', { describe: 'input file', type: 'string' })
                .option('output', { describe: 'output file', type: 'string' })
                .group(['input', 'output'], 'Files:')
                .getHelp();
            expect(help).toContain('Files:');
            expect(help).toContain('--input');
            expect(help).toContain('--output');
        });
    });
};
