// `gjsify blueprint types [paths..]` — write the `.d.blp.ts` sidecars ADR 0088 § 4 defines.
//
// WHY THE CLI HAS THIS AT ALL, when `@gjsify/vite-plugin-blueprint` already writes a sidecar
// during `load`: a type-check is not a build. `gjsify check` runs `tsc` and nothing else, so a
// fresh clone — or a `.blp` whose consumer is being WRITTEN, before any bundle exists — has no
// sidecar unless something outside the bundler can produce one. This is that something, and it
// is why the command is usable before `gjsify check` rather than only after a build.
//
// `--check` IS FOR CONSUMERS OF THE PUBLISHED CLI. In this repository the sidecar gate is
// `scripts/check-blueprint-sidecars.mjs`, which CI runs with plain `node` beside the other three
// Blueprint gates — it has to be, because the CI bootstrap is the PREVIOUS RELEASE's bundle
// (ADR 0002) and cannot run a command this tree just added. A third-party project has no
// `scripts/` of ours, so without this flag it could generate sidecars and never hold them.
// The two share the derivation; what is duplicated is the byte comparison.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { emitTypedSidecar, parseBlueprint, sidecarPathFor } from '@gjsify/blueprint';
import type { Command } from '../../types/index.js';

interface BlueprintTypesOptions {
    paths?: string[];
    check?: boolean;
    verbose?: boolean;
}

/** What a walk never descends into: build output, and other projects' sources. */
const SKIP = new Set(['node_modules', 'dist', 'lib', '.git']);

/**
 * Every `.blp` under one path, or the path itself when it names one.
 *
 * `statSync` rather than `withFileTypes`, the same choice `utils/build-cache.ts` makes and for
 * the same reason: this command also runs from the GJS bundle, where `@gjsify/fs` is the readdir
 * implementation.
 */
function blueprintsUnder(path: string, found: string[]): string[] {
    let entry;
    try {
        entry = statSync(path);
    } catch {
        return found;
    }
    if (!entry.isDirectory()) {
        if (path.endsWith('.blp')) found.push(path);
        return found;
    }
    for (const name of readdirSync(path).sort()) {
        if (SKIP.has(name) || name.startsWith('.')) continue;
        blueprintsUnder(join(path, name), found);
    }
    return found;
}

export const blueprintTypesCommand: Command<unknown, BlueprintTypesOptions> = {
    command: 'types [paths..]',
    description:
        'Generate the `<name>.d.blp.ts` type sidecar for each .blp (ADR 0088), so `import { build }` / ' +
        '`import { GTypeName }` type-check before anything is built. Defaults to the current directory.',
    builder: (yargs) =>
        yargs
            .positional('paths', {
                description: 'Files or directories to scan for .blp (default: the current directory)',
                type: 'string',
                array: true,
                normalize: true,
                default: [],
            })
            .option('check', {
                description: 'Write nothing; exit non-zero when a sidecar is missing or stale',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Print every file considered, not only the ones that changed',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const given = (args.paths as string[] | undefined) ?? [];
        const roots = (given.length > 0 ? given : ['.']).map((path) =>
            isAbsolute(path) ? path : resolve(process.cwd(), path),
        );

        const blueprints: string[] = [];
        for (const root of roots) blueprintsUnder(root, blueprints);

        const outdated: string[] = [];
        let written = 0;

        for (const file of blueprints) {
            const sidecar = sidecarPathFor(file);
            // A parse or derive refusal is NOT caught. It names its file and its line (ADR 0053
            // clause 3), which is the whole contract, and swallowing it here would report "0
            // sidecars written" for a `.blp` that cannot compile.
            // `basename` from `node:path`, which is the host's own answer under the GJS bundle as
            // well as under node: `@gjsify/node-path` picks its win32 or posix flavour at module
            // init, and the path here is the user's, on their machine. `@gjsify/blueprint` cannot
            // take the name itself — see `typed-exports.mjs` § `emitTypedSidecar`.
            const ast = parseBlueprint(readFileSync(file, 'utf8'), file);
            const expected = emitTypedSidecar(ast, basename(file));
            let current: string | undefined;
            try {
                current = readFileSync(sidecar, 'utf8');
            } catch {
                current = undefined;
            }
            if (current === expected) {
                if (args.verbose) console.log(`[gjsify blueprint types] current: ${sidecar}`);
                continue;
            }
            if (args.check) {
                outdated.push(sidecar);
                continue;
            }
            // Only on a difference: an identical rewrite still moves the mtime, which a watcher
            // reads as a change — the same rule `vite-plugin-blueprint`'s own writer follows.
            writeFileSync(sidecar, expected, 'utf8');
            written += 1;
            console.log(`[gjsify blueprint types] wrote ${sidecar}`);
        }

        if (args.check) {
            if (outdated.length === 0) {
                console.log(`[gjsify blueprint types] ${blueprints.length} .blp checked, every sidecar current.`);
                return;
            }
            for (const sidecar of outdated) console.error(`[gjsify blueprint types] missing or stale: ${sidecar}`);
            console.error('[gjsify blueprint types] run without --check to regenerate.');
            process.exitCode = 1;
            return;
        }

        console.log(
            `[gjsify blueprint types] ${blueprints.length} .blp scanned, ${written} sidecar(s) written, ` +
                `${blueprints.length - written} already current.`,
        );
    },
};
