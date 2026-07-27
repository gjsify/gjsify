#!/usr/bin/env node
/**
 * Guard: after a build, every file a workspace package DECLARES must exist.
 *
 * A `package.json` is a contract with two audiences — the bundler/type-checker
 * inside this repo and every consumer outside it — and both read it through the
 * same fields: `main`, `module`, `types`/`typings`, `bin`, and every `exports`
 * condition. A build that leaves one of those paths unwritten produces a package
 * that resolves to nothing, and NOTHING in the pipeline noticed:
 *
 *   - `gjsify tsc` exits 0. With `composite`/`incremental`, a `.tsbuildinfo`
 *     that outlives its output tree makes tsc consider the project up to date
 *     and emit NOTHING — a silent no-op with a success exit code. That is issue
 *     #67, reproduced verbatim in `@gjsify/adwaita-core`: with a stale
 *     `tmp/.tsbuildinfo` present `gjsify tsc` printed nothing, exited 0, and
 *     `lib/types/` was never created; deleting the build info made the SAME
 *     command emit it.
 *   - The build-cache (ADR 0006) restores per output UNIT. A restore that
 *     replaces `lib/esm` while `lib/types` is missing is, from the cache's point
 *     of view, a hit.
 *   - `gjsify pack`'s type-shipping guard (#655, `tests/e2e/publish-types-shipped`)
 *     deliberately does NOT fire on an ABSENT declaration — an unbuilt dev tree
 *     must still pack. It only catches a file that exists but is excluded by
 *     `files`.
 *   - `gjsify tsc --noEmit` (the `check` job) type-checks SOURCES. It never
 *     looks at `lib/`.
 *
 * So the only signal was "the build exited 0", and it lied. The consumer-side
 * symptom is `TS7016: Could not find a declaration file for module
 * '@gjsify/<pkg>'` — which reads like a consumer bug and gets papered over with
 * a per-consumer tsconfig workaround.
 *
 * This is the same shape as `scripts/verify-committed-bundles.mjs`: state the
 * artifact contract, then check it, rather than trusting an exit code. It is
 * cause-agnostic — it catches a stale build info, a cache restore that dropped a
 * unit, a script that was never wired into `build`, and a plain typo in
 * `exports`, without knowing which one happened.
 *
 * WHAT IT COSTS
 *   - It is a POST-condition, so it needs a built tree: run it AFTER a build,
 *     never on a fresh clone (`--allow-unbuilt` degrades to a warning for local
 *     use). In CI that means the `build` job and only there.
 *   - It proves EXISTENCE, not freshness or correctness. A `.d.ts` regenerated
 *     from stale sources still passes; that class belongs to
 *     `verify-committed-bundles.mjs`.
 *   - Wildcard subpaths (`./assets/*`) can only be checked down to their static
 *     directory prefix.
 *   - It reads the declaration as authoritative. A package that declares an
 *     entry point it genuinely does not ship must fix the declaration — there is
 *     deliberately no per-package opt-out, because an opt-out list is the thing
 *     that drifts and then lies.
 *
 * Usage:
 *   node scripts/verify-package-outputs.mjs                 # non-private workspaces
 *   node scripts/verify-package-outputs.mjs --include-private
 *   node scripts/verify-package-outputs.mjs --allow-unbuilt # warn, don't fail
 *   node scripts/verify-package-outputs.mjs --json
 *   node scripts/verify-package-outputs.mjs --root <dir>    # another workspace root
 *   node scripts/verify-package-outputs.mjs --only @gjsify/adwaita-core   # one package
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const argv = process.argv.slice(2);
const args = new Set(argv);
const rootFlag = argv.indexOf('--root');
// `--root` exists so the guard can be exercised against fixture trees
// (tests/e2e/package-outputs) instead of only against the repo it lives in.
const repoRoot = rootFlag === -1 ? resolve(dirname(fileURLToPath(import.meta.url)), '..') : resolve(argv[rootFlag + 1]);
const inActions = Boolean(process.env.GITHUB_ACTIONS);

const includePrivate = args.has('--include-private');
const allowUnbuilt = args.has('--allow-unbuilt');
const asJson = args.has('--json');
// `--only <name>` (repeatable) narrows the sweep to named packages. CI never
// passes it — the whole point of the guard is that its package set is derived,
// not curated — but it makes a single package inspectable while iterating.
const only = argv.flatMap((a, i) => (a === '--only' && argv[i + 1] ? [argv[i + 1]] : []));

/**
 * Workspaces this check does not own.
 *
 * `@girs/*` are generated type packages, `@gjsify/website` is an Astro site and
 * `@gjsify/example-*` build only when an example is in the CI closure — the same
 * carve-outs the root `build` script already spells out. Anything else is in.
 */
