#!/usr/bin/env node
/**
 * CI entry: every entry point a workspace DECLARES must be in its TARBALL.
 *
 * The sibling `verify-package-outputs.mjs` asks whether a declared path exists in
 * the REPO after a build, which is blind to what a consumer feels: `lib/` always
 * exists here, so a package can declare `main: "lib/esm/index.js"`, build it, pass
 * that check and still publish a tarball without the file, because `lib/` is a
 * gitignored build output `files` never named (absent `files`, npm falls back to
 * gitignore semantics). `@gjsify/xmlhttprequest@0.23.0` shipped that shape, and so
 * did the packer-glob incident (v0.4.37–0.7.2), where `@gjsify/tsc`'s libs were on
 * disk at pack time and absent from the tarball for a whole release window.
 *
 * Both oracles are IMPORTED, never reimplemented — `declaredPaths()` for what is
 * declared, `collectPackedFiles()` from `gjsify pack` for what is packed (asking
 * `npm pack --dry-run` would be a second packer, which is what the incident above
 * cost). Rationale: docs/build-artifacts.md § Build outputs.
 *
 * IT ONLY FIRES ON THE UNAMBIGUOUS MISMATCH — a declared path PRESENT on disk yet
 * absent from the packed set. A path that does not exist at all is
 * `verify-package-outputs.mjs`'s finding, and claiming it here would red-line every
 * unbuilt dev tree.
 *
 * A SCRIPT AND NOT A PACKER ASSERTION: `gjsify pack` already refuses to pack a
 * `types`/`typings` file it can see but would not ship
 * (`assertTypeDeclarationsShipped`, the #655 guard) — the right place, but only the
 * type fields. Widening it needs `declaredPaths()` from `@gjsify/manifest-
 * conformance`, which is `private: true`, so a published `@gjsify/cli` depending on
 * it would 406 every consumer install until it is npm-bootstrapped
 * (`status/open-todos.md` § Manifest-conformance follow-ups). The superset runs
 * here at repo scope; the packer keeps its narrower guard for consumer trees.
 *
 * Needs a BUILT tree (it reads the CLI's `lib/`), so it is a post-condition placed
 * next to `verify-package-outputs.mjs`.
 *
 * Usage:
 *   node scripts/verify-tarball-outputs.mjs
 *   node scripts/verify-tarball-outputs.mjs --scope examples|all
 *   node scripts/verify-tarball-outputs.mjs --only @gjsify/rolldown-native
 *   node scripts/verify-tarball-outputs.mjs --json
 *   node scripts/verify-tarball-outputs.mjs --root <dir>   # a fixture tree
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { createContext } from '../packages/infra/manifest-conformance/lib/context.mjs';
import { declaredPaths } from '../packages/infra/manifest-conformance/lib/rules/package-outputs.mjs';
import { collectPackedFiles } from '../packages/infra/cli/lib/commands/pack.js';

const argv = process.argv.slice(2);
const args = new Set(argv);
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `--root`, like its sibling's, lets the guard be exercised against fixture trees.
// The two oracles stay repo-resident — a fixture is only a tree to ask about.
const rootFlag = argv.indexOf('--root');
const repoRoot = rootFlag === -1 ? scriptRoot : resolve(argv[rootFlag + 1]);
const inActions = Boolean(process.env.GITHUB_ACTIONS);

const asJson = args.has('--json');
const only = argv.flatMap((a, i) => (a === '--only' && argv[i + 1] ? [argv[i + 1]] : []));
const scopeFlag = argv.indexOf('--scope');
const scope = scopeFlag === -1 ? 'core' : (argv[scopeFlag + 1] ?? 'core');
if (!['core', 'examples', 'all'].includes(scope)) {
    console.error(`ERROR: --scope must be one of core | examples | all (got "${scope}")`);
    process.exit(2);
}

/**
 * The same carve-outs `verify-package-outputs.mjs` spells out: `@girs/*` are
 * generated, the website is an Astro app, and the examples build only when one is in
 * the CI closure. Kept in step with that file — two checks over the same package set
 * must not disagree about which packages those are.
 */
