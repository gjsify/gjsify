// `gjsify copy <sources…> <dest>` — portable file staging for package scripts.
//
// WHY THIS EXISTS
//
// The sibling of `gjsify clear`, and the second half of the same finding. npm
// runs package scripts through `cmd.exe` on Windows, which has no `cp`, no
// `mkdir -p` and expands no glob. `clear` closed the 224 `rm -rf` scripts
// (issue #914); what remained were 34 scripts that stage static assets with
// `mkdir -p X && cp -r …` — `build:assets` (24), `build:public` (5), and one
// each of `build:views`, `sync:theme`, `prebuild:test`, `prebuild:test:fixtures`.
//
// They were not merely a hygiene item. `showcases/node/express-webserver` is the
// one showcase that runs on Windows at all — its `--app node` bundle needs no
// gjs — and `build:public` is what puts `index.html` and `style.css` next to it.
// Without this command the showcase builds and then serves 404s for its own
// frontend, which is a worse failure than not building: the server starts.
//
// WHAT IT IS NOT
//
// Not a `cp` clone. Two deliberate differences, both because a build step is
// re-run:
//
//   - `mkdir -p` is implied. Every one of the replaced scripts paired the two,
//     and a copy that fails because the output directory does not exist yet is
//     not a distinction worth preserving.
//   - directory-vs-path is decided by the ARGUMENTS, never by what is on disk —
//     see `isDirectoryDestination`. `cp -r src/assets dist/res` means two
//     different things on the first and second run; this does not.
//
// Overwriting is unconditional (`force: true`), which is what the `-f` in most
// of the replaced scripts asked for and what the rest wanted without saying so.

import { cp, mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { Command } from '../types/index.js';
import { planCopy } from '../utils/copy-targets.js';

interface CopyOptions {
    paths?: string[];
    dryRun?: boolean;
    verbose?: boolean;
}

export const copyCommand: Command<unknown, CopyOptions> = {
    command: 'copy [paths..]',
    description:
        'Copy files and directories into the build output. Portable replacement for `mkdir -p` + `cp -r` in package scripts.',
    // No `normalize: true` — see the comment block in `commands/build.ts`. It is
    // meaningless for a path resolved here anyway, and on win32 it is what would
    // backslash a wildcard segment before it can be matched.
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description:
                    'One or more sources followed by the destination. The destination is a DIRECTORY when it ends with "/", when several sources are given, or when a source carries a wildcard; otherwise it is the exact target path. Missing parent directories are created. `*` and `?` are honoured in the last segment of a source.',
                type: 'string',
                array: true,
            })
            .option('dry-run', {
                description: 'Print what would be copied and exit without touching anything.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                alias: 'v',
                description: 'Print each path as it is copied.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const paths = args.paths ?? [];
        if (paths.length < 2) {
            throw new Error('gjsify copy: needs at least one source and a destination. Usage: gjsify copy <sources…> <dest>');
        }

        // Planning validates every argument — and every destination against the
        // package boundary — before a single byte is written.
        const ops = planCopy(paths, { cwd, readdir: readdirSync });

        const show = (p: string) => {
            const rel = relative(cwd, p);
            // A source may legitimately live in a sibling package; showing it as
            // `../../../packages/…` is more useful than an absolute path there.
            return rel === '' ? '.' : rel;
        };

        for (const { from, to } of ops) {
            if (args.dryRun) {
                console.log(`gjsify copy: would copy ${show(from)} -> ${show(to)}`);
                continue;
            }
            await mkdir(dirname(to), { recursive: true });
            await cp(from, to, { recursive: true, force: true });
            if (args.verbose) console.log(`gjsify copy: ${show(from)} -> ${show(to)}`);
        }
    },
};
