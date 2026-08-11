/**
 * Rule `refs-pin` — REPO-SCOPED. A native bridge must be compiled against the `refs/`
 * submodule commit this repository PINS, never against whatever happens to be checked
 * out locally.
 *
 * REPO-SCOPED despite `gjsify.refsLockstep` being a documented manifest field: this
 * implementation hard-codes `refs/` as the vendoring directory and Cargo as the build
 * system, and verifies them against THIS repository's git index. The mechanism
 * generalises; the implementation does not.
 *
 * A `refs/` working copy that has drifted forward (`git submodule update --remote`, an
 * `update-submodules` sweep, a manual pull) silently changes what a Cargo *path*
 * dependency links — and since the resulting `.so` is a COMMITTED prebuild, the drift
 * ships and runs in CI everywhere while the npm engine everyone compares against stays
 * on the pinned line. Measured: `@gjsify/rolldown-native` was once rebuilt against
 * `refs/rolldown` v1.2.0-89 while the pin and the npm `rolldown` devDep were on
 * v1.1.x. The drifted engine's reworked code-splitting path stopped collapsing dynamic
 * imports under `codeSplitting: false`, so `gjsify build --app gjs --outfile …` failed
 * with "When building multiple chunks, output.dir must be used" — for some packages
 * only, which is what made it look like a source bug.
 *
 * The submodule set is DERIVED from the package's own `src/rust/Cargo.toml` path
 * dependencies, so it cannot drift from what is actually linked. A package with no
 * `refs/` path deps (crates.io versions only) passes trivially.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/** @param {string} repoRoot @param {string[]} args @returns {string} */
export function git(repoRoot, args) {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

/**
 * Distinct `refs/<name>` submodules a package links by Cargo path dependency.
 *
 * @param {string} pkgDir absolute path to the package
 * @returns {string[]} repo-relative submodule paths, sorted
 */
export function linkedRefsSubmodules(pkgDir) {
    const cargoToml = join(pkgDir, 'src', 'rust', 'Cargo.toml');
    if (!existsSync(cargoToml)) return [];
    const found = new Set();
    for (const m of readFileSync(cargoToml, 'utf8').matchAll(/path\s*=\s*"[^"]*?refs\/([A-Za-z0-9._-]+)/g)) {
        found.add(`refs/${m[1]}`);
    }
    return [...found].sort();
}

/**
 * Lockstep rule: the pinned commit must be the release tag of the npm package the
 * *other* engine uses. `@gjsify/rolldown-native` and npm `rolldown` are two builds of
 * the same bundler, and on different versions they disagree silently on some inputs
 * only — that is how `@gjsify/vm`'s `--app gjs --outfile` build broke, with the pin 41
 * commits past `v1.1.5` against an npm devDep of `1.1.4` across a runtime-chunk change.
 *
 * Declared per package as
 * `gjsify.refsLockstep: { "refs/<name>": { npm: "<pkg>", tag: "v{version}" } }`.
 *
 * @returns {Record<string, {npm: string, tag: string}>}
 */
export function lockstepRules(pkgDir) {
    const pkgJson = join(pkgDir, 'package.json');
    if (!existsSync(pkgJson)) return {};
    try {
        return JSON.parse(readFileSync(pkgJson, 'utf8')).gjsify?.refsLockstep ?? {};
    } catch {
        return {};
    }
}

/** @param {string} repoRoot @param {string} name @returns {string | undefined} */
export function installedVersion(repoRoot, name) {
    const p = join(repoRoot, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(p)) return undefined;
    try {
        return JSON.parse(readFileSync(p, 'utf8')).version;
    } catch {
        return undefined;
    }
}

/**
 * Check ONE package's `refs/` provenance.
 *
 * @param {string} repoRoot
 * @param {string} pkgDir
 * @returns {{problems: string[], validated: string[], stampFile: string, stampNow: string}}
 */
