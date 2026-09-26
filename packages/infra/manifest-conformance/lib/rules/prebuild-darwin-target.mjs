/**
 * Rule `prebuild-darwin-target` — does every committed darwin image load on the
 * oldest macOS we support?
 *
 * dyld refuses an image whose `LC_BUILD_VERSION` `minos` is newer than the running
 * OS, before a single symbol is bound. Nothing in this repository used to SET that
 * number, so clang and rustc took it from the build machine: every 0.52.0
 * darwin-arm64 prebuild recorded `26.0` because `macos-latest` had become macOS 26,
 * while nothing documented that macOS 15 was out. The failure a user on 15 sees is a
 * bridge that "just does not load" — the graceful-degradation path, silently. ADR
 * 0074 fixes the number once, as `DARWIN_DEPLOYMENT_TARGET` in `../platforms.mjs`,
 * and this rule holds the committed bytes to it.
 *
 * WHAT IS CHECKED: every Mach-O under every committed `prebuilds/darwin-*` directory
 * of a native package (the same package set `prebuild-artifacts` walks). Its `minos`
 * comes out of the binary through the one parser (`../binary.mjs` `readLibrary`),
 * never out of a manifest — a hand-maintained fact about a committed binary is one
 * that has already drifted, the same reasoning `prebuild-libc` applies to the glibc
 * floor. An image OLDER than the floor passes: `@gjsify/webkit-native` deliberately
 * pins 11.0 (its API floor, ADR 0022) and rustc's cdylibs default to 11.0/10.12, and
 * both load everywhere the floor does.
 *
 * AN UNMEASURED IMAGE IS A FAILURE. A Mach-O that records neither `LC_BUILD_VERSION`
 * nor `LC_VERSION_MIN_MACOSX`, or that the parser cannot read, is reported rather
 * than passed: "no record, so presumably old" is a conclusion about bytes nobody
 * read.
 *
 * REPORT MODE. `ctx.options.darwinDeploymentTarget === 'report'` turns every finding
 * into a printed note instead of a failure. It exists for exactly one situation: the
 * floor was lowered (or first declared) and the committed artifacts are only rebuilt
 * by CI after the change merges — `prebuilds.yml`'s `commit-prebuilds` on `main`. A
 * per-package exemption would have to live in generated manifests and be cleared by
 * the commit that lands the artifacts; one caller option, flipped back once they
 * have landed, is the smaller honest thing. The default is `'enforce'`, which is
 * what a consumer running this rule on its own package gets.
 *
 * PORTABLE: files and file headers only. The floor is gjsify's platform contract,
 * not this repository's layout — a consumer's darwin prebuild that needs a newer
 * macOS than gjsify supports is wrong in that consumer's tree too.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../registry.mjs';
import { compareGlibcVersions, readLibrary } from '../binary.mjs';
import { DARWIN_DEPLOYMENT_TARGET } from '../platforms.mjs';
import { collectNativePackages } from './prebuild-artifacts.mjs';

/** Every regular file under `dir`, recursively — a prebuild dir is flat today, but a nested image is still shipped. */
function filesUnder(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...filesUnder(full));
        else if (entry.isFile()) out.push(full);
    }
    return out.sort();
}

/**
 * Measure every Mach-O in one prebuild directory against `floor`.
 *
 * `compareGlibcVersions` is the repo's one NUMERIC dotted-version comparison; its
 * name is historical. A lexical compare is wrong on the first pair that matters here
 * (`'10.12' < '9.0'` as strings).
 *
 * @param {string} dir
 * @param {string} floor
 * @returns {{images: number, max: string|null, tooNew: Array<{file: string, minOs: string}>, unmeasured: Array<{file: string, why: string}>}}
 */