const EXCLUDED_NAME_PATTERNS = [/^@girs\//, /^@gjsify\/website$/, /^@gjsify\/example-/];

// ── workspace discovery ─────────────────────────────────────────────────

/** Expand ONE `workspaces` glob (`a/b/*`, `a/b`) to package dirs, absolute. */
function expandWorkspaceGlob(pattern) {
    const segments = pattern.split('/');
    let dirs = [repoRoot];
    for (const segment of segments) {
        const next = [];
        for (const dir of dirs) {
            if (segment === '*') {
                let entries;
                try {
                    entries = readdirSync(dir, { withFileTypes: true });
                } catch {
                    continue;
                }
                for (const entry of entries) if (entry.isDirectory()) next.push(join(dir, entry.name));
            } else {
                const candidate = join(dir, segment);
                if (existsSync(candidate) && statSync(candidate).isDirectory()) next.push(candidate);
            }
        }
        dirs = next;
    }
    return dirs.filter((d) => existsSync(join(d, 'package.json')));
}

/** Every workspace package dir, honouring the `!negation` entries. */
function workspaceDirs() {
    const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const patterns = root.workspaces ?? [];
    const included = new Set();
    const excluded = new Set();
    for (const pattern of patterns) {
        const negated = pattern.startsWith('!');
        const target = negated ? excluded : included;
        for (const dir of expandWorkspaceGlob(negated ? pattern.slice(1) : pattern)) target.add(dir);
    }
    return [...included].filter((d) => !excluded.has(d)).sort();
}

// ── declared-path extraction ────────────────────────────────────────────

/**
 * A value is a path this repo can check only when it is RELATIVE. Bare
 * specifiers (`browser` remaps a dependency name), `false` (browser exclusion),
 * `null` (an `exports` block) and non-strings are somebody else's contract.
 */
function isCheckablePath(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.startsWith('#') || value.startsWith('node:')) return false;
    // `./x`, `../x`, `x/y.js`, `x.js` — but not `pkg` or `@scope/pkg`.
    if (value.startsWith('./') || value.startsWith('../')) return true;
    return /^[^@][^:]*\.[a-z0-9]+$/i.test(value) || value.includes('/');
}

/**
 * Collect `{ field, value }` for every path a package.json declares.
 * `exports` is walked recursively: condition objects, subpath maps and the
 * array fallback form all bottom out in strings.
 */
function declaredPaths(pkg) {
    const out = [];

    for (const field of ['main', 'module', 'types', 'typings', 'style', 'unpkg']) {
        if (isCheckablePath(pkg[field])) out.push({ field, value: pkg[field] });
    }
    // `browser` is either a single entry point or a remap table whose values may
    // be `false` or another module — only relative values are ours to check.
    if (typeof pkg.browser === 'string' && isCheckablePath(pkg.browser)) {
        out.push({ field: 'browser', value: pkg.browser });
    } else if (pkg.browser && typeof pkg.browser === 'object') {
        for (const [key, value] of Object.entries(pkg.browser)) {
            if (isCheckablePath(value)) out.push({ field: `browser[${JSON.stringify(key)}]`, value });
        }
    }

    if (typeof pkg.bin === 'string' && isCheckablePath(pkg.bin)) {
        out.push({ field: 'bin', value: pkg.bin });
    } else if (pkg.bin && typeof pkg.bin === 'object') {
        for (const [name, value] of Object.entries(pkg.bin)) {
            if (isCheckablePath(value)) out.push({ field: `bin[${JSON.stringify(name)}]`, value });
        }
    }

    // gjsify's own GJS-first bin map (`gjsify.bin`) is resolved by the CLI the
    // same way npm resolves `bin`, so it carries the same promise.
    const gjsifyBin = pkg.gjsify?.bin;
    if (typeof gjsifyBin === 'string' && isCheckablePath(gjsifyBin)) {
        out.push({ field: 'gjsify.bin', value: gjsifyBin });
    } else if (gjsifyBin && typeof gjsifyBin === 'object') {
        for (const [name, value] of Object.entries(gjsifyBin)) {
            if (isCheckablePath(value)) out.push({ field: `gjsify.bin[${JSON.stringify(name)}]`, value });
        }
    }

    const walkExports = (node, path) => {
        if (node === null || node === undefined) return;
        if (typeof node === 'string') {
            if (isCheckablePath(node)) out.push({ field: path, value: node });
            return;
        }
        if (Array.isArray(node)) {
            node.forEach((entry, i) => walkExports(entry, `${path}[${i}]`));
            return;
        }
        if (typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) walkExports(value, `${path}[${JSON.stringify(key)}]`);
        }
    };
    walkExports(pkg.exports, 'exports');

    return out;
}

