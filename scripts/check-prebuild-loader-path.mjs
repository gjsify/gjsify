#!/usr/bin/env node
/**
 * CLI entry: verify staged prebuild DIRECTORIES.
 *
 * The parsers and the directory check now live in
 * `@gjsify/manifest-conformance` (`lib/binary.mjs`) so that this CLI,
 * `scripts/stage-prebuild.mjs`, the workspace audit and `gjsify manifest-check`
 * all read a prebuild exactly one way. The full rationale for what is checked
 * and why both binary formats are parsed by hand lives there.
 *
 * This file stays because the thing it takes is a DIRECTORY, not a manifest:
 * `stage-prebuild.mjs` calls it on the directory it has just written, before
 * any package declares anything about it. That is a different question from
 * "does this package's declaration have a body", which is the
 * `prebuild-artifacts` rule.
 *
 * The named exports are re-exported for backwards compatibility: existing
 * importers (`scripts/stage-prebuild.mjs`, and anything else reaching for the
 * parsers) keep working unchanged.
 *
 * Usage: node scripts/check-prebuild-loader-path.mjs <dir> [<dir> …]
 *        node scripts/check-prebuild-loader-path.mjs packages/infra/oxfmt-native/prebuilds/darwin-arm64
 */

import { resolve } from 'node:path';

import {
    checkPrebuildDir,
    readLibrary,
    readTypelibSharedLibraries,
} from '../packages/infra/manifest-conformance/lib/binary.mjs';

export { checkPrebuildDir, readLibrary, readTypelibSharedLibraries };

function main() {
    const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    if (dirs.length === 0) {
        console.error('usage: node scripts/check-prebuild-loader-path.mjs <prebuild-dir> [<prebuild-dir> …]');
        process.exit(2);
    }
    /** @type {string[]} */ const problems = [];
    for (const d of dirs) {
        const dir = resolve(d);
        console.log(`[check-prebuild-loader-path] ${d}`);
        problems.push(...checkPrebuildDir(dir));
    }
    if (problems.length > 0) {
        console.error('\n[check-prebuild-loader-path] FAILED:');
        for (const p of problems) console.error(`  ✗ ${p}`);
        process.exit(1);
    }
    console.log(`[check-prebuild-loader-path] OK — ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} sound`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('check-prebuild-loader-path.mjs')) main();
