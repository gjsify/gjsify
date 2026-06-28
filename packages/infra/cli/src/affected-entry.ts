// SPDX-License-Identifier: MIT
// Standalone entry for the affected classifier — bundled to
// `dist/affected.gjs.mjs` and run by CI's `changes` job (`gjs -m …`) on a plain
// ubuntu-latest host that only `apt install`s gjs.
//
// CRITICAL — ZERO gi:// TYPELIB DEPENDENCIES (beyond GLib/Gio, which ship with
// gjs): this entry imports ONLY the `affected` command (→ `@gjsify/workspace`
// + `@gjsify/fs`/`@gjsify/child_process` for the git diff). It MUST NOT import
// the full CLI, whose network commands (login/publish/trust/whoami/self-update/
// upgrade) pull `@gjsify/npm-registry` → `@gjsify/fetch` → `gi://Soup?version=3.0`.
// The classifier host has no Soup typelib, so a bundle that eagerly requires
// Soup throws at module load → the classifier crashes → main.yml fails open to
// a full run on every PR (the regression this entry fixes). Keep the import
// graph below Soup-free; `tests/e2e/affected-classifier-bundle` guards it.
import { affectedCommand } from './commands/affected.js';

interface ParsedArgs {
    base?: string;
    head: string;
    format: 'text' | 'json' | 'globs' | 'github-actions';
    'changed-from-stdin': boolean;
    cwd?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
    const args: ParsedArgs = { head: 'HEAD', format: 'text', 'changed-from-stdin': false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--changed-from-stdin') args['changed-from-stdin'] = true;
        else if (a === '--base') args.base = argv[++i];
        else if (a === '--head') args.head = argv[++i] ?? 'HEAD';
        else if (a === '--cwd') args.cwd = argv[++i];
        else if (a.startsWith('--base=')) args.base = a.slice('--base='.length);
        else if (a.startsWith('--head=')) args.head = a.slice('--head='.length);
        else if (a.startsWith('--cwd=')) args.cwd = a.slice('--cwd='.length);
        else if (a.startsWith('--format=')) args.format = a.slice('--format='.length) as ParsedArgs['format'];
        else if (a === '--format') args.format = (argv[++i] as ParsedArgs['format']) ?? 'text';
    }
    return args;
}

const argv = process.argv.slice(2);
// Tolerate an optional leading `affected` token so the bundle can be invoked
// either as `gjs -m affected.gjs.mjs --base …` or `… affected --base …`.
const rest = argv[0] === 'affected' ? argv.slice(1) : argv;
await affectedCommand.handler(parseArgs(rest) as Parameters<typeof affectedCommand.handler>[0]);
