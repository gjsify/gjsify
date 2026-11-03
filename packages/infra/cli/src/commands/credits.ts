// `gjsify credits [--output <file>] [--overrides <file>] [--check | --stdout]`
//
// Derives who to thank from the git history and writes it as JSON, so an About
// dialog or a README reads names from one file instead of a hand-kept list.

import { Config } from '../config.js';
import type { Command } from '../types/index.js';
import {
    DEFAULT_CREDITS_IGNORE,
    buildCredits,
    isStale,
    parseOverrides,
    readCommits,
    serializeCredits,
} from '../utils/credits.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CreditsOptions {
    output?: string;
    overrides?: string;
    check?: boolean;
    stdout?: boolean;
}

const DEFAULT_OUTPUT = 'credits.json';
const DEFAULT_OVERRIDES = 'credits.overrides.json';

export const creditsCommand: Command<unknown, CreditsOptions> = {
    command: 'credits',
    description:
        'Write the project’s contributors (developers, translators per language) from the git history as JSON, names only.',
    builder: (yargs) =>
        yargs
            .option('output', {
                alias: 'o',
                description: `File to write. Default: \`gjsify.credits.output\`, else ${DEFAULT_OUTPUT}.`,
                type: 'string',
            })
            .option('overrides', {
                description: `Hand-kept additions and exclusions. Default: \`gjsify.credits.overrides\`, else ${DEFAULT_OVERRIDES} when it exists.`,
                type: 'string',
            })
            .option('check', {
                description: 'Write nothing; exit 1 when the file on disk differs from what the history gives.',
                type: 'boolean',
                default: false,
            })
            .option('stdout', {
                description: 'Print the JSON instead of writing it.',
                type: 'boolean',
                default: false,
            })
            .conflicts('check', 'stdout'),
    handler: async (args) => {
        const projectDir = process.cwd();
        try {
            const config = (await new Config().forCommand(projectDir)).credits ?? {};
            const output = resolve(projectDir, args.output ?? config.output ?? DEFAULT_OUTPUT);
            const overridesName = args.overrides ?? config.overrides;
            const overridesPath = resolve(projectDir, overridesName ?? DEFAULT_OVERRIDES);
            let overrides;
            if (existsSync(overridesPath)) {
                overrides = parseOverrides(readFileSync(overridesPath, 'utf8'), overridesName ?? DEFAULT_OVERRIDES);
            } else if (overridesName !== undefined) {
                throw new Error(`cannot read the overrides file ${overridesName}`);
            }

            const credits = buildCredits(readCommits(projectDir), {
                ignore: config.ignore ?? DEFAULT_CREDITS_IGNORE,
                overrides,
            });
            const text = serializeCredits(credits);

            if (args.stdout === true) {
                process.stdout.write(text);
            } else if (args.check === true) {
                const existing = existsSync(output) ? readFileSync(output, 'utf8') : null;
                if (isStale(existing, credits)) {
                    process.stderr.write(
                        `gjsify credits: ${args.output ?? config.output ?? DEFAULT_OUTPUT} is ${existing === null ? 'missing' : 'stale'}; run \`gjsify credits\` and commit it\n`,
                    );
                    return process.exit(1);
                }
            } else {
                writeFileSync(output, text);
            }
        } catch (err) {
            process.stderr.write(`gjsify credits: ${err instanceof Error ? err.message : String(err)}\n`);
            return process.exit(1);
        }
    },
};