export function inspectRefsPin(repoRoot, pkgDir) {
    const submodules = linkedRefsSubmodules(pkgDir);
    const stampFile = join(pkgDir, 'build', '.gjsify-refs-pin');
    if (submodules.length === 0) return { problems: [], validated: [], stampFile, stampNow: '', skipped: true };

    const lockstep = lockstepRules(pkgDir);
    const problems = [];
    /** `<submodule>@<sha>` for every submodule that passed, used as the build-dir stamp. */
    const validated = [];

    for (const sub of submodules) {
        const subDir = join(repoRoot, sub);

        // Read the INDEX, not HEAD: a deliberate pin bump that has been `git add`ed is
        // already the pin this build should honour, while forgetting to stage it still
        // fails. `git ls-files -s` prints `160000 <sha> 0\t<path>` for a gitlink.
        const pinned = git(repoRoot, ['ls-files', '-s', '--', sub]).split(/\s+/)[1];
        if (!pinned) {
            problems.push(`${sub}: not a submodule of this repository at HEAD.`);
            continue;
        }

        if (!existsSync(subDir) || readdirSync(subDir).length === 0) {
            problems.push(
                `${sub}: not initialized — nothing to compile against.\n` +
                    `    Fix: git submodule update --init ${sub}`,
            );
            continue;
        }

        const actual = git(repoRoot, ['-C', sub, 'rev-parse', 'HEAD']);
        if (actual !== pinned) {
            let pinnedDesc = pinned.slice(0, 12);
            let actualDesc = actual.slice(0, 12);
            try {
                pinnedDesc = `${git(repoRoot, ['-C', sub, 'describe', '--tags', '--always', pinned])} (${pinnedDesc})`;
                actualDesc = `${git(repoRoot, ['-C', sub, 'describe', '--tags', '--always', actual])} (${actualDesc})`;
            } catch {
                // Describe is cosmetic; a shallow clone without tags still reports SHAs.
            }
            problems.push(
                `${sub}: checked out at a commit this repository does not pin.\n` +
                    `    pinned:  ${pinnedDesc}\n` +
                    `    actual:  ${actualDesc}\n` +
                    `    Fix: git submodule update --checkout ${sub}`,
            );
        }

        // Lockstep with the npm build of the same tool, when declared.
        const rule = lockstep[sub];
        if (rule?.npm && rule?.tag) {
            const version = installedVersion(repoRoot, rule.npm);
            if (!version) {
                problems.push(`${sub}: lockstep partner \`${rule.npm}\` is not installed — cannot verify the pin.`);
            } else {
                const wantTag = rule.tag.replace('{version}', version);
                let wantSha = '';
                try {
                    wantSha = git(repoRoot, ['-C', sub, 'rev-parse', `${wantTag}^{commit}`]);
                } catch {
                    problems.push(
                        `${sub}: lockstep tag \`${wantTag}\` (from ${rule.npm}@${version}) does not exist upstream.`,
                    );
                }
                if (wantSha && wantSha !== actual) {
                    problems.push(
                        `${sub}: pinned commit is not the release the npm engine uses.\n` +
                            `    npm ${rule.npm}@${version} → expects tag ${wantTag} (${wantSha.slice(0, 12)})\n` +
                            `    submodule is at             ${actual.slice(0, 12)}\n` +
                            `    The two engines must be the SAME build of the tool; a version gap makes\n` +
                            `    them disagree on some inputs only. Either check out ${wantTag} here, or\n` +
                            `    bump the npm dependency to match and rebuild the prebuild.`,
                    );
                }
            }
        }

        validated.push(`${sub}@${actual}`);
    }

    // A configured `build/` directory does not track the Cargo path-dependency sources:
    // after swapping the submodule, `meson compile` reports "ninja: no work to do" and
    // re-stages the OLD binary, so a maintainer who restores the pin and rebuilds gets
    // a stale artifact and believes it is fixed. The stamp makes that loud.
    const stampNow = validated.join('\n');
    if (existsSync(stampFile)) {
        const recorded = readFileSync(stampFile, 'utf8').trim();
        if (recorded !== stampNow) {
            problems.push(
                'build/ was configured against different refs/ sources than are checked out now.\n' +
                    `    configured with: ${recorded.replace(/\n/g, ', ') || '(unknown)'}\n` +
                    `    checked out now: ${stampNow.replace(/\n/g, ', ')}\n` +
                    '    ninja does not see Cargo path-dep changes, so `meson compile` would report\n' +
                    '    "no work to do" and re-stage the STALE binary.\n' +
                    '    Fix: rm -rf build src/rust/target',
            );
        }
    }

    return { problems, validated, stampFile, stampNow, skipped: false };
}

/** Record what the (about to be configured) build dir is being built against. */
export function writeStamp(stampFile, stampNow) {
    try {
        mkdirSync(join(stampFile, '..'), { recursive: true });
        writeFileSync(stampFile, `${stampNow}\n`, 'utf8');
    } catch {
        // The stamp is a convenience guard, never a build blocker.
    }
}

export const refsPinRule = defineRule({
    id: 'refs-pin',
    scope: 'repo',
    fields: ['gjsify.refsLockstep'],
    description: 'a native bridge links the `refs/` commit this repo pins, in lockstep with its npm twin',
    run(ctx) {
        const failures = [];
        let checked = 0;
        for (const pkg of ctx.allPackages) {
            const { problems, skipped } = inspectRefsPin(ctx.root, pkg.dir);
            if (skipped) continue;
            checked++;
            for (const p of problems) failures.push(`${pkg.name} (${pkg.rel}): ${p}`);
        }
        return {
            failures,
            stats: { checked },
            summary: `refs-pin: OK. ${checked} package(s) link a \`refs/\` submodule; each is at the commit this repo pins.`,
        };
    },
});
