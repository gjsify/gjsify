#!/usr/bin/env node
/**
 * CI entry: after a build, every file a workspace package DECLARES must exist.
 *
 * The check itself is the PORTABLE `package-outputs` rule in
 * `@gjsify/manifest-conformance`, which reads nothing but manifests and the
 * filesystem so it can also run in a consumer's tree. Its full rationale (why
 * `gjsify tsc` can exit 0 having written nothing, why the build cache calls a tree
 * missing a unit a hit, why `gjsify pack`'s type guard deliberately does not fire)
 * lives with the rule.
 *
 * What stays HERE is repository-specific: which workspace names are out of scope,
 * and the `--json` rendering other tooling may consume.
 *
 * Usage:
 *   node scripts/verify-package-outputs.mjs                 # non-private workspaces
 *   node scripts/verify-package-outputs.mjs --scope examples  # `@gjsify/example-*` only
 *   node scripts/verify-package-outputs.mjs --scope all
 *   node scripts/verify-package-outputs.mjs --include-private
 *   node scripts/verify-package-outputs.mjs --allow-unbuilt # warn, don't fail
 *   node scripts/verify-package-outputs.mjs --json
 *   node scripts/verify-package-outputs.mjs --root <dir>    # another workspace root
 *   node scripts/verify-package-outputs.mjs --only @gjsify/adwaita-core   # one package
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { createContext } from '../packages/infra/manifest-conformance/lib/context.mjs';
import { inspectDeclaredOutputs } from '../packages/infra/manifest-conformance/lib/rules/package-outputs.mjs';

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
// `--only <name>` (repeatable) narrows the sweep. CI never passes it — the point of
// the guard is that its package set is derived, not curated.
const only = argv.flatMap((a, i) => (a === '--only' && argv[i + 1] ? [argv[i + 1]] : []));
const scopeFlag = argv.indexOf('--scope');
const scope = scopeFlag === -1 ? 'core' : (argv[scopeFlag + 1] ?? 'core');
if (!['core', 'examples', 'all'].includes(scope)) {
    console.error(`ERROR: --scope must be one of core | examples | all (got "${scope}")`);
    process.exit(2);
}

/**
 * Workspaces this check does not own: `@girs/*` are generated type packages,
 * `@gjsify/website` is an Astro site, and `@gjsify/example-*` build only when an
 * example is in the CI closure — the carve-outs the root `build` script spells out.
 *
 * Passed IN to the rule rather than living inside it, because it is the ONE piece of
 * repository knowledge in the check: a consumer's tree has no `@girs/*`, and a rule
 * carrying this list would be repo-shaped while claiming to be portable.
 */
const EXCLUDED_NAME_PATTERNS = [/^@girs\//, /^@gjsify\/website$/, /^@gjsify\/example-/];

/**
 * `--scope examples` INVERTS that carve-out: the `@gjsify/example-*` packages and
 * nothing else.
 *
 * They are excluded from the default sweep because `build:examples` runs only when
 * one is in the affected closure, so the main pass would fail on a tree where they
 * were never built — but "not checked in that pass" became "not checked anywhere",
 * and a published showcase is as broken to a user as a published library:
 * `@gjsify/example-dom-excalibur-jelly-jumper@0.23.0` declared four runtimes and
 * shipped only the GJS bundle. So this scope is a SECOND invocation placed where the
 * examples are known to be built: after `build:examples` in root `npm:publish` (the
 * release path, which cannot skip it) and in the example-gated CI step.
 */
const EXAMPLE_ONLY_PATTERNS = [/^(?!@gjsify\/example-).*$/];

function fail(msg) {
    console.error(inActions ? `::error::${msg}` : `ERROR: ${msg}`);
}

const excludeNamePatterns =
    scope === 'examples'
        ? EXAMPLE_ONLY_PATTERNS
        : scope === 'all'
          ? [/^@girs\//, /^@gjsify\/website$/]
          : EXCLUDED_NAME_PATTERNS;

const ctx = createContext({
    root: repoRoot,
    only,
    allowUnbuilt,
    extra: { packageOutputs: { excludeNamePatterns, includePrivate } },
});

const results = inspectDeclaredOutputs(ctx);
const broken = results.filter((r) => r.missing.length > 0 || r.error);
const totalMissing = broken.reduce((n, r) => n + r.missing.length, 0);

if (asJson) {
    console.log(JSON.stringify({ checked: results.length, broken, totalMissing }, null, 2));
} else {
    console.log(
        `Declared-output check [scope: ${scope}]: ${results.length} workspace package(s)${includePrivate ? '' : ' (non-private)'}`,
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
