#!/usr/bin/env node
/**
 * A shipped prebuild must be a FUNCTION OF ITS SOURCES: build it twice, get the
 * same bytes.
 *
 * WHY THIS EXISTS. `commit-prebuilds` used to re-commit every darwin dylib on every
 * run, all sixteen at an identical size, with zero bytes of code changed. Measured
 * on this Mac (arm64), two clean builds of `@gjsify/terminal-native` differed in 112
 * of 39152 bytes: the 16-byte `LC_UUID` payload at 0x438, one byte of an `N_OSO`
 * stab's `n_value` at 0x8530 — that is an intermediate `.o`'s mtime, and 0x8530 is
 * its low byte — and 95 bytes of the ad-hoc `LC_CODE_SIGNATURE` blob at 0x9760,
 * which hashes the first two. Nothing in `__TEXT`, `__DATA_CONST`, the string
 * table, the chained fixups or the exports trie. The cause is one flag: ld64 writes
 * a DEBUG MAP into any image whose objects carry DWARF, one `N_OSO` stab per object
 * holding that object's mtime, so `-g` puts the wall clock into the artifact.
 *
 * `-Wl,-no_uuid` would remove the symptom and cost the debugging and signing story
 * this repository depends on; `ZERO_AR_DATE=1` addresses `ar` archives, and these
 * are direct `.o` references out of meson's per-target directory, so neither
 * reaches it. The fix is at the source instead: every meson project declares
 * `buildtype=plain`, so no `-g` reaches the linker — 13 of the sixteen committed
 * darwin dylibs; the three cargo cdylibs never carried a debug map at all (`nm -a`
 * reads zero `N_OSO` stabs in them). Measured after the fix, on this Mac: two clean
 * builds of all nine darwin bridges buildable here differ in ZERO bytes.
 *
 * WHAT IS GATED, AND WHAT IS ONLY REPORTED.
 *
 *  1. GATED — a second clean build of the same package, staged through the SAME
 *     stager (so the comparison covers relocation and the ad-hoc re-signing too),
 *     must be byte-identical to the first. This cannot be red for a legitimate
 *     reason: both builds are of the same sources, on this runner, with this
 *     toolchain. That is what makes it the gate — it is what `commit-prebuilds`
 *     stopped re-committing.
 *
 *  2. REPORTED, NEVER GATED — how the fresh bytes compare with the COMMITTED ones.
 *
 * (2) is a report because it CANNOT be a gate, and that is a property of this
 * repository rather than a shortfall here. The macOS runners install Homebrew
 * formulae unpinned, so a fresh build legitimately differs from the committed
 * artifact whenever a formula version moved since the last `commit-prebuilds` — and
 * landing exactly those bytes is what that job is for. Failing on it would red
 * `main` after every Homebrew bump. What the report buys is the half nothing else
 * can see: once (1) passes, "fresh != committed" is not build noise but a real byte
 * change, and it is now named per file with a byte count in the step summary instead
 * of surfacing later as a silent commit.
 *
 * Usage:
 *   node scripts/check-prebuild-reproducible.mjs <bridge-dir> [<bridge-dir> …]
 *   node scripts/check-prebuild-reproducible.mjs --target darwin-arm64 <bridge-dir> …
 *
 * A bridge directory is the package that was BUILT — the parent of the
 * `prebuilds/<target>/` the stager wrote, which is what
 * `.github/prebuild-toolchain/darwin-bridges.mjs prebuild-dirs` prints.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hostStagingTarget, resolveStageDir } from './stage-prebuild.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGER = join(ROOT, 'scripts', 'stage-prebuild.mjs');
/**
 * The second build's directory, in a name `gitignore` already covers (`builddir/`),
 * so a run that dies before its cleanup leaves nothing visible in `git status` — the
 * same reason the stager's own outputs are removed on every path.
 */
const REPRO_BUILD_DIR = 'builddir';

/**
 * Where two buffers' differing bytes are.
 *
 * The FIRST difference is where the story is, so it is reported: an `N_OSO` mtime and
 * the `LC_UUID` sit in the load commands, an ad-hoc signature's hashes sit in the
 * last segment. Byte counts alone would leave the cause to be re-derived from a hex
 * dump by whoever reads the red build next.
 *
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {{ bytes: number, firstAt: number | null }}
 */