export function measureDarwinTargets(dir, floor = DARWIN_DEPLOYMENT_TARGET) {
    const result = { images: 0, max: null, tooNew: [], unmeasured: [] };
    for (const file of filesUnder(dir)) {
        let info;
        try {
            info = readLibrary(file);
        } catch (err) {
            // `readLibrary` throws only on a file whose magic it RECOGNISED as Mach-O
            // (fat, 32-bit, truncated load commands) — so this is an image, unread.
            result.unmeasured.push({ file, why: err instanceof Error ? err.message : String(err) });
            continue;
        }
        if (!info || info.format !== 'macho') continue;
        result.images++;
        if (info.minOs === null) {
            result.unmeasured.push({ file, why: 'records neither LC_BUILD_VERSION (macOS) nor LC_VERSION_MIN_MACOSX' });
            continue;
        }
        if (result.max === null || compareGlibcVersions(info.minOs, result.max) > 0) result.max = info.minOs;
        if (compareGlibcVersions(info.minOs, floor) > 0) result.tooNew.push({ file, minOs: info.minOs });
    }
    return result;
}

/**
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function auditPrebuildDarwinTarget(ctx) {
    const floor = DARWIN_DEPLOYMENT_TARGET;
    const report = ctx.options?.darwinDeploymentTarget === 'report';
    /** @type {string[]} */ const findings = [];
    /** @type {string[]} */ const notes = [];
    const stats = { floor, directories: 0, images: 0, tooNew: 0, unmeasured: 0, mode: report ? 'report' : 'enforce' };

    for (const pkg of collectNativePackages(ctx)) {
        if (!pkg.prebuildsField) continue;
        for (const target of pkg.shipped.filter((t) => t.startsWith('darwin-'))) {
            const dir = join(pkg.prebuildDir, target);
            if (!existsSync(dir)) continue;
            stats.directories++;
            const m = measureDarwinTargets(dir, floor);
            stats.images += m.images;
            stats.tooNew += m.tooNew.length;
            stats.unmeasured += m.unmeasured.length;
            const rel = `${pkg.path}/${pkg.prebuildsField}/${target}`;
            for (const { file, minOs } of m.tooNew) {
                findings.push(
                    `${pkg.name} [${target}]: ${rel}/${file.slice(dir.length + 1)} needs macOS ${minOs}, above the ` +
                        `declared floor ${floor} — dyld refuses to load it on every macOS in between. Rebuild it ` +
                        `with MACOSX_DEPLOYMENT_TARGET=${floor} (CI: \`.github/actions/darwin-deployment-target\`; ` +
                        'ADR 0074).',
                );
            }
            for (const { file, why } of m.unmeasured) {
                findings.push(
                    `${pkg.name} [${target}]: ${rel}/${file.slice(dir.length + 1)} — deployment target not measured ` +
                        `(${why}). An unread image is not an old-enough image.`,
                );
            }
        }
    }

    if (report && findings.length > 0) {
        notes.push(
            `REPORT MODE — ${findings.length} darwin image(s) do not meet the macOS ${floor} floor and are ` +
                'NOT failing this run, because the caller passed darwinDeploymentTarget: "report" (committed ' +
                'artifacts awaiting their CI rebuild, ADR 0074). Each one:',
            ...findings,
        );
        return { failures: [], notes, stats };
    }
    return { failures: findings, notes, stats };
}

export const prebuildDarwinTargetRule = defineRule({
    id: 'prebuild-darwin-target',
    scope: 'portable',
    // No manifest field: the floor is a platform constant (ADR 0074), not a per-package
    // declaration. It reads the same `gjsify.prebuilds` directories `prebuild-artifacts`
    // governs, and claiming that field twice would not add coverage.
    fields: [],
    description:
        'every committed darwin prebuild image records a macOS deployment target at or below the declared floor',
    run(ctx) {
        const result = auditPrebuildDarwinTarget(ctx);
        const s = result.stats;
        return {
            ...result,
            summary:
                `${s.images} Mach-O image(s) in ${s.directories} darwin prebuild dir(s) checked against macOS ` +
                `${s.floor} (${s.mode}): ${s.tooNew} above it, ${s.unmeasured} unmeasured`,
        };
    },
});
