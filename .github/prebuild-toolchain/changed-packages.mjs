#!/usr/bin/env node
/**
 * Which native prebuild packages does this change set actually affect?
 *
 * `prebuilds.yml` used to build every package it owns on every leg on every
 * run. That is affordable on a native runner (7-8 min) and ruinous under
 * emulation, where ONE package dominates: measured on the first fully-emulated
 * run (#838, run 30310941686), `@gjsify/lightningcss-native`'s Rust cdylib was
 * 32m02s of ppc64's 41m38s, 32m18s of s390x's 38m54s and 70m28s of riscv64's
 * 96m47s — 77-83 % of each leg for a package whose sources most PRs never
 * touch. `@gjsify/rolldown-native` is already excluded from the emulated
 * matrix outright for exactly this reason; per-package gating continues that
 * line instead of inventing one, and does it for every package uniformly
 * rather than hard-coding one name.
 *
 * THE RULE, and it is the same on a pull request, a push to main and a manual
 * dispatch — no event-based special-casing:
 *
 *     a package is BUILT when something it depends on changed;
 *     otherwise its build and its upload are skipped.
 *
 * WHAT COUNTS AS A DEPENDENCY
 *
 *   1. The package's own sources. DERIVED from `prebuilds.yml`'s own `on:`
 *      `paths:` filter — every entry that lives under the package directory.
 *      Deriving rather than restating is what keeps the two in step: the
 *      trigger list already answers "which files can change a prebuild", and a
 *      second hand-written copy of that answer is the artefact that drifts and
 *      then silently skips. Plus `<pkg>/meson.build` and `<pkg>/package.json`
 *      unconditionally (see the note on package.json below).
 *
 *   2. Its `refs/` submodule PIN. `rolldown-native` path-deps into
 *      `refs/rolldown` and `oxfmt-native` into `refs/oxc`; bumping a pin
 *      changes the linked source — and therefore the binary — without touching
 *      one byte of the package. The set is the union of two sources, because
 *      neither alone is complete:
 *        • `package.json#gjsify.refsLockstep` — the DECLARED relation
 *          (`rolldown-native` has one).
 *        • the Cargo `path = "…/refs/<x>/…"` dependencies of
 *          `<pkg>/src/rust/Cargo.toml` — the LINKED relation, the same
 *          derivation the `refs-pin` conformance rule uses
 *          (`scripts/manifest-conformance/rules/refs-pin.mjs#linkedRefsSubmodules`,
 *          moved there by #847). It is reimplemented in six lines below rather
 *          than imported ON PURPOSE: this classifier runs in a `changes` job
 *          that has nothing but `actions/checkout` and the runner's node, and
 *          gating must not acquire a module graph that can fail to load there.
 *          The duplication is held to the original by a test —
 *          `tests/e2e/prebuild-change-gate/` asserts the two agree for every
 *          native package, so a change to the rule reds a 1-second test
 *          instead of silently skipping a build.
 *      `oxfmt-native` declares NO `refsLockstep` (tracked separately as task
 *      #59). The union is what stops that absence from quietly meaning "this
 *      package never rebuilds": its Cargo path deps into `refs/oxc` are found
 *      regardless. When #59 lands, nothing here has to change.
 *
 *   3. Shared inputs — anything that can change EVERY artifact. Every `paths:`
 *      entry that is not under a package directory (the workflow itself, the
 *      emulated build script, which is also where the base images live), plus
 *      the staging/verification scripts every build runs. A hit here rebuilds
 *      ALL packages; that is the safe default and it is deliberately blunt.
 *
 * WHEN IN DOUBT, BUILD. A false rebuild costs minutes. A false skip ships a
 * stale binary, and this repository committed x86-64 objects into ppc64
 * directories for weeks precisely because nothing noticed. So: an unresolvable
 * diff base builds everything, `--all` builds everything, and the caller is
 * expected to treat a non-zero exit as "build everything" too (prebuilds.yml
 * does; see its `changes` job).
 *
 * WHAT THIS DOES NOT SEE, stated rather than glossed: the crates.io half of a
 * Rust bridge's graph. No `*-native` package commits a `Cargo.lock`, so
 * `lightningcss-native` (crates.io only, no `refs/` path dep) can change
 * because a registry version moved, with nothing in this repository changing
 * at all. Before this gate every run rebuilt it, so such drift landed
 * incidentally; now it lands when the package or a shared input changes, or on
 * a `workflow_dispatch`, which builds everything by design. That is the
 * documented trade, not an oversight.
 *
 * Usage:
 *   node .github/prebuild-toolchain/changed-packages.mjs --base <sha> [--head <ref>]
 *   node .github/prebuild-toolchain/changed-packages.mjs --all
 *   node .github/prebuild-toolchain/changed-packages.mjs --changed-from-stdin < files.txt
 *
 *   --format text|json|github-actions   (default: text)
 *
 * `--changed-from-stdin` takes a newline-separated list of repo-relative paths
 * instead of running `git diff`, which is how the test suite drives it.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'prebuilds.yml');

/**
 * Shared inputs that are NOT in the workflow's `paths:` filter by nature of
 * being scripts the build calls rather than sources it compiles. They are in
 * the filter too (so a change to one triggers a run at all); this list is what
 * makes them rebuild EVERY package once a run has started.
 */
