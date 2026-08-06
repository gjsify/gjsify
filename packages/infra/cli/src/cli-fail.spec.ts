// SPDX-License-Identifier: MIT
// Two halves, and the second one is the point.
//
// `classifyCliFailure` is a two-line rule; testing it alone would prove almost
// nothing, because the rule's correctness rests entirely on a claim about YARGS:
// that a command handler's rejection is the one and only `fail()` call site that
// passes a null `msg`, while every usage/validation/parse failure passes a
// string. If that ever stops being true, `cli-app.ts` silently goes back to
// printing ~60 lines of help on top of an already-actionable error message —
// which is the #1005 symptom, and it is invisible in a diff.
//
// So the second describe drives a REAL yargs instance (the precedent is
// `build-args.spec.ts`, which imports yargs to pin a parse-level contract) and
// asserts the routing itself. It fails the day a yargs upgrade changes it,
// rather than the day someone reads a CI log and wonders why the help is back.

import { describe, expect, it } from '@gjsify/unit';
import yargs from 'yargs';
import { classifyCliFailure } from './cli-fail.js';

/**
 * Drive a yargs surface shaped like `cli-app.ts`'s — `.strict()`,
 * `.demandCommand(1)`, a `.fail()` handler, `parseAsync()` with no callback —
 * and capture what the handler was FIRST called with.
 *
 * "First" is load-bearing, and finding out why is what this helper is for.
 * Because this handler only observes and does not throw, yargs keeps going after
 * a usage failure: `['boom', '--nope']` fails strict-mode validation (fail #1,
 * string msg) and then RUNS THE HANDLER ANYWAY, which throws (fail #2, null
 * msg). Recording the last call would therefore report an unknown argument as a
 * runtime error.
 *
 * That is precisely why `cli-app.ts`'s usage branch must terminate rather than
 * return — measurement 3 in `cli-fail.ts`, demonstrated here rather than
 * asserted. In production the `throw` means fail #2 never happens.
 *
 * `.exitProcess(false)` so a usage error cannot take the test runner down with
 * it; `.wrap(null)` so terminal width never enters the assertions.
 */
async function captureFail(argv: string[]): Promise<{ msg: unknown; err: unknown; called: number }> {
    const seen: { msg: unknown; err: unknown; called: number } = { msg: undefined, err: undefined, called: 0 };
    const cli = yargs(argv);
    try {
        await cli
            .scriptName('gjsify-test')
            .strict()
            .exitProcess(false)
            .wrap(null)
            .command(
                'boom',
                'throws from its handler',
                (y) => y,
                async () => {
                    throw new Error('the handler said no');
                },
            )
            .demandCommand(1)
            .fail((msg, err) => {
                if (seen.called === 0) {
                    seen.msg = msg;
                    seen.err = err;
                }
                seen.called += 1;
                // Do NOT rethrow: this helper only observes the routing, which is
                // also what lets a second call happen at all (see the docblock).
            })
            .parseAsync();
    } catch {
        // A usage branch in the real CLI throws; here we swallow so the
        // assertions below can run on what was captured.
    }
    return seen;
}

export default async () => {
    await describe('classifyCliFailure', async () => {
        await it('treats a yargs-authored message as a usage error', async () => {
            const failure = classifyCliFailure('Unknown argument: nope', undefined);
            expect(failure.kind).toBe('usage');
            expect(failure.kind === 'usage' ? failure.message : '').toBe('Unknown argument: nope');
        });

        await it('treats a null message as a runtime error', async () => {
            // This is the handler-rejection shape — `command.js:257` passes null.
            const failure = classifyCliFailure(null, new Error('no usable bundler engine under GJS'));
            expect(failure.kind).toBe('runtime');
        });

        await it('treats an absent message as a runtime error', async () => {
            expect(classifyCliFailure(undefined, new Error('x')).kind).toBe('runtime');
        });

        await it('does not turn an empty message into a reasonless usage error', async () => {
            // An empty string carries nothing to print. Showing help with no
            // reason is the worst of both outputs, so it takes the runtime path
            // and `index.ts` prints whatever the error actually says.
            expect(classifyCliFailure('', new Error('x')).kind).toBe('runtime');
        });

        await it('classifies on the message, never on the error', async () => {
            // The trap: branching on `err` looks equivalent and is backwards.
            // yargs passes BOTH for a parse error (`command.js:370` →
            // `fail(parsed.error.message, parsed.error)`), so an `err`-based rule
            // would suppress help for exactly the failures help exists for.
            const parseError = classifyCliFailure('Not enough arguments', new Error('Not enough arguments'));
            expect(parseError.kind).toBe('usage');
        });
    });

    await describe('yargs routing (pins the assumption above)', async () => {
        await it('routes a handler rejection with a null message', async () => {
            const seen = await captureFail(['boom']);
            expect(seen.called).toBe(1);
            expect(seen.msg).toBe(null);
            expect(seen.err instanceof Error).toBe(true);
            expect((seen.err as Error).message).toBe('the handler said no');
            // And therefore: the runtime branch, no help.
            expect(classifyCliFailure(seen.msg as string | null, seen.err).kind).toBe('runtime');
        });

        await it('routes an unknown argument with a string message', async () => {
            const seen = await captureFail(['boom', '--nope']);
            expect(typeof seen.msg).toBe('string');
            expect(String(seen.msg).includes('nope')).toBe(true);
            expect(classifyCliFailure(seen.msg as string, seen.err).kind).toBe('usage');
        });

        await it('runs the handler anyway when the usage branch does not throw', async () => {
            // The measured reason `cli-app.ts` throws instead of returning:
            // validation calling fail() does NOT stop the command. Two calls here
            // (string, then null from the handler's own rejection) means a
            // non-throwing usage branch would print help AND then run the command
            // it just rejected the arguments for.
            const seen = await captureFail(['boom', '--nope']);
            expect(seen.called).toBe(2);
        });

        await it('routes a missing command with a string message', async () => {
            const seen = await captureFail([]);
            expect(seen.called).toBe(1);
            expect(typeof seen.msg).toBe('string');
            expect(classifyCliFailure(seen.msg as string, seen.err).kind).toBe('usage');
        });
    });
};
