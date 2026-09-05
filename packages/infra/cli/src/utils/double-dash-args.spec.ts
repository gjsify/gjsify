// The `--` tail, end to end: what yargs makes of it and what the reader does
// with what yargs made.
//
// The regression this pins (#1531) was invisible from either half alone. The
// parser was doing what it documents (a bare number in `populate--` is typed
// `number`) and the reader was doing what it looked like it did (narrow to
// strings). Only the two together delete a value — and the deletion shipped:
// `npm:publish` passes `--verify-timeout 5 --tag latest` and 209 npm publishes
// were echoed as `--verify-timeout --tag latest`.
//
// So the first suite below drives the REAL builders rather than asserting on
// `parserConfiguration` keys: the claim is about the argv a command hands its
// child, and a config assertion would still pass over a builder that set the
// key and a reader that dropped the value anyway.

import { describe, it, expect } from '@gjsify/unit';
import yargs from 'yargs';

import { doubleDashArgs } from './double-dash-args.js';
import { foreachCommand } from '../commands/foreach.js';
import { runCommand } from '../commands/run.js';
import { dlxCommand } from '../commands/dlx.js';

/**
 * Parse `argv` with one real command's own `command` string and builder, exactly the
 * way `cli-app.ts` registers it, and return what its handler was handed.
 *
 * SNAPSHOTTED INSIDE THE HANDLER, and that is not defensiveness. yargs reuses the
 * argument object after the handler returns, and `--` is one of the keys that is
 * gone by the time `parseSync()` does: measured here, a captured REFERENCE reads
 * `args['--'] === undefined` for every command in this file, which is precisely the
 * symptom of the bug under test. Reading it later would make the whole suite agree
 * with a broken parser configuration. `run-stdio-safe.spec.ts` copies for the same
 * reason.
 *
 * The `called` flag is the other half: without it, "the handler never ran" and "the
 * handler ran and `--` was empty" are the same empty object.
 */
function parseWith(command: { command: string; builder: unknown }, argv: string[]): Record<string, unknown> {
    let captured: Record<string, unknown> | undefined;
    yargs(argv)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .command(command.command, 'x', command.builder as any, (args: Record<string, unknown>) => {
            captured = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
        })
        .exitProcess(false)
        .parseSync();
    if (captured === undefined) throw new Error(`yargs never reached the handler for \`${command.command}\``);
    return captured;
}

export default () => {
    describe('the `--` tail of a real command', () => {
        // THE PRODUCTION ARGV. `package.json`'s `npm:publish` line, verbatim.
        const PUBLISH = [
            'gjsify',
            'publish',
            '--tolerate-republish',
            '--tolerate-untrusted-new',
            '--verify-defer',
            '--verify-timeout',
            '5',
            '--tag',
            'latest',
            '--access',
            'public',
        ];

        it('forwards the release publish argv verbatim, number and all', () => {
            const args = parseWith(foreachCommand, [
                'foreach',
                '-v',
                '--topological',
                '--no-private',
                '--exclude',
                '@girs/*',
                '--exec',
                '--',
                ...PUBLISH,
            ]);
            expect(doubleDashArgs(args)).toStrictEqual(PUBLISH);
        });

        it('keeps the spelling, not just the value', () => {
            // WHY THIS IS A PARSER SETTING AND NOT A `String(v)` IN THE READER.
            // Each of these is a different argument from the number yargs makes
            // of it, measured against yargs 18.0.0: `1.0` → 1, `0.10` → 0.1,
            // `0x10` → 16, `1e3` → 1000. A coercion recovers a value and prints
            // `1`, `0.1`, `16`, `1000` — same numbers, different argv.
            // `007` is here as the CONTROL: it looks like the obvious case and
            // yargs leaves it alone, so a suite carrying only it would pass over
            // the coercion this test exists to reject.
            const typed = ['cmd', '--pad', '007', '--v', '1.0', '--r', '0.10', '--m', '0x10', '--n', '1e3'];
            const args = parseWith(foreachCommand, ['foreach', '--exec', '--', ...typed]);
            expect(doubleDashArgs(args)).toStrictEqual(typed);
        });

        it('still parses the command`s own numeric options', () => {
            // `parse-positional-numbers: false` must not reach declared options:
            // `--jobs` is `type: 'number'` and its consumer does arithmetic on it.
            const args = parseWith(foreachCommand, ['foreach', '--jobs', '4', '--exec', '--', 'cmd', '5']) as {
                jobs?: unknown;
            };
            expect(args.jobs).toBe(4);
            expect(doubleDashArgs(args)).toStrictEqual(['cmd', '5']);
        });

        it('forwards a numeric argument through `gjsify run`', () => {
            const args = parseWith(runCommand, ['run', './server.mjs', '--', '--port', '8080']);
            expect(doubleDashArgs(args)).toStrictEqual(['--port', '8080']);
        });

        it('forwards a numeric argument through `gjsify dlx`', () => {
            const args = parseWith(dlxCommand, ['dlx', 'some-pkg', '--', '--retries', '3']);
            expect(doubleDashArgs(args)).toStrictEqual(['--retries', '3']);
        });
    });

    describe('the reader on its own', () => {
        it('reads an absent separator as an empty argv', () => {
            expect(doubleDashArgs({})).toStrictEqual([]);
        });

        it('refuses a non-string entry instead of dropping it', () => {
            // The shape the old `.filter((v): v is string => …)` swallowed. It
            // can no longer arrive from a correctly configured builder, so its
            // arrival means the configuration was dropped — which is what the
            // message names.
            let message = '';
            try {
                doubleDashArgs({ '--': ['cmd', '--verify-timeout', 5] });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('parse-positional-numbers');
            expect(message).toContain('position 2');
        });

        it('refuses a `--` slot that is not an array', () => {
            let message = '';
            try {
                doubleDashArgs({ '--': 'cmd' });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('populate--');
        });
    });
};