const EXCLUDED_NAME_PATTERNS = [/^@girs\//, /^@gjsify\/website$/, /^@gjsify\/example-/];
const EXAMPLE_ONLY_PATTERNS = [/^(?!@gjsify\/example-).*$/];

const excludeNamePatterns =
    scope === 'examples'
        ? EXAMPLE_ONLY_PATTERNS
        : scope === 'all'
          ? [/^@girs\//, /^@gjsify\/website$/]
          : EXCLUDED_NAME_PATTERNS;

function fail(msg) {
    console.error(inActions ? `::error::${msg}` : `ERROR: ${msg}`);
}

/**
 * Is `value` (a declared, workspace-relative path) satisfied by the packed set?
 *
 * A concrete path must be packed verbatim. A subpath PATTERN (`./assets/*`) has no
 * single target, so it is held to the same promise `verify-package-outputs.mjs`
 * uses: at least one packed file under its static prefix.
 */
function isSatisfied(value, packedSet, packedList) {
    const rel = value.replace(/^\.\//, '');
    if (!rel.includes('*')) return packedSet.has(rel);
    const prefix = rel.slice(0, rel.indexOf('*'));
    return packedList.some((p) => p.startsWith(prefix));
}

/** Does the declared path exist on disk — as a file, or (for a pattern) as a non-empty dir? */
function existsOnDisk(pkgDir, value) {
    const rel = value.replace(/^\.\//, '');
    if (!rel.includes('*')) {
        const abs = join(pkgDir, rel);
        return existsSync(abs) && statSync(abs).isFile();
    }
    const prefix = rel.slice(0, rel.indexOf('*'));
    const dir = join(pkgDir, prefix.endsWith('/') ? prefix : dirname(prefix));
    try {
        return statSync(dir).isDirectory() && readdirSync(dir).length > 0;
    } catch {
        return false;
    }
}

const ctx = createContext({
    root: repoRoot,
    only,
    extra: { packageOutputs: { excludeNamePatterns, includePrivate: false } },
});

const results = [];
// Same gate order as `inspectDeclaredOutputs`, so `--only` reaches an excluded
// package for local inspection exactly the way it does there.
for (const record of ctx.packages) {
    if (ctx.only.length === 0) {
        if (excludeNamePatterns.some((re) => re.test(record.name))) continue;
        if (record.private) continue;
    }
    const { name, rel: dir, dir: pkgDir, manifest } = record;

    let packedList;
    try {
        packedList = collectPackedFiles(pkgDir, manifest);
    } catch (err) {
        results.push({ name, dir, error: String(err?.message ?? err), unshipped: [] });
        continue;
    }
    const packedSet = new Set(packedList);

    const unshipped = [];
    for (const { field, value } of declaredPaths(manifest)) {
        if (isSatisfied(value, packedSet, packedList)) continue;
        // Present-but-unpacked is THIS check's finding; absent-on-disk is
        // verify-package-outputs.mjs's.
        if (!existsOnDisk(pkgDir, value)) continue;
        unshipped.push({ field, value });
    }
    results.push({ name, dir, files: manifest.files ?? null, packedCount: packedList.length, unshipped });
}

const broken = results.filter((r) => r.unshipped.length > 0 || r.error);
const totalUnshipped = broken.reduce((n, r) => n + r.unshipped.length, 0);

if (asJson) {
    console.log(JSON.stringify({ checked: results.length, broken, totalUnshipped }, null, 2));
} else {
    console.log(`Declared-in-tarball check [scope: ${scope}]: ${results.length} workspace package(s) (non-private)`);
    for (const r of broken) {
        if (r.error) {
            fail(`${r.name} (${r.dir}): could not compute the packed file list — ${r.error}`);
            continue;
        }
        fail(
            `${r.name} (${r.dir}) declares ${r.unshipped.length} entry point(s) that exist on disk but are NOT in its tarball:`,
        );
        for (const u of r.unshipped) console.error(`    ${u.field} → ${u.value}`);
        console.error(
            `    "files": ${r.files === null ? '(absent — npm falls back to gitignore semantics)' : JSON.stringify(r.files)}`,
        );
    }
}

if (totalUnshipped === 0 && broken.length === 0) {
    if (!asJson) console.log('Every declared entry point is in its tarball.');
    process.exit(0);
}

if (!asJson) {
    fail(
        `${totalUnshipped} declared entry point(s) across ${broken.length} package(s) exist in the repo but would not ` +
            'be published. The file is built, so nothing in this tree is broken — only the tarball is, and only for ' +
            'consumers. Name the built output in package.json "files" (a plain directory entry such as "lib" is ' +
            'safest — see the packer-glob lesson in docs/bundled-toolchains.md), then re-run. Inspect one with: ' +
            '`cd <pkg> && gjsify pack && tar tzf *.tgz`.',
    );
}
process.exit(1);
