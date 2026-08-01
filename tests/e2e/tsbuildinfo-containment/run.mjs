// E2E guard: every package's TypeScript build-info file stays INSIDE that
// package.
//
// `tsBuildInfoFile` is rarely written by hand, so its location is whatever
// TypeScript derives — and the derivation escapes the package for a shape this
// repo uses a lot. From `getTsBuildInfoEmitOutputFilePath`, with `outDir` and
// `rootDir` both set, the path is
//
//     resolve(outDir, relative(rootDir, <configFileWithoutExtension>)) + '.tsbuildinfo'
//
// For the native-bridge packages (`outDir: "lib"`, `rootDir: "src/ts"`) that
// evaluates to `lib/../../tsconfig.tsbuildinfo` — one level ABOVE the package,
// in the shared pillar directory. Two concrete consequences, both observed:
//
//   1. Every sibling native bridge in that pillar lands on the SAME file
//      (`packages/node/tsconfig.tsbuildinfo` was shared by http2-native,
//      http-soup-bridge, sab-native, terminal-native and tls-native).
//   2. The package's own `clear` script (`rm -rf lib … tsconfig.tsbuildinfo`)
//      can never reach it, so a stale one survives a clean. A stale build-info
//      makes an `emitDeclarationOnly` build a SILENT no-op: tsc exits 0 and
//      never writes `lib/types/index.d.ts`, and the package publishes with a
//      `types` entry point that does not exist. `packages/napi/napi` was fixed
//      for exactly this; this test is what stops it coming back.
//
// The file is gitignored (`*.tsbuildinfo`), so nothing else notices the leak.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/tsbuildinfo-containment/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');

/** tsconfig files are JSONC — strip line comments before parsing. */
function readTsconfig(path) {
    const raw = readFileSync(path, 'utf-8').replace(/^[ \t]*\/\/.*$/gm, '');
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Where TypeScript will put the build info for `pkgDir/tsconfig.json`, or
 * `null` when the config is not incremental (no build info at all).
 *
 * Mirrors `getTsBuildInfoEmitOutputFilePath` for the option shapes present in
 * this repo (no `outFile`, no `extends` chain reaching these three keys).
 */
function buildInfoPathFor(pkgDir) {
    const configPath = join(pkgDir, 'tsconfig.json');
    if (!existsSync(configPath)) return null;
    const config = readTsconfig(configPath);
    const options = config?.compilerOptions;
    if (!options) return null;
    if (!options.composite && !options.incremental) return null;
    if (options.tsBuildInfoFile) return resolve(pkgDir, options.tsBuildInfoFile);

    const configLess = join(pkgDir, 'tsconfig');
    if (!options.outDir) return `${configLess}.tsbuildinfo`;
    const outDir = resolve(pkgDir, options.outDir);
    const base = options.rootDir
        ? resolve(outDir, relative(resolve(pkgDir, options.rootDir), configLess))
        : join(outDir, 'tsconfig');
    return `${base}.tsbuildinfo`;
}

function packageDirs() {
    const dirs = [];
    const pillars = join(MONOREPO_ROOT, 'packages');
    for (const pillar of readdirSync(pillars)) {
        const pillarDir = join(pillars, pillar);
        if (!statSync(pillarDir).isDirectory()) continue;
        for (const name of readdirSync(pillarDir)) {
            const pkgDir = join(pillarDir, name);
            if (!statSync(pkgDir).isDirectory()) continue;
            if (existsSync(join(pkgDir, 'package.json'))) dirs.push(pkgDir);
        }
    }
    return dirs;
}

describe('tsbuildinfo containment', () => {
    it('no package writes its build info outside its own directory', () => {
        const escaping = [];
        for (const pkgDir of packageDirs()) {
            const buildInfo = buildInfoPathFor(pkgDir);
            if (!buildInfo) continue;
            if (relative(pkgDir, buildInfo).startsWith('..')) {
                escaping.push(`${relative(MONOREPO_ROOT, pkgDir)} → ${relative(MONOREPO_ROOT, buildInfo)}`);
            }
        }
        assert.deepEqual(
            escaping.sort(),
            [],
            'these packages leak their tsbuildinfo outside the package (pin `tsBuildInfoFile` ' +
                `to a path inside it, e.g. "lib/tsconfig.tsbuildinfo"):\n  ${escaping.join('\n  ')}`,
        );
    });

    it('leaves no stray build info in the pillar directories', () => {
        const pillars = join(MONOREPO_ROOT, 'packages');
        const stray = [];
        for (const pillar of readdirSync(pillars)) {
            const pillarDir = join(pillars, pillar);
            if (!statSync(pillarDir).isDirectory()) continue;
            for (const entry of readdirSync(pillarDir)) {
                if (entry.endsWith('.tsbuildinfo')) stray.push(`packages/${pillar}/${entry}`);
            }
        }
        assert.deepEqual(
            stray.sort(),
            [],
            `build info written into a pillar dir (no package owns it): ${stray.join(', ')}`,
        );
    });
});