const SHARED_SCRIPTS = [
    'scripts/stage-prebuild.mjs',
    'scripts/check-refs-pin.mjs',
    'scripts/check-prebuild-loader-path.mjs',
    // Since #847 the three entries above are thin CLI wrappers and the checks
    // live in the conformance registry. A rule change alters what every build
    // verifies, so the registry is a shared input in its own right — naming
    // only the wrappers would let the substance move out from under the gate.
    'scripts/manifest-conformance/**',
];

// ─── argv ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = { format: 'text', head: 'HEAD', all: false, stdin: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--all') out.all = true;
        else if (a === '--changed-from-stdin') out.stdin = true;
        else if (a === '--base') out.base = argv[++i];
        else if (a === '--head') out.head = argv[++i];
        else if (a.startsWith('--base=')) out.base = a.slice('--base='.length);
        else if (a.startsWith('--head=')) out.head = a.slice('--head='.length);
        else if (a.startsWith('--format=')) out.format = a.slice('--format='.length);
        else if (a === '--format') out.format = argv[++i];
        else throw new Error(`unknown argument: ${a}`);
    }
    return out;
}

// ─── the workflow's own `paths:` filter is the source of truth ──────────────

/**
 * `prebuilds.yml`'s `on:` `paths:` lists, ONE ARRAY PER LIST.
 *
 * A structural read rather than a YAML parse, matching how the `platforms-ci`
 * conformance rule reads the same file.
 *
 * PER LIST, NOT UNIONED, and that is the whole point. `prebuilds.yml` has two
 * `paths:` blocks (push + pull_request) and its own comment requires them to be
 * identical — "a path that can change a prebuild on main is a path that has to
 * be able to prove itself on a PR". Nothing checked that. A union cannot: with
 * `refs/oxc` deleted from ONE list the union still contains it, so the
 * gate-vs-trigger assertion passed while a pin bump could no longer start the
 * workflow on that event. Verified by deleting exactly that line — the check
 * stayed green until this became per-list.
 *
 * @returns {string[][]} one entry array per `paths:` block, in file order
 */
function workflowPathFilterLists(text) {
    const lines = text.split('\n');
    /** @type {string[][]} */
    const lists = [];
    /** @type {string[] | null} */
    let current = null;
    for (const line of lines) {
        if (/^jobs:\s*$/.test(line)) break; // `on:` is above `jobs:`; stop there.
        if (/^\s*paths:\s*$/.test(line)) {
            current = [];
            lists.push(current);
            continue;
        }
        if (!current) continue;
        const item = /^\s*-\s*'([^']+)'\s*$/.exec(line) ?? /^\s*-\s*"([^"]+)"\s*$/.exec(line);
        if (item) {
            current.push(item[1]);
            continue;
        }
        if (line.trim() === '' || /^\s*#/.test(line)) continue;
        current = null;
    }
    return lists;
}

/** The union of every `paths:` list — what a file has to match to be an input at all. */
function unionPathFilters(lists) {
    return [...new Set(lists.flat())];
}

