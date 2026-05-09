// SPDX-License-Identifier: MIT
// Ported from yargs upstream test/command.cjs (sections covering .command()
// registration, builder/handler invocation, positional declarations and
// strict-command behaviour).
// Source not vendored — see header in parser.spec.ts.
// Original: Copyright (c) Yargs Contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, mocha/chai dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import yargs from 'yargs/yargs';

export default async () => {
    await describe('yargs commands', async () => {
        await it('invokes the handler when the command name matches argv[0]', async () => {
            let called = 0;
            await yargs(['build'])
                .command('build', 'build the project', () => {
                    /* no builder */
                }, () => {
                    called += 1;
                })
                .parse();
            expect(called).toBe(1);
        });

        await it('passes parsed argv into the handler', async () => {
            let captured: Record<string, unknown> | null = null;
            await yargs(['greet', 'World', '--shout'])
                .command(
                    'greet <name>',
                    'greet someone',
                    (y) => y.positional('name', { type: 'string' }),
                    (argv) => {
                        captured = argv as Record<string, unknown>;
                    },
                )
                .parse();
            expect(captured).toBeTruthy();
            expect((captured as Record<string, unknown>).name).toBe('World');
            expect((captured as Record<string, unknown>).shout).toBe(true);
        });

        await it('marks unknown commands as failures under .strictCommands()', async () => {
            let failMsg: string | null = null;
            const parser = yargs(['no-such-cmd'])
                .command('build', 'build', () => {/* */}, () => {/* */})
                .strictCommands()
                .fail((msg) => {
                    failMsg = msg;
                    throw new Error(msg);
                });
            expect(() => parser.parseSync()).toThrow();
            expect(failMsg).toBeTruthy();
        });

        await it('routes nested subcommands through the right handler', async () => {
            const calls: string[] = [];
            await yargs(['db', 'migrate'])
                .command('db', 'database tools', (y) =>
                    y
                        .command('migrate', 'run migrations', () => {/* */}, () => {
                            calls.push('migrate');
                        })
                        .command('seed', 'seed data', () => {/* */}, () => {
                            calls.push('seed');
                        }),
                )
                .parse();
            expect(calls).toStrictEqual(['migrate']);
        });

        await it('supports the * default-command form', async () => {
            let invoked = false;
            await yargs(['anything'])
                .command(
                    '*',
                    'fallback',
                    () => {/* */},
                    () => {
                        invoked = true;
                    },
                )
                .parse();
            expect(invoked).toBe(true);
        });

        await it('routes between sibling commands by name', async () => {
            const calls: string[] = [];
            const parser = yargs([])
                .command('build', 'build', () => {/* */}, () => {
                    calls.push('build');
                })
                .command('serve', 'serve', () => {/* */}, () => {
                    calls.push('serve');
                });
            await parser.parse(['build']);
            await parser.parse(['serve']);
            expect(calls).toStrictEqual(['build', 'serve']);
        });
    });
};
