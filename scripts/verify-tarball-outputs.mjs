#!/usr/bin/env node
/**
 * CI entry: every entry point a workspace DECLARES must be in its TARBALL.
 *
 * The sibling `verify-package-outputs.mjs` asks whether a declared path exists
 * in the REPO after a build. That question is structurally blind to the one a
 * consumer actually feels, because in this tree `lib/` always exists: a package
 * can declare `main: "lib/esm/index.js"`, build it, pass that check — and still
 * publish a tarball without the file, because `lib/` is a gitignored build
 * output and `files` never named it (with no `files` field npm falls back to
 * gitignore semantics, so the build output is excluded). The declaration is then
 * a dangling pointer for everyone who installs it, and nothing in the repo can
 * tell.
 *
 * That is not hypothetical. It is the shape `@gjsify/xmlhttprequest@0.23.0`
 * shipped (declared `lib/types/*.d.ts` its tsconfig never produced), and it is
 * the shape of the packer-glob incident (v0.4.37–0.7.2): `@gjsify/tsc`'s libs
 * were on disk at pack time and absent from the tarball, for a whole release
 * window, because `gjsify publish` did not expand `files` globs. The lesson
 * recorded from that was an instruction to a HUMAN — "after adding committed
 * data files, verify they are in the tarball (`gjsify pack` + `tar tzf`), never
 * assume a `files` glob ships them". This script is that instruction, executed.
 *
 * TWO ORACLES, EACH IMPORTED RATHER THAN REIMPLEMENTED — the whole point:
 *
 *   - WHAT IS DECLARED: `declaredPaths()` from the portable `package-outputs`
 *     rule, the same collector `verify-package-outputs.mjs` uses. Both checks
 *     therefore agree by construction about what a manifest promises; only the
 *     question differs (on disk vs in the tarball).
 *   - WHAT IS PACKED: `collectPackedFiles()` from `gjsify pack` itself. Asking
 *     `npm pack --dry-run` instead would be a SECOND packer, and the incident
 *     above is exactly what that costs — npm expanded the glob, gjsify did not,
 *     so an npm-based check would have been green while the published tarball
 *     was broken. gjsify's packer produces these tarballs, so gjsify's packer
 *     is the only honest answer.
 *
 * IT ONLY FIRES ON THE UNAMBIGUOUS MISMATCH — a declared path that is PRESENT
 * on disk yet absent from the packed set. A declared path that does not exist
 * at all is `verify-package-outputs.mjs`'s finding, and treating it as one here
 * would make every unbuilt dev tree red for the wrong reason.
 *
 * WHY A SCRIPT AND NOT A PACKER ASSERTION: `gjsify pack` already refuses to
 * pack a `types`/`typings` file it can see but would not ship
 * (`assertTypeDeclarationsShipped`, the #655 guard) — the right place, but it
 * covers only the type fields. Widening it to every declared entry point wants
 * `declaredPaths()`, which lives in `@gjsify/manifest-conformance`, and that
 * package is `private: true`: making the published `@gjsify/cli` depend on it
 * would 406 every consumer install until it is npm-bootstrapped (tracked under
 * "Manifest-conformance follow-ups"). So the superset runs here, at repo scope,
 * where importing both oracles costs nothing — and the packer keeps its own
 * narrower guard for consumer trees. See `status/open-todos.md`.
 *
 * Needs a BUILT tree (it reads the CLI's `lib/`), so it is a post-condition,
 * placed next to `verify-package-outputs.mjs`.
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
// `--root`, like its sibling's, exists so the guard can be exercised against
// fixture trees instead of only against the repo it lives in. The two oracles
// stay repo-resident either way — a fixture is only a tree to ask about.
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
 * The same carve-outs `verify-package-outputs.mjs` spells out, and for the same
 * reason: `@girs/*` are generated, the website is an Astro app, and the
 * examples build only when one is in the CI closure. Kept in step with that
 * file deliberately — two checks over the same package set must not disagree
 * about which packages they are.
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
 * A concrete path must be packed verbatim. A subpath PATTERN (`./assets/*`) has
 * no single target, so the promise it can be held to is the same one
 * `verify-package-outputs.mjs` holds it to — that the directory it globs into
 * ships at all, i.e. at least one packed file lives under its static prefix.
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
        // Present-but-unpacked is THIS check's finding. Absent-on-disk is
        // verify-package-outputs.mjs's, and claiming it here would red-line
        // every unbuilt tree for a reason this script cannot fix.
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
            'safest — see the packer-glob lesson in AGENTS.md), then re-run. Inspect one with: ' +
            '`cd <pkg> && gjsify pack && tar tzf *.tgz`.',
    );
}
process.exit(1);