/**
 * Every package directory this workflow produces an artifact for.
 *
 * DERIVED from the workflow's own `path: packages/<a>/<b>/prebuilds/…` lines
 * (upload steps in the build legs, download steps in `commit-prebuilds`), so a
 * package added to the workflow is gated the day it is added and a package
 * with its own workflow — `@gjsify/napi`, `@gjsify/node-gi` — is excluded
 * without an exclusion list.
 *
 * @returns {string[]} repo-relative package dirs, sorted
 */
function workflowPackageDirs(text) {
    const dirs = new Set();
    for (const m of text.matchAll(/^\s*path:\s*(packages\/[^\s/]+\/[^\s/]+)\/prebuilds\//gm)) {
        dirs.add(m[1]);
    }
    return [...dirs].sort();
}

// ─── per-package inputs ────────────────────────────────────────────────────

/** Glob (GitHub `paths:` dialect) → anchored RegExp over repo-relative paths. */
function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                re += '.*';
                i++;
                // `a/**` deliberately does NOT also match the bare directory
                // `a`: the inputs are changed FILES, and a directory is never
                // one of those.
            } else {
                re += '[^/]*';
            }
        } else if ('\\^$.|?+()[]{}'.includes(c)) {
            re += `\\${c}`;
        } else {
            re += c;
        }
    }
    return new RegExp(`^${re}$`);
}

/**
 * The `refs/<name>` submodules a package links by Cargo PATH dependency.
 * Same derivation as `scripts/check-refs-pin.mjs#linkedRefsSubmodules`, and
 * deliberately so: what the pin check verifies is what the build links, which
 * is what a pin bump changes.
 */
function cargoRefsSubmodules(pkgDir) {
    const cargoToml = join(ROOT, pkgDir, 'src', 'rust', 'Cargo.toml');
    if (!existsSync(cargoToml)) return [];
    const found = new Set();
    for (const m of readFileSync(cargoToml, 'utf8').matchAll(/path\s*=\s*"[^"]*?refs\/([A-Za-z0-9._-]+)/g)) {
        found.add(`refs/${m[1]}`);
    }
    return [...found];
}

/** The `refs/<name>` submodules a package DECLARES a lockstep relation with. */
function declaredRefsSubmodules(pkgDir) {
    const pkgJson = join(ROOT, pkgDir, 'package.json');
    if (!existsSync(pkgJson)) return [];
    try {
        return Object.keys(JSON.parse(readFileSync(pkgJson, 'utf8')).gjsify?.refsLockstep ?? {});
    } catch {
        return [];
    }
}

/**
 * @typedef {object} PackageInputs
 * @property {string} key      short name used by the workflow's `if:` gates
 * @property {string} dir      repo-relative package directory
 * @property {string[]} refs   `refs/<name>` submodule paths it links
 * @property {RegExp[]} matchers
 */

/** @returns {PackageInputs[]} */
function buildPackageTable(pathFilters, packageDirs) {
    return packageDirs.map((dir) => {
        const refs = [...new Set([...declaredRefsSubmodules(dir), ...cargoRefsSubmodules(dir)])].sort();
        const globs = pathFilters.filter((p) => p.startsWith(`${dir}/`));
        const matchers = globs.map(globToRegExp);
        // `meson.build` is in the trigger list for every package already; it is
        // added here so the table does not depend on that staying true.
        matchers.push(globToRegExp(`${dir}/meson.build`));
        // `package.json` carries `gjsify.platforms` (which target directory
        // `stage-prebuild.mjs` writes) and `gjsify.refsLockstep` — real build
        // inputs. It is deliberately NOT in the trigger list: release-it
        // rewrites every package.json on every release, and putting it there
        // would run three emulated legs on each version bump. So it can only
        // ever make a run that is already happening build MORE, never start
        // one.
        matchers.push(globToRegExp(`${dir}/package.json`));
        // A gitlink shows up in `git diff --name-only` as the submodule path.
        for (const ref of refs) matchers.push(globToRegExp(ref));
        return { key: dir.split('/').pop(), dir, refs, globs, matchers };
    });
}

