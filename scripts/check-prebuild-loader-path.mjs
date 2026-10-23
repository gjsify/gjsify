#!/usr/bin/env node
/**
 * CLI entry: verify staged prebuild DIRECTORIES.
 *
 * The parsers and the directory check live in `@gjsify/manifest-conformance`
 * (`lib/binary.mjs`), so this CLI, `scripts/stage-prebuild.mjs` and the workspace
 * audit all read a prebuild exactly one way; the rationale for what is checked
 * and why both binary formats are parsed by hand lives there, and the parsers are
 * re-exported here because `stage-prebuild.mjs` imports them from this path.
 *
 * What this takes is a DIRECTORY, not a manifest: `stage-prebuild.mjs` calls it on
 * what it has just written, before any package declares anything about it — a
 * different question from "does this declaration have a body", which is the
 * `prebuild-artifacts` rule.
 *
 * `--host-glib` also fails a Mach-O that records a GLib load command (docs/prebuilds.md
 * § One GLib). The release cut passes it over the committed darwin prebuilds, so a fix
 * that CI has not yet rebuilt into them cannot ride a tag out to npm (#2368).
 *
 * Usage: node scripts/check-prebuild-loader-path.mjs [--host-glib] <dir> [<dir> …]
 *        node scripts/check-prebuild-loader-path.mjs packages/infra/oxfmt-native-darwin-arm64/prebuilds/darwin-arm64
 */

import { resolve } from 'node:path';

import {
    checkPrebuildDir,
    readLibrary,
    readTypelibSharedLibraries,
} from '../packages/infra/manifest-conformance/lib/binary.mjs';

export { checkPrebuildDir, readLibrary, readTypelibSharedLibraries };

function main() {
    const hostGlib = process.argv.includes('--host-glib');
    const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    if (dirs.length === 0) {
        console.error(
            'usage: node scripts/check-prebuild-loader-path.mjs [--host-glib] <prebuild-dir> [<prebuild-dir> …]',
        );
        process.exit(2);
    }
    /** @type {string[]} */ const problems = [];
    for (const d of dirs) {
        const dir = resolve(d);
        console.log(`[check-prebuild-loader-path] ${d}`);
        problems.push(...checkPrebuildDir(dir, { hostGlib }));
    }
    if (problems.length > 0) {
        console.error('\n[check-prebuild-loader-path] FAILED:');
        for (const p of problems) console.error(`  ✗ ${p}`);
        process.exit(1);
    }
    console.log(`[check-prebuild-loader-path] OK — ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} sound`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('check-prebuild-loader-path.mjs')) main();