/**
 * What must exist on disk for a declared value.
 *
 * A subpath PATTERN (`./assets/*`) has no single target, so the promise it can
 * still be held to is that the directory it globs into exists — a package that
 * exports `./assets/*` and ships no `assets/` is broken in exactly the way this
 * check is for.
 */
function targetFor(pkgDir, value) {
    if (!value.includes('*')) return { abs: resolve(pkgDir, value), kind: 'file' };
    const staticPrefix = value.slice(0, value.indexOf('*'));
    const dir = posix.dirname(`${staticPrefix}x`);
    return { abs: resolve(pkgDir, dir), kind: 'dir' };
}

// ── run ─────────────────────────────────────────────────────────────────

function fail(msg) {
    console.error(inActions ? `::error::${msg}` : `ERROR: ${msg}`);
}

const results = [];
for (const pkgDir of workspaceDirs()) {
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    } catch (err) {
        results.push({ dir: relative(repoRoot, pkgDir), name: null, error: String(err), missing: [] });
        continue;
    }
    const name = pkg.name ?? relative(repoRoot, pkgDir);
    if (only.length > 0 && !only.includes(name)) continue;
    if (only.length === 0) {
        if (EXCLUDED_NAME_PATTERNS.some((re) => re.test(name))) continue;
        if (pkg.private === true && !includePrivate) continue;
    }

    const missing = [];
    for (const { field, value } of declaredPaths(pkg)) {
        const { abs, kind } = targetFor(pkgDir, value);
        if (existsSync(abs) && (kind === 'file' || statSync(abs).isDirectory())) continue;
        missing.push({ field, value, path: relative(repoRoot, abs), kind });
    }
    results.push({
        dir: relative(repoRoot, pkgDir),
        name,
        missing,
        // Printed on failure so the reader knows what to re-run, without this
        // script needing a map of which script owns which output.
        scripts: Object.fromEntries(
            Object.entries(pkg.scripts ?? {}).filter(([key]) => key === 'build' || key.startsWith('build:')),
        ),
    });
}

const broken = results.filter((r) => r.missing.length > 0 || r.error);
const totalMissing = broken.reduce((n, r) => n + r.missing.length, 0);

if (asJson) {
    console.log(JSON.stringify({ checked: results.length, broken, totalMissing }, null, 2));
} else {
    console.log(
        `Declared-output check: ${results.length} workspace package(s)${includePrivate ? '' : ' (non-private)'}`,
    );
    for (const r of broken) {
        if (r.error) {
            fail(`${r.dir}: unreadable package.json — ${r.error}`);
            continue;
        }
        fail(`${r.name} (${r.dir}) declares ${r.missing.length} path(s) that do not exist:`);
        for (const m of r.missing) console.error(`    ${m.field} → ${m.value}   (missing ${m.kind}: ${m.path})`);
        const scripts = Object.keys(r.scripts);
        if (scripts.length > 0) {
            console.error(`    produced by: ${scripts.map((s) => `gjsify workspace ${r.name} ${s}`).join(' · ')}`);
        }
    }
}

if (totalMissing === 0 && broken.length === 0) {
    if (!asJson) console.log('All declared entry points exist.');
    process.exit(0);
}

if (allowUnbuilt) {
    if (!asJson) {
        console.error(
            `\n${totalMissing} declared path(s) missing across ${broken.length} package(s) — ` +
                'tolerated (--allow-unbuilt). Run a full build and re-check.',
        );
    }
    process.exit(0);
}

// `--json` stays machine-parseable even when redirected with 2>&1: the verdict
// is already in the payload (`totalMissing`) and in the exit code.
if (!asJson) {
    fail(
        `${totalMissing} declared path(s) missing across ${broken.length} package(s). ` +
            'A build that leaves a declared entry point unwritten still exits 0 — most often a ' +
            '`.tsbuildinfo` that outlived its output tree, which makes `gjsify tsc` a silent no-op. ' +
            "Delete the package's build info (its `clear` script does) and rebuild, then fix the " +
            'declaration or the build script so it cannot recur.',
    );
}
process.exit(1);