export function diffBytes(a, b) {
    const shared = Math.min(a.length, b.length);
    let bytes = 0;
    let firstAt = null;
    for (let i = 0; i < shared; i++) {
        if (a[i] !== b[i]) {
            bytes++;
            if (firstAt === null) firstAt = i;
        }
    }
    return { bytes: bytes + Math.abs(a.length - b.length), firstAt };
}

/**
 * Compare two staged sets of one artifact, by file name.
 *
 * A file on one side only is a difference like any other: the stager matches by
 * extension and REPLACES its destination, so a dropped or renamed artifact is
 * exactly what a git merge of two binary sets would have hidden.
 *
 * @param {string} aDir
 * @param {string} bDir
 * @returns {Array<{ file: string, bytes: number, firstAt: number | null }>}
 */
export function diffStagedSets(aDir, bDir) {
    const names = new Set([...readdirSync(aDir), ...readdirSync(bDir)]);
    const out = [];
    for (const file of [...names].sort()) {
        const inA = existsSync(join(aDir, file));
        const inB = existsSync(join(bDir, file));
        if (!inA || !inB) {
            out.push({ file, bytes: -1, firstAt: null });
            continue;
        }
        const { bytes, firstAt } = diffBytes(readFileSync(join(aDir, file)), readFileSync(join(bDir, file)));
        if (bytes > 0) out.push({ file, bytes, firstAt });
    }
    return out;
}

/**
 * Copy a staged set aside, because the second staging REPLACES the directory it is
 * about to be compared against.
 *
 * @param {string} dir
 * @returns {string} the temp directory holding the copy
 */
function snapshot(dir) {
    const dest = mkdtempSync(join(tmpdir(), 'gjsify-repro-'));
    for (const file of readdirSync(dir)) writeFileSync(join(dest, file), readFileSync(join(dir, file)));
    return dest;
}

/** @param {string[]} argv @param {string} cwd */
function run(argv, cwd) {
    execFileSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit' });
}

/**
 * What the run found, rendered into the step summary.
 *
 * `$GITHUB_STEP_SUMMARY` when there is one — the drift half is information, and
 * information nobody reads in a scrolled log is not information. Nothing here fails.
 *
 * @param {Array<{ pkg: string, file: string, bytes: number, firstAt: number | null }>} driftRows
 */
function summarise(driftRows) {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    const rows = driftRows.length === 0 ? '' : driftRows.map((r) => `| ${r.pkg} | ${r.file} | ${r.bytes} |`).join('\n');
    appendFileSync(
        summary,
        [
            '### darwin prebuilds — fresh build vs committed',
            '',
            driftRows.length === 0
                ? 'Identical. `commit-prebuilds` will have nothing to commit for these.'
                : 'Different. Not a failure — the runner installs unpinned Homebrew formulae, so a moved ' +
                  'formula version is a legitimate byte change, and `commit-prebuilds` lands it. Reproducibility ' +
                  'is gated separately, above.',
            '',
            '| artifact | file | differing bytes |',
            '|---|---|---|',
            rows,
            '',
        ].join('\n'),
    );
}

