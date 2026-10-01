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
 * reads zero `N_OSO` stabs in them), which is NOT the same as saying they
 * reproduce — a `ci:macos` run measured 48 differing bytes in each of them, first
 * at the `LC_UUID`, with identical code. That second cause is rustc's
 * absolute-path install name plus an ld64 UUID that is not a function of the bytes
 * ld64 emits; it is fixed in the three Rust bridges' `meson.build` and by
 * `scripts/macho-set-uuid.mjs`, and status/open-todos/prebuilds.md carries the
 * measurement. After both fixes, on this Mac, two clean builds of every darwin
 * bridge buildable here differ in ZERO bytes.
 *
 * And those three are why the obvious next guess was MEASURED rather than skipped:
 * `-Wl,-no_uuid`, which the paragraph above rejects on cost grounds, would have
 * FAILED their build outright — an arm64 link against a dylib without `LC_UUID`
 * is refused — so it was never an option for them at all.
 *
 * THAT STORY IS ONE PACKAGE CLASS'S, AND THIS SCRIPT USED TO PRINT IT FOR EVERY
 * RED. It then red-lined `main` naming a debug map in three images that carry
 * none: the cargo cdylibs of `@gjsify/{lightningcss,oxfmt,rolldown}-native`
 * differed in 16, 15 and a handful of bytes while all nine Vala bridges were
 * byte-identical — and the first differing offset was 0x670 in one and 0x768 in
 * the other, which is the `LC_UUID` PAYLOAD of each (read off the committed
 * artifacts with `readMachOLayout`, on Linux: `libgjsify_lightningcss.dylib` has
 * its uuid payload at exactly 0x670, `libgjsify_oxfmt.dylib` at exactly 0x768,
 * `libgjsify_rolldown.dylib` at 0x6b8). So the region is MEASURED and it is not a
 * debug map. What produced a different UUID for otherwise byte-identical output is
 * NOT established and needs a darwin runner — `status/open-todos/prebuilds.md`
 * carries the two candidates and the one measurement that would separate them.
 *
 * Two things follow, and both are in this file. A diagnostic now ASKS THE ARTIFACT
 * (`classifyMachOBuildDiff` parses the load commands of both builds and names the
 * region every differing byte falls in) instead of asserting a cause. And the
 * second build happens in the SAME DIRECTORY PATH as the first, because a build
 * path is an input: `cargo`/`rustc` record theirs where a `buildtype=plain` Vala
 * build does not, so comparing `build/` against a differently-named `builddir/`
 * was never a measurement of reproducibility for the three cargo bridges.
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

import { classifyMachOBuildDiff } from '../packages/infra/manifest-conformance/lib/binary.mjs';

import { hostStagingTarget, resolveStageDir } from './stage-prebuild.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGER = join(ROOT, 'scripts', 'stage-prebuild.mjs');
/**
 * The second build's directory — the SAME ONE the first build used, and that is
 * the point rather than an economy.
 *
 * A build directory's absolute path is a build INPUT. `rustc` records build paths
 * unless told not to (no `--remap-path-prefix` here) and `cargo`'s `--target-dir`
 * is derived from this name in every `meson.build` that drives one, while the Vala
 * side, compiled `buildtype=plain`, records nothing of the kind. So the earlier
 * `builddir/` spelling made the second build differ from the first in a way the
 * nine Vala bridges structurally could not see and the three cargo bridges could:
 * two builds at two paths are not one build twice.
 *
 * The cost is that the first build's tree is REMOVED to clear the path. That is
 * affordable because the comparison is of the STAGED sets, and the first one is
 * snapshotted before anything is deleted; the macOS job's remaining steps read
 * `prebuilds/<target>/`, never `build/`. `build/` is gitignored, so a run that
 * dies before its cleanup still leaves nothing in `git status`.
 */
const REPRO_BUILD_DIR = 'build';

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
 * Every differing Mach-O is also CLASSIFIED, so the report names the region the
 * bytes are in rather than leaving the cause to be re-derived from a hex dump.
 * `.typelib` and `.gir` are not Mach-O and come back `unreadable`, which is the
 * honest answer for them — a byte count is all there is to say.
 *
 * @param {string} aDir
 * @param {string} bDir
 * @returns {Array<{ file: string, bytes: number, firstAt: number | null, verdict: string, regions: string[] }>}
 */