/** Shared-input matchers: every `paths:` entry outside a package dir, + the scripts. */
function buildSharedMatchers(pathFilters, packageDirs) {
    const out = [];
    for (const p of pathFilters) {
        if (packageDirs.some((d) => p.startsWith(`${d}/`))) continue;
        // A `refs/<x>` entry is a PER-PACKAGE input (added to the trigger list
        // so a pin bump starts a run at all), never a shared one.
        if (p.startsWith('refs/')) continue;
        out.push({ glob: p, re: globToRegExp(p) });
    }
    for (const s of SHARED_SCRIPTS) {
        if (!out.some((o) => o.glob === s)) out.push({ glob: s, re: globToRegExp(s) });
    }
    return out;
}

// ─── self-check: the gate and the trigger must agree ───────────────────────

/**
 * A package that can never be TRIGGERED by its own sources can never be
 * rebuilt when they change, and a gate would make that invisible instead of
 * merely latent. Likewise a `refs/` pin that is not in the trigger list: the
 * bump changes the artifact and the workflow does not even run. Both are
 * silent-staleness bugs, so they are hard errors here rather than comments.
 *
 * Every check runs against EACH `paths:` list separately, so a trigger present
 * on `push` but missing on `pull_request` (or vice versa) fails — that is the
 * "repeated VERBATIM" rule prebuilds.yml states in a comment and nothing
 * enforced.
 *
 * @param {PackageInputs[]} table
 * @param {string[][]} pathFilterLists one array per `paths:` block
 * @returns {string[]} problems (empty = ok)
 */
function selfCheck(table, pathFilterLists) {
    const problems = [];
    if (pathFilterLists.length < 2) {
        problems.push(
            `prebuilds.yml: found ${pathFilterLists.length} \`on: paths:\` list(s), expected at least 2 (push + pull_request). Either the trigger shape changed or this parser no longer understands it — refusing to gate on a filter it cannot read.`,
        );
        return problems;
    }
    // The lists must be identical; report the difference once rather than
    // per-package, which would bury the cause under ten symptoms.
    const [first, ...rest] = pathFilterLists;
    for (const [i, other] of rest.entries()) {
        const missing = first.filter((p) => !other.includes(p));
        const extra = other.filter((p) => !first.includes(p));
        if (missing.length || extra.length) {
            problems.push(
                `prebuilds.yml: \`on: paths:\` list #${i + 2} differs from list #1 — the two MUST be identical (a path that can change a prebuild on main has to be able to prove itself on a PR).` +
                    (missing.length ? ` Missing from #${i + 2}: ${missing.join(', ')}.` : '') +
                    (extra.length ? ` Only in #${i + 2}: ${extra.join(', ')}.` : ''),
            );
        }
    }
    for (const pkg of table) {
        if (!existsSync(join(ROOT, pkg.dir, 'package.json'))) {
            problems.push(
                `${pkg.dir}: no package.json — the workflow uploads a prebuild for a directory that is not a package.`,
            );
        }
        if (pkg.globs.length === 0) {
            problems.push(
                `${pkg.key}: no entry of prebuilds.yml's \`on: paths:\` filter lives under ${pkg.dir}/, so a change to its own sources cannot even start this workflow. Add \`${pkg.dir}/src/**\` (and its meson.build) to BOTH paths lists.`,
            );
        }
        for (const ref of pkg.refs) {
            // EVERY list, not the union — a pin listed on `push` only would let
            // a bump reach main without a PR ever building it.
            const missingFrom = pathFilterLists
                .map((list, i) => (list.includes(ref) ? null : `#${i + 1}`))
                .filter(Boolean);
            if (missingFrom.length > 0) {
                problems.push(
                    `${pkg.key}: links ${ref} by Cargo path dependency (or declares it in gjsify.refsLockstep), but \`${ref}\` is missing from prebuilds.yml \`on: paths:\` list(s) ${missingFrom.join(', ')} — bumping that submodule pin changes the binary and would not even run this workflow on that event. Add \`${ref}\` to BOTH paths lists.`,
                );
            }
        }
    }
    return problems;
}

// ─── diff ──────────────────────────────────────────────────────────────────