function main() {
    const argv = process.argv.slice(2);
    const targetFlag = argv.indexOf('--target');
    const target = targetFlag >= 0 ? argv[targetFlag + 1] : hostStagingTarget();
    const dirs = argv.filter((a, i) => !a.startsWith('--') && i !== targetFlag + 1).map((d) => resolve(d));

    if (dirs.length === 0) {
        console.error(
            'usage: node scripts/check-prebuild-reproducible.mjs [--target <os>-<arch>] <bridge-dir> [<bridge-dir> …]',
        );
        process.exit(2);
    }

    let failures = 0;
    /** @type {Array<{ pkg: string, file: string, bytes: number, firstAt: number | null }>} */
    const driftRows = [];

    for (const stagedDir of dirs) {
        const pkgDir = dirname(dirname(stagedDir));
        const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
        const name = `${pkg.name} (${basename(stagedDir)})`;
        console.log(`\n[check-prebuild-reproducible] ${name}: second build in ${REPRO_BUILD_DIR}/`);

        // The stager DERIVES the target directory from the host while this script
        // and every upload path name it literally. Asserted rather than assumed,
        // because the failure it prevents is comparing two directories that were
        // never going to hold the same artifact.
        if (basename(stagedDir) !== target) {
            console.error(
                `[check-prebuild-reproducible] ${name}: the directory given is \`${basename(stagedDir)}\`, ` +
                    `not the target \`${target}\` — refusing to compare two unrelated sets.`,
            );
            failures++;
            continue;
        }
        if (!existsSync(stagedDir)) {
            console.error(`[check-prebuild-reproducible] ${name}: nothing staged at ${stagedDir}`);
            failures++;
            continue;
        }

        const first = snapshot(stagedDir);
        const reproDir = join(pkgDir, REPRO_BUILD_DIR);
        let differ;
        try {
            rmSync(reproDir, { recursive: true, force: true });
            run(['meson', 'setup', REPRO_BUILD_DIR, '.'], pkgDir);
            run(['meson', 'compile', '-C', REPRO_BUILD_DIR], pkgDir);
            run([process.execPath, STAGER, '.', '--build-dir', REPRO_BUILD_DIR, '--scratch'], pkgDir);
            differ = diffStagedSets(first, stagedDir);
        } catch (cause) {
            // A build that will not REBUILD has not been shown to reproduce anything,
            // so this is a failure of the check and says so rather than passing a
            // comparison it never made.
            console.error(
                `[check-prebuild-reproducible] ${name}: the second build FAILED — that is not a measurement ` +
                    'of reproducibility, so it fails here:',
            );
            console.error(`  ✗ ${String(cause.message ?? cause).split('\n')[0]}`);
            failures++;
            continue;
        } finally {
            rmSync(reproDir, { recursive: true, force: true });
            rmSync(first, { recursive: true, force: true });
        }

        if (differ.length > 0) {
            console.error(
                `[check-prebuild-reproducible] ${name}: NOT REPRODUCIBLE — ${differ.length} file(s) differ ` +
                    'between two clean builds of this same tree:',
            );
            for (const d of differ) {
                console.error(
                    d.bytes < 0
                        ? `  ✗ ${d.file} — present in one build only`
                        : `  ✗ ${d.file} — ${d.bytes} differing byte(s), first at 0x${d.firstAt.toString(16)}`,
                );
            }
            console.error(
                '    Every meson project declares `buildtype=plain` so no `-g` reaches ld64; a debug map\n' +
                    "    (`N_OSO`, carrying each object's mtime) is what puts a timestamp in the image, and the\n" +
                    '    `LC_UUID` and ad-hoc signature computed over it follow. See docs/prebuilds.md.',
            );
            failures++;
            continue;
        }
        console.log(`[check-prebuild-reproducible] ${name}: byte-identical across two clean builds`);

        const committed = resolveStageDir(pkgDir, pkg, target);
        if ('error' in committed) {
            console.warn(
                `[check-prebuild-reproducible] ${name}: no committed counterpart to compare — ${committed.error.split('\n')[0]}`,
            );
            continue;
        }
        if (!existsSync(committed.dir)) {
            console.log(
                `[check-prebuild-reproducible] ${name}: nothing committed at ${relative(ROOT, committed.dir)} yet`,
            );
            continue;
        }
        for (const d of diffStagedSets(stagedDir, committed.dir)) {
            driftRows.push({
                pkg: `${pkg.name} → ${basename(stagedDir)}`,
                file: d.file,
                bytes: d.bytes,
                firstAt: d.firstAt,
            });
        }
    }

    if (driftRows.length > 0) {
        console.log(
            "\n[check-prebuild-reproducible] fresh build vs COMMITTED (reported, not gated — see this file's header):",
        );
        for (const r of driftRows) {
            console.log(
                `  ${r.pkg}  ${r.file}: ${r.bytes < 0 ? 'present on one side only' : `${r.bytes} differing byte(s)`}`,
            );
        }
    } else {
        console.log(
            '\n[check-prebuild-reproducible] fresh build matches the committed bytes — nothing for commit-prebuilds to land',
        );
    }
    summarise(driftRows);

    if (failures > 0) {
        console.error(`\n[check-prebuild-reproducible] FAILED: ${failures} package(s) did not reproduce`);
        process.exit(1);
    }
    console.log(`\n[check-prebuild-reproducible] OK — ${dirs.length} package(s) reproduced byte for byte`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('check-prebuild-reproducible.mjs')) main();
