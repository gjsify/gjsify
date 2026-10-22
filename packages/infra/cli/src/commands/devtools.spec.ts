// SPDX-License-Identifier: MIT
// Regression for the bug measured against published @gjsify/cli 0.64.2: the
// command string was the bare `'devtools'`, so yargs parsed `operation`/`operands`
// as POSITIONALS only in name — under `.strict()` it rejected `shot /tmp/x.png` as
// "Unknown arguments: shot, /tmp/x.png" even though `.positional('operation', …)`
// was declared in the builder. yargs only binds `.positional()` declarations to
// argv slots the COMMAND STRING itself names (`<operation> [operands..]`).

import { describe, expect, it } from '@gjsify/unit';
import yargs from 'yargs';
import { devtoolsCommand } from './devtools.js';

/** Run argv through the REAL builder + strict mode, capture the parsed args or the failure. */
async function parseDevtoolsArgs(
    argv: string[],
): Promise<{ captured: Record<string, unknown>; failMessage: unknown }> {
    let captured: Record<string, unknown> = {};
    let failMessage: unknown;
    await yargs(argv)
        .strict()
        .exitProcess(false)
        .command(devtoolsCommand.command, devtoolsCommand.description, devtoolsCommand.builder, (args) => {
            captured = args as unknown as Record<string, unknown>;
        })
        .fail((msg) => {
            failMessage = msg;
        })
        .parseAsync();
    return { captured, failMessage };
}

export default async () => {
    await describe('gjsify devtools — command string binds its positionals', async () => {
        await it('parses `devtools shot <path>` without rejecting it as unknown arguments', async () => {
            const { captured, failMessage } = await parseDevtoolsArgs(['devtools', 'shot', '/tmp/x.png']);
            expect(failMessage).toBe(undefined);
            expect(captured.operation).toBe('shot');
            expect(captured.operands).toStrictEqual(['/tmp/x.png']);
        });

        await it('collects every operand, in order, for a multi-arg subcommand', async () => {
            const { captured, failMessage } = await parseDevtoolsArgs(['devtools', 'find', '#foo', '--bus-name', 'x']);
            expect(failMessage).toBe(undefined);
            expect(captured.operation).toBe('find');
            expect(captured.operands).toStrictEqual(['#foo']);
            expect(captured.busName).toBe('x');
        });

        await it('still demands an operation', async () => {
            const { failMessage } = await parseDevtoolsArgs(['devtools']);
            expect(typeof failMessage).toBe('string');
        });
    });
};