function git(args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function changedFiles(base, head) {
    // `--name-only` on a two-dot range: what actually differs between the two
    // trees, submodule gitlinks included (they appear as the submodule path).
    return git(['diff', '--name-only', `${base}`, `${head}`])
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

function revisionExists(rev) {
    try {
        git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

// ─── decide ────────────────────────────────────────────────────────────────

function decide(table, shared, files, forcedReason) {
    /** @type {Record<string, {build: boolean, why: string}>} */
    const decisions = {};
    if (forcedReason) {
        for (const pkg of table) decisions[pkg.key] = { build: true, why: forcedReason };
        return { decisions, reason: forcedReason };
    }

    const sharedHits = [];
    for (const s of shared) {
        for (const f of files) {
            if (s.re.test(f)) {
                sharedHits.push(f);
                break;
            }
        }
    }
    if (sharedHits.length > 0) {
        const why = `shared input changed (${sharedHits.slice(0, 3).join(', ')}${sharedHits.length > 3 ? ', …' : ''})`;
        for (const pkg of table) decisions[pkg.key] = { build: true, why };
        return { decisions, reason: why };
    }

    for (const pkg of table) {
        const hits = files.filter((f) => pkg.matchers.some((re) => re.test(f)));
        decisions[pkg.key] = hits.length
            ? {
                  build: true,
                  why: `${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ` (+${hits.length - 3} more)` : ''}`,
              }
            : {
                  build: false,
                  why: `no change under ${pkg.dir}/${pkg.refs.length ? ` or ${pkg.refs.join(', ')}` : ''}`,
              };
    }
    const built = Object.values(decisions).filter((d) => d.build).length;
    return { decisions, reason: `${built} of ${table.length} package(s) affected` };
}

// ─── emit ──────────────────────────────────────────────────────────────────

function emit(format, table, result) {
    const build = table.filter((p) => result.decisions[p.key].build).map((p) => p.key);
    const skip = table.filter((p) => !result.decisions[p.key].build).map((p) => p.key);
    const report = table.map((p) => ({ key: p.key, dir: p.dir, ...result.decisions[p.key] }));

    if (format === 'json') {
        console.log(JSON.stringify({ build, skip, reason: result.reason, report }, null, 2));
        return;
    }
    if (format === 'github-actions') {
        const out = process.env.GITHUB_OUTPUT;
        const lines = [
            `skip=${JSON.stringify(skip)}`,
            `build=${JSON.stringify(build)}`,
            `reason=${result.reason}`,
            `report=${JSON.stringify(report)}`,
        ].join('\n');
        if (out) appendFileSync(out, `${lines}\n`);
        console.log(lines);
        return;
    }
    console.log(`reason: ${result.reason}`);
    for (const r of report) console.log(`  ${r.build ? 'BUILD' : 'skip '}  ${r.key.padEnd(20)} ${r.why}`);
}

// ─── main ──────────────────────────────────────────────────────────────────

function main() {
    const args = parseArgs(process.argv.slice(2));
    const text = readFileSync(WORKFLOW, 'utf8');
    const pathFilterLists = workflowPathFilterLists(text);
    // MATCHING uses the union (a file that appears in any list can start a run
    // and is therefore an input); the SELF-CHECK below holds each list on its
    // own, because that is where a divergence hides.
    const pathFilters = unionPathFilters(pathFilterLists);
    const packageDirs = workflowPackageDirs(text);
    if (packageDirs.length === 0) {
        throw new Error(
            'no `path: packages/<a>/<b>/prebuilds/…` steps found in .github/workflows/prebuilds.yml — the package table is derived from those, so this is either a shape change the parser does not understand or a genuinely empty workflow. Refusing to report "nothing to build".',
        );
    }
    const table = buildPackageTable(pathFilters, packageDirs);
    const shared = buildSharedMatchers(pathFilters, packageDirs);

    const problems = selfCheck(table, pathFilterLists);
    if (problems.length > 0) {
        for (const p of problems) console.error(`::error::${p}`);
        throw new Error(`${problems.length} gate/trigger disagreement(s) — see above.`);
    }

    let files = [];
    let forced = null;
    if (args.all) {
        forced = 'forced: --all';
    } else if (args.stdin) {
        files = readFileSync(0, 'utf8')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    } else if (!args.base) {
        forced = 'forced: no diff base given';
    } else if (!revisionExists(args.base)) {
        forced = `forced: diff base ${args.base} is not a commit in this checkout`;
    } else {
        files = changedFiles(args.base, args.head);
    }

    const result = decide(table, shared, files, forced);
    emit(args.format, table, result);
}

main();
