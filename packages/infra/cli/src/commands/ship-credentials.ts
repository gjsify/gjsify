// `gjsify ship credentials <upload|install|check> <os>` — ADR 0126 § D1.
//
// One declarative table (`CREDENTIALS`) drives all three verbs; this file is
// only the yargs surface. A value never arrives as a flag's own value: the
// generated options name a FILE (`--p12-file`) or an ENVIRONMENT VARIABLE
// (`--p12-password-env`), and the fallback is a prompt.

import type { Argv } from 'yargs';
import { Config } from '../config.js';
import type { Command } from '../types/index.js';
import { credentialFlags, sourceOption } from '../utils/ship/credentials.js';
import { defaultIo, runCheck, runInstall, runUpload } from '../utils/ship/credentials-run.js';

interface ShipCredentialsOptions {
    verb: string;
    os: string;
    repo?: string;
    sign?: string;
    'dry-run'?: boolean;
    force?: boolean;
    remove?: boolean;
    json?: boolean;
    [option: string]: unknown;
}

export const shipCredentialsCommand: Command<unknown, ShipCredentialsOptions> = {
    command: 'credentials <verb> <os>',
    description:
        'Store, install and check the signing credentials a release workflow needs (upload | install | check). Values come from files, environment variables or a prompt — never from a flag.',
    builder: (yargs: Argv) => {
        let y = yargs
            .positional('verb', {
                type: 'string',
                choices: ['upload', 'install', 'check'],
                description:
                    'upload: push to the repository; install: materialise in CI; check: report which names exist.',
            })
            .positional('os', {
                type: 'string',
                description: 'Layout OS whose credential set to use (darwin | win32).',
            })
            .option('repo', {
                type: 'string',
                description:
                    '`owner/name` of the GitHub repository. Required by `upload`; with `check`, reads the repository instead of the environment.',
            })
            .option('sign', {
                type: 'string',
                description:
                    'win32 `install`: the signing identity to validate. Default: `gjsify.ship.sign.win32.identity`.',
            })
            .option('dry-run', {
                type: 'boolean',
                default: false,
                description: 'Print the `gh` / `security` commands with every value as `$NAME`; touch nothing.',
            })
            .option('force', {
                type: 'boolean',
                default: false,
                description: 'darwin `install`: run outside CI, changing this machine’s default keychain.',
            })
            .option('remove', {
                type: 'boolean',
                default: false,
                description: '`install`: undo it — delete the keychain and restore the defaults.',
            })
            .option('json', { type: 'boolean', default: false, description: '`check`: machine-readable output.' });
        for (const { flag, sources, label } of credentialFlags()) {
            for (const source of ['file', 'env'] as const) {
                if (!sources.includes(source)) continue;
                y = y.option(sourceOption({ flag }, source), {
                    type: 'string',
                    description:
                        source === 'file'
                            ? `upload: file holding the ${label}.`
                            : `upload: NAME of the environment variable holding the ${label}.`,
                });
            }
        }
        return y;
    },
    handler: async (args) => {
        const io = defaultIo();
        const sources: Record<string, string | undefined> = {};
        for (const { flag } of credentialFlags()) {
            for (const source of ['file', 'env'] as const) {
                const key = sourceOption({ flag }, source);
                const v = args[key];
                if (typeof v === 'string') sources[key] = v;
            }
        }
        let code: number;
        if (args.verb === 'upload') {
            code = await runUpload(io, { os: args.os, repo: args.repo, dryRun: args['dry-run'] === true, sources });
        } else if (args.verb === 'check') {
            code = runCheck(io, { os: args.os, repo: args.repo, json: args.json === true });
        } else {
            let sign = args.sign;
            if (sign === undefined && args.os === 'win32' && args.remove !== true) {
                const data = await new Config().forCommand(process.cwd());
                sign = data.ship?.sign?.win32?.identity;
            }
            code = await runInstall(io, {
                os: args.os,
                remove: args.remove === true,
                dryRun: args['dry-run'] === true,
                force: args.force === true,
                sign,
            });
        }
        // `return`: a bare `process.exit()` is deferred under GJS.
        if (code !== 0) return process.exit(code);
    },
};
