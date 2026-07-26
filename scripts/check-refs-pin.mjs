#!/usr/bin/env node
/**
 * Guard: a native bridge must be compiled against the `refs/` submodule
 * commit this repository PINS, never against whatever happens to be checked
 * out locally.
 *
 * The bridges under `packages/infra/*-native/` link upstream Rust crates by
 * Cargo *path* dependency into `refs/<name>/`. A `refs/` working copy that has
 * drifted forward (a `git submodule update --remote`, an `update-submodules`
 * sweep, a manual pull) silently changes what gets linked — and because the
 * resulting `.so` is a COMMITTED prebuild, that drift ships and then runs in
 * CI on every machine, while the npm engine everyone compares against stays on
 * the pinned line.
 *
 * That is not hypothetical: the `@gjsify/rolldown-native` prebuild was once
 * rebuilt against `refs/rolldown` v1.2.0-89 while the pin (and the npm
 * `rolldown` devDep) were on the v1.1.x line. The drifted engine had a
 * reworked code-splitting path, so `codeSplitting: false` stopped collapsing
 * dynamic imports into one chunk and `gjsify build --app gjs --outfile …`
 * failed with "When building multiple chunks, output.dir must be used" — for
 * some packages only, which is what made it look like a source bug.
 *
 * The set of submodules to verify is DERIVED from the package's own
 * `src/rust/Cargo.toml` path dependencies, so it cannot drift from what is
 * actually linked. A package with no `refs/` path deps (crates.io versions
 * only, e.g. `@gjsify/lightningcss-native`) passes trivially.
 *
 * Usage:  node scripts/check-refs-pin.mjs <package-dir>
 * Escape: GJSIFY_ALLOW_REFS_DRIFT=1 — for a DELIBERATE upstream bump, where
 *         the new commit is committed as the new pin in the same change.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string[]} args @returns {string} */
function git(args) {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

/**
 * Distinct `refs/<name>` submodules a package links by Cargo path dependency.
 *
 * @param {string} pkgDir absolute path to the package
 * @returns {string[]} repo-relative submodule paths, sorted
 */
function linkedRefsSubmodules(pkgDir) {
    const cargoToml = join(pkgDir, 'src', 'rust', 'Cargo.toml');
    if (!existsSync(cargoToml)) return [];
    const found = new Set();
    for (const m of readFileSync(cargoToml, 'utf8').matchAll(/path\s*=\s*"[^"]*?refs\/([A-Za-z0-9._-]+)/g)) {
        found.add(`refs/${m[1]}`);
    }
    return [...found].sort();
}

/**
 * Lockstep rule: the pinned commit must be the release tag of the npm package
 * that the *other* engine uses. `@gjsify/rolldown-native` and npm `rolldown`
 * are two builds of the same bundler; when they sit on different versions the
 * two engines disagree silently and only some inputs expose it. That is how
 * `@gjsify/vm`'s `--app gjs --outfile` build broke: the pin sat 41 commits past
 * `v1.1.5` while the npm devDep was `1.1.4`, and the range contained a
 * runtime-chunk change, so the native engine emitted two chunks where npm
 * emitted one.
 *
 * Declared per package as
 * `gjsify.refsLockstep: { "refs/<name>": { npm: "<pkg>", tag: "v{version}" } }`.
 *
 * @param {string} pkgDir absolute path to the package
 * @returns {Record<string, {npm: string, tag: string}>}
 */
function lockstepRules(pkgDir) {
    const pkgJson = join(pkgDir, 'package.json');
    if (!existsSync(pkgJson)) return {};
    try {
        return JSON.parse(readFileSync(pkgJson, 'utf8')).gjsify?.refsLockstep ?? {};
    } catch {
        return {};
    }
}

/** @param {string} name @returns {string | undefined} */
function installedVersion(name) {
    const p = join(repoRoot, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(p)) return undefined;
    try {
        return JSON.parse(readFileSync(p, 'utf8')).version;
    } catch {
        return undefined;
    }
}

const pkgDir = resolve(process.argv[2] ?? process.cwd());
const submodules = linkedRefsSubmodules(pkgDir);
if (submodules.length === 0) process.exit(0);

const lockstep = lockstepRules(pkgDir);
const problems = [];
/** `<submodule>@<sha>` for every submodule that passed, used as the build-dir stamp. */
const validated = [];

for (const sub of submodules) {
    const subDir = join(repoRoot, sub);

    // Read the INDEX, not HEAD: a deliberate pin bump that has been `git add`ed
    // is already the pin this build should honour, so staging it is enough —
    // while forgetting to stage it still fails, which is the point.
    // `git ls-files -s` prints `160000 <sha> 0\t<path>` for a gitlink.
    const pinned = git(['ls-files', '-s', '--', sub]).split(/\s+/)[1];
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

    const actual = git(['-C', sub, 'rev-parse', 'HEAD']);
    if (actual !== pinned) {
        let pinnedDesc = pinned.slice(0, 12);
        let actualDesc = actual.slice(0, 12);
        try {
            pinnedDesc = `${git(['-C', sub, 'describe', '--tags', '--always', pinned])} (${pinnedDesc})`;
            actualDesc = `${git(['-C', sub, 'describe', '--tags', '--always', actual])} (${actualDesc})`;
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
        const version = installedVersion(rule.npm);
        if (!version) {
            problems.push(`${sub}: lockstep partner \`${rule.npm}\` is not installed — cannot verify the pin.`);
        } else {
            const wantTag = rule.tag.replace('{version}', version);
            let wantSha = '';
            try {
                wantSha = git(['-C', sub, 'rev-parse', `${wantTag}^{commit}`]);
            } catch {
                problems.push(`${sub}: lockstep tag \`${wantTag}\` (from ${rule.npm}@${version}) does not exist upstream.`);
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

// A configured `build/` directory does not track the Cargo path-dependency
// sources: after swapping the submodule, `meson compile` reports
// "ninja: no work to do" and re-stages the OLD binary — so a maintainer who
// restores the pin and rebuilds gets a stale artifact and believes it is
// fixed. Stamp what the build dir was configured against, and turn a
// mismatch from silent into loud.
const stampFile = join(pkgDir, 'build', '.gjsify-refs-pin');
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

/** Record what the (about to be configured) build dir is being built against. */
function writeStamp() {
    try {
        mkdirSync(join(pkgDir, 'build'), { recursive: true });
        writeFileSync(stampFile, `${stampNow}\n`, 'utf8');
    } catch {
        // The stamp is a convenience guard, never a build blocker.
    }
}

if (problems.length > 0) {
    const allowDrift = process.env.GJSIFY_ALLOW_REFS_DRIFT === '1';
    const header = `[check-refs-pin] ${pkgDir.slice(repoRoot.length + 1)}: refs/ sources are not in the state this repository pins:`;
    const body = problems.map((p) => `  - ${p}`).join('\n');
    if (allowDrift) {
        console.warn(`${header}\n${body}\n  GJSIFY_ALLOW_REFS_DRIFT=1 — continuing. Commit the new pin in the same change.`);
        writeStamp();
        process.exit(0);
    }
    console.error(
        `${header}\n${body}\n\n` +
            'A committed prebuild built from a drifted checkout ships that drift to every\n' +
            'consumer and to CI, while the npm engine stays on the pinned line. Restore the\n' +
            'pin and rebuild, or — for a deliberate upstream bump — set\n' +
            'GJSIFY_ALLOW_REFS_DRIFT=1 and commit the new submodule pin in the same change.\n',
    );
    process.exit(1);
}

writeStamp();
