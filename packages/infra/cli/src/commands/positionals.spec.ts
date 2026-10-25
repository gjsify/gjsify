// SPDX-License-Identifier: MIT
// Every positional a command's builder declares must be named in its command string.
//
// yargs only binds a positional the command string names (`run <target> [args..]`). A builder that
// declares `.positional('operation')` under a bare `devtools` registers nothing, and `.strict()` then
// rejects the very argument the help text documents: `gjsify devtools shot out.png` failed with
// "Unknown arguments: shot, out.png" for every operation, while `--help` listed them as valid.

import { describe, expect, it } from '@gjsify/unit';

import * as commands from './index.js';

/** Run a builder against a stand-in that records `.positional()` names and chains every other call. */
function declaredPositionals(builder: (yargs: unknown) => unknown): string[] {
    const names: string[] = [];
    const chain: unknown = new Proxy(function () {}, {
        get: (_target, prop) => {
            if (prop === 'positional') {
                return (name: string) => {
                    names.push(name);
                    return chain;
                };
            }
            return () => chain;
        },
    });
    builder(chain);
    return names;
}

/** The names a command string binds: `<a>`, `[b]`, `[c..]`, `<d..>`. */
function boundNames(command: string | ReadonlyArray<string>): Set<string> {
    const first = typeof command === 'string' ? command : (command[0] ?? '');
    return new Set([...first.matchAll(/[<[]([^\]>.|]+)/g)].map((m) => m[1] ?? ''));
}

export default async () => {
    await describe('command positionals', async () => {
        const all = Object.entries(commands).filter(
            (entry): entry is [string, { command: string | ReadonlyArray<string>; builder: (y: unknown) => unknown }] =>
                typeof entry[1] === 'object' &&
                entry[1] !== null &&
                'command' in entry[1] &&
                typeof (entry[1] as { builder?: unknown }).builder === 'function',
        );

        await it('finds the command surface', async () => {
            expect(all.length > 10).toBe(true);
        });

        for (const [name, command] of all) {
            await it(`${name} names every positional it declares`, async () => {
                const bound = boundNames(command.command);
                const unbound = declaredPositionals(command.builder).filter((p) => !bound.has(p));
                expect(unbound).toStrictEqual([]);
            });
        }
    });
};
