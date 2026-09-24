// `gjsify env NAME=VALUE… <command> [args…]` — env(1) for package scripts.
//
// npm runs package scripts through `cmd.exe` on Windows, and cmd has no form of
// the POSIX `NAME=value command` prefix: `LC_ALL=C node --test` fails there with
// "'LC_ALL' is not recognized as an internal or external command" (measured on
// the win11-gjsify VM for `@gjsify/node-gi`'s `npm test`). The prefix cannot be
// rewritten into a cmd spelling either, because `set NAME=value && …` leaks into
// every later clause and keeps the trailing space in the value.
//
// Same answer as `gjsify clear`/`gjsify copy` gave `rm -rf`/`cp -r`: one portable
// command, so the fix is prepending `gjsify env` rather than a platform branch per
// script. `portable-scripts` rejects the bare prefix so it stays fixed.
//
// The child is spawned through `spawnToCompletion`, so a bare `.cmd` shim (`npm`,
// `tsc`) resolves on Windows the same way it does for every other CLI spawn.

import type { Command } from '../types/index.js';
import { doubleDashArgs } from '../utils/double-dash-args.js';
import { describeExit, spawnToCompletion } from '../utils/spawn.js';

interface EnvOptions {
    entries: string[];
}

/** POSIX `name=value` assignment word: a portable identifier, then `=`. */
const ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

export interface EnvInvocation {
    assignments: Array<[name: string, value: string]>;
    command: string;
    args: string[];
}

/**
 * Split env(1)-style argv: leading `NAME=VALUE` words, then the command and its
 * arguments. A later `X=y` is an ARGUMENT, as in env(1). `null` when no command
 * follows the assignments.
 */
export function splitEnvArgv(argv: readonly string[]): EnvInvocation | null {
    const assignments: Array<[string, string]> = [];
    let i = 0;
    for (; i < argv.length; i++) {
        const m = ASSIGNMENT_RE.exec(argv[i]!);
        if (!m) break;
        assignments.push([m[1]!, m[2]!]);
    }
    if (i >= argv.length) return null;
    return { assignments, command: argv[i]!, args: argv.slice(i + 1) };
}

/**
 * The child's environment: `base` with `assignments` applied.
 *
 * On win32 names are case-insensitive, and a spread of `process.env` keeps the
 * stored spelling (`Path`). Assigning `PATH` beside it would hand the child two
 * variables for one name, so any differently-cased key is dropped first.
 */
export function applyAssignments(
    base: NodeJS.ProcessEnv,
    assignments: ReadonlyArray<readonly [string, string]>,
    platform: string = process.platform,
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base };
    for (const [name, value] of assignments) {
        if (platform === 'win32') {
            for (const key of Object.keys(env)) {
                if (key !== name && key.toLowerCase() === name.toLowerCase()) delete env[key];
            }
        }
        env[name] = value;
    }
    return env;
}

export const envCommand: Command<unknown, EnvOptions> = {
    command: 'env <entries..>',
    description:
        'Run a command with extra environment variables: `gjsify env NAME=VALUE… <command> [args…]`. Portable replacement for the POSIX `NAME=value command` prefix, which cmd.exe cannot run.',
    builder: (yargs) =>
        yargs
            .positional('entries', {
                description: '`NAME=VALUE` assignments, then the command and its arguments.',
                type: 'string',
                array: true,
            })
            // The command owns its whole flag namespace, as with `gjsify run`:
            // `gjsify env LC_ALL=C node --test --help` must reach node.
            .version(false)
            .help(false)
            .parserConfiguration({
                'populate--': true,
                'parse-positional-numbers': false,
                'unknown-options-as-args': true,
            }),
    handler: async (args) => {
        const invocation = splitEnvArgv([...(args.entries ?? []), ...doubleDashArgs(args)]);
        if (!invocation) {
            console.error('gjsify env: no command given. Usage: gjsify env NAME=VALUE… <command> [args…]');
            return process.exit(1);
        }
        const { assignments, command, args: childArgs } = invocation;
        let result;
        try {
            result = await spawnToCompletion(command, childArgs, {
                completion: 'exit',
                env: applyAssignments(process.env, assignments),
            });
        } catch (err) {
            const e = err as NodeJS.ErrnoException;
            console.error(
                e.code === 'ENOENT'
                    ? `gjsify env: \`${command}\` not found on PATH`
                    : `gjsify env: ${command}: ${e.message}`,
            );
            return process.exit(127);
        }
        if (result.code !== 0) {
            if (result.code === null) console.error(`gjsify env: ${command} ended by ${describeExit(result)}`);
            return process.exit(result.code ?? 1);
        }
        return process.exit(0);
    },
};
