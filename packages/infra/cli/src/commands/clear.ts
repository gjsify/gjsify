// `gjsify clear <paths…>` — portable recursive delete for package `clear` scripts.
//
// WHY THIS EXISTS
//
// Every `clear` script in this workspace was `rm -rf <dirs…> || exit 0`. npm runs
// package scripts through `cmd.exe` on Windows, which has neither `rm` nor that
// syntax, so `gjsify foreach clear` — and with it the documented full gate
// (`gjsify install --immutable && gjsify run clear && gjsify run build …`) —
// could not run there at all. 224 package.json files carried that line, so the
// fix is one portable implementation, not 224 hand-written platform branches
// (issue #914, finding 3).
//
// `force: true` already ignores a missing path, which is all the `|| exit 0` tail
// ever did — so the rewritten scripts drop it and stop swallowing REAL failures.
// A permission error used to exit 0 and read as a successful clean.
//
// THE BOOTSTRAP QUESTION, ANSWERED DELIBERATELY
//
// A `clear` script that calls `gjsify` makes cleaning depend on a built CLI —
// the same circularity `gjsify run chmod` had in the CLI's own build (removed in
// ce47b6a). It is acceptable HERE, and for a stronger reason than "you cannot
// clear a tree you never built": for the single-command case there is no second
// process at all. `gjsify run clear` recognises a script that is one
// `gjsify <subcommand>` and dispatches it IN-PROCESS (see `cli-app.ts`), so the
// nested-gjs cost the chmod case paid does not arise. `gjsify foreach clear`
// still spawns one child per package, exactly as it did for `rm -rf`, and the
// root script already passes `-p`.
//
// What it does mean: `clear` is a NEW command, so it does not exist in the
// committed `dist/cli.gjs.mjs` until that bundle is rebuilt. On a checkout
// carrying a stale bundle, `gjsify run clear` fails with "Unknown command" rather
// than silently clearing nothing — which is the honest failure of the two.

import { rm, stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { relative } from 'node:path';
import type { Command } from '../types/index.js';
import { resolveClearTargets } from '../utils/clear-targets.js';

interface ClearOptions {
    paths?: string[];
    dryRun?: boolean;
    verbose?: boolean;
}

export const clearCommand: Command<unknown, ClearOptions> = {
    command: 'clear [paths..]',
    description: 'Delete build output recursively. Portable replacement for `rm -rf` in package `clear` scripts.',
    // No `normalize: true` anywhere below — see the comment block in
    // `commands/build.ts`. It is meaningless for a path `fs.rm` resolves itself,
    // and on win32 it is what would backslash a wildcard segment.
    builder: (yargs) => {
        return yargs
            .positional('paths', {
                description:
                    'Files and directories to delete, relative to the current package. A missing path is not an error. `*` and `?` are honoured in the last segment.',
                type: 'string',
                array: true,
            })
            .option('dry-run', {
                description: 'Print what would be deleted and exit without touching anything.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                alias: 'v',
                description: 'Print each path as it is deleted.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const paths = args.paths ?? [];
        if (paths.length === 0) {
            throw new Error('gjsify clear: no paths given. Usage: gjsify clear <paths…>');
        }

        // Resolution validates every target and throws on anything outside the
        // package — before a single delete runs.
        const targets = resolveClearTargets(paths, { cwd, readdir: readdirSync });

        for (const target of targets) {
            const shown = relative(cwd, target);
            if (args.dryRun) {
                const present = await stat(target).then(
                    () => true,
                    () => false,
                );
                console.log(`gjsify clear: would remove ${shown}${present ? '' : ' (absent)'}`);
                continue;
            }
            // `maxRetries` is for Windows: a file another process still holds
            // open fails there with EBUSY/EPERM instead of being unlinked while
            // open as on POSIX — and clearing `@gjsify/cli` itself deletes the
            // `lib/`+`dist/` the running process was loaded from. Both runtimes
            // read a module fully and close it, so this covers a transient lock
            // (a scanner, an editor), not a genuinely held handle; if it does
            // fail, the error names the path instead of exiting 0.
            await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            if (args.verbose) console.log(`gjsify clear: removed ${shown}`);
        }
    },
};