export function diffStagedSets(aDir, bDir) {
    const names = new Set([...readdirSync(aDir), ...readdirSync(bDir)]);
    const out = [];
    for (const file of [...names].sort()) {
        const inA = existsSync(join(aDir, file));
        const inB = existsSync(join(bDir, file));
        if (!inA || !inB) {
            out.push({ file, bytes: -1, firstAt: null, verdict: 'missing', regions: [] });
            continue;
        }
        const a = readFileSync(join(aDir, file));
        const b = readFileSync(join(bDir, file));
        const { bytes, firstAt } = diffBytes(a, b);
        if (bytes === 0) continue;
        const { verdict, regions, reasons } = classifyMachOBuildDiff(a, b);
        out.push({ file, bytes, firstAt, verdict, regions: regions.length > 0 ? regions : reasons });
    }
    return out;
}

/**
 * What the classified regions license saying about the CAUSE — and nothing more.
 *
 * The three cargo cdylibs land on `uuid-only`/`uuid-and-signature`; that cause is now
 * measured and fixed (install name + `macho-set-uuid.mjs`), so the text names it as
 * the thing to check, not as a guess.
 *
 * The debug-map reading is offered only where the SYMBOL TABLE actually moved,
 * for the same reason the rest of this changed: it was printed unconditionally
 * once already, over images that carry no debug map.
 *
 * @param {Array<{ verdict: string, regions: string[] }>} rows
 * @returns {string}
 */
export function channelHint(rows) {
    const uuid = rows.some((r) => r.verdict === 'uuid-only' || r.verdict === 'uuid-and-signature');
    const symbols = rows.some((r) => r.regions.some((region) => region.includes('the symbol table')));
    const lines = [];
    if (uuid) {
        lines.push(
            '    The differing bytes are the `LC_UUID` payload (and, on arm64, the ad-hoc signature',
            '    computed over it) — NOT a debug map: `nm -a` reads zero `N_OSO` stabs in the cargo',
            "    cdylibs. In the three Rust bridges the cause is rustc's absolute-path install name plus",
            '    an ld64 `LC_UUID` that is not a function of the bytes ld64 emits; their `meson.build`',
            '    pins the name and `scripts/macho-set-uuid.mjs` writes the UUID last. A difference here',
            '    means that step was skipped or a new input reached the image. See docs/prebuilds.md.',
        );
    }
    if (symbols) {
        lines.push(
            '    A difference in the symbol table is the `-g` story: ld64 writes a DEBUG MAP into any',
            "    image whose objects carry DWARF, one `N_OSO` stab per object holding that object's",
            '    mtime. Every meson project here declares `buildtype=plain` for that reason — check',
            '    that the project which differed still does. See docs/prebuilds.md.',
        );
    }
    return lines.join('\n');
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
 * @param {Array<{ pkg: string, file: string, bytes: number, firstAt: number | null, regions: string[] }>} driftRows
 */
function summarise(driftRows) {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    const rows =
        driftRows.length === 0
            ? ''
            : driftRows.map((r) => `| ${r.pkg} | ${r.file} | ${r.bytes} | ${r.regions.join('; ') || '—'} |`).join('\n');
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
            '| artifact | file | differing bytes | where |',
            '|---|---|---|---|',
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
    /** @type {Array<{ pkg: string, file: string, bytes: number, firstAt: number | null, regions: string[] }>} */
    const driftRows = [];

    for (const stagedDir of dirs) {
        const pkgDir = dirname(dirname(stagedDir));
        const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
        const name = `${pkg.name} (${basename(stagedDir)})`;
        console.log(`\n[check-prebuild-reproducible] ${name}: second build, replacing ${REPRO_BUILD_DIR}/`);

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
                        : `  ✗ ${d.file} — ${d.bytes} differing byte(s), first at 0x${d.firstAt.toString(16)} ` +
                              `[${d.verdict}]`,
                );
                for (const region of d.regions) console.error(`      · ${region}`);
            }
            const hint = channelHint(differ);
            if (hint !== '') console.error(hint);
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
                regions: d.regions,
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
            for (const region of r.regions) console.log(`      · ${region}`);
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
