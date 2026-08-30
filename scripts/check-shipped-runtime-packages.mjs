#!/usr/bin/env node
// Every runtime package `gjsify ship` resolves BY NAME must exist on npm — or say it does not.
//
// THE INCIDENT — measured, not hypothetical
//
// M2b (#1418) and M3 (#1420) shipped a macOS `.app` and a Windows program directory
// that carry their own Node interpreter, staged from `@gjsify/node-runtime-<target>`.
// `website/src/content/docs/ship/index.mdx` handed a third-party author a
// copy-pasteable `devDependencies` block naming all three. Measured on 2026-08-30,
// with `@gjsify/cli@0.44.0` as the control:
//
//   @gjsify/cli                        0.44.0
//   @gjsify/gtk-runtime-darwin-arm64   0.44.0
//   @gjsify/gtk-runtime-darwin-x64     0.44.0
//   @gjsify/gtk-runtime-win32-x64      0.44.0
//   @gjsify/node-runtime-darwin-arm64  E404
//   @gjsify/node-runtime-darwin-x64    E404
//   @gjsify/node-runtime-win32-x64     E404
//
// The CI legs that stage an interpreter were green throughout, because a runner that
// has just run `fetch-node-runtime.mjs` and symlinked the result into `node_modules`
// resolves the package from the tree and never asks the registry (`node-gi.yml`'s two
// assemble legs do exactly that). So the pipeline was proven and unusable at once, and
// the only reader who would have found out was the outside author the docs are for.
//
// WHY NOTHING ELSE REPORTS IT
//
// `check-website-package-names.mjs` asks whether a quoted `@gjsify/*` name is a real
// package OF THIS WORKSPACE — these three are, which is why it passes. The registry is
// a different question and nothing was asking it.
//
// `verify-published-closure.mjs` cannot see them either, and says so: these packages
// carry NO `optionalDependencies` edge (#910, reverted in #920 — whoever SHIPS an app
// declares the runtime, never the library that uses it), so there is no edge to walk.
// Its package set comes from manifest-conformance's `createContext`, which enumerates
// the root `workspaces` — 317 packages, none of them these six, because
// `packages/node-runtime/**` and `packages/node-gi/gtk-runtime-*` are deliberately NOT
// workspace members (that is what keeps the ubuntu `npm:publish` sweep from overwriting
// a real bundle with an empty shell, the 0.19.0 incident). Both exclusions are correct.
// The consequence is that the ONLY guard on this family was "their own publish jobs" —
// and a publish job reports at release time, on the release, which is the latest
// possible moment and the most expensive one.
//
// WHAT IT CHECKS
//
//  1. ENUMERATION, from the tree, with a control. Every `@gjsify/*` package under
//     `packages/node-runtime/*` and `packages/node-gi/gtk-runtime-*`. Both families
//     must be non-empty: an enumeration that quietly stops matching is how a guard
//     passes on an empty set, so "found nothing" is a failure here, never a pass.
//  2. A PUBLISH LEG. Each package directory must appear as the path argument of a
//     `gjsify publish` invocation in `release.yml`. Adding a seventh package with no
//     publish leg is otherwise invisible until someone notices it never shipped.
//  3. VERSION BUMPER COVERAGE. Each manifest must be matched by a `@release-it/bumper`
//     `out` glob in `.release-it.json`, or it silently keeps the previous version while
//     the rest of the train moves — a package pinned at `^<new>` that resolves to
//     nothing.
//  4. THE REGISTRY. Each name must have a packument. Absence is re-queried a few times
//     before it becomes a verdict (npm's CDN can serve a document minted before a
//     publish), and a probe that ERRORS is a failure naming the target, never a skip.
//  5. THE DECLARED GAP. A name that is absent must be listed in `PENDING_BOOTSTRAP`
//     below, and every file that declares a dependency on it must disclose that it is
//     not published yet. The ledger is bidirectional on purpose: a declared name that
//     IS published is also a failure, so the list empties itself the moment the owner
//     bootstraps and cannot rot into a permanent exemption.
//
// The disclosure rule is the half that makes the docs true. `docs/ship-formats.md`
// already carried the warning; `website/src/content/docs/ship/index.mdx`, the page an
// outside author actually copies from, did not. One corrected statement and one
// uncorrected copy of it is the shape this rule exists to close.
//
//   node scripts/check-shipped-runtime-packages.mjs
//
// It reads manifests, two workflow files and the registry with plain Node — no install
// and no build, so the committed CLI bundle cannot stale it.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors `@gjsify/npm-registry`'s DEFAULT_REGISTRY. Duplicated for the reason
// verify-published-closure.mjs duplicates it: that constant lives behind a built
// `lib/`, and this script must run on a bare checkout.
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

const flag = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
const registry = String(flag('--registry', DEFAULT_REGISTRY)).replace(/\/+$/, '');
const attempts = Math.max(1, Number(flag('--attempts', '3')) || 1);
const retryDelayMs = Math.max(0, Number(flag('--retry-delay-ms', '5000')) || 0);

// ---------------------------------------------------------------------------
// The declared gap. A name here is KNOWN not to be on npm yet; every entry is a
// queued maintainer action, not an exemption.
//
// npm Trusted Publishing (OIDC) requires the package to ALREADY EXIST, so the first
// publish of a new name is a manual maintainer action and cannot be automated —
// `docs/publishing.md` § *New `@gjsify/*` package* is the procedure. Until it is done,
// the name must not appear in a dependency block a reader copies without the block
// saying so.
//
// REMOVING an entry is the last step of that bootstrap, and rule 5 forces it: once the
// packument exists, a stale entry here FAILS this check.
// ---------------------------------------------------------------------------
const PENDING_BOOTSTRAP = new Map([
    // Empty, and that is the point rather than an oversight. Every by-name ship
    // runtime package went live at 0.44.0 on 2026-08-30, and a name published while
    // still listed here FAILS the check -- so this list empties itself on bootstrap
    // instead of rotting into a permanent exemption nobody rereads.
]);

// A file that declares a dependency on a pending name must contain one of these.
// Prose, not a machine marker: the sentence a reader needs IS the disclosure, and a
// magic comment would let a file satisfy the check while still reading as a promise.
const DISCLOSURE = /not (?:yet )?(?:published|on npm)|404s? on npm/i;

const problems = [];
const fail = (msg) => problems.push(msg);

// ---------------------------------------------------------------------------
// 1. Enumerate, from the tree.
// ---------------------------------------------------------------------------

/** Directories under `dir` whose name passes `match` and that hold a package.json. */
function packagesUnder(dir, match) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return [];
    const found = [];
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (!entry.isDirectory() || !match(entry.name)) continue;
        const manifestPath = join(abs, entry.name, 'package.json');
        if (!existsSync(manifestPath)) continue;
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        } catch (err) {
            fail(`${dir}/${entry.name}/package.json does not parse: ${err.message}`);
            continue;
        }
        if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@gjsify/')) continue;
        found.push({
            name: manifest.name,
            version: manifest.version,
            dir: `${dir}/${entry.name}`,
            manifestPath: `${dir}/${entry.name}/package.json`,
        });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
}

// The two families the ship pipeline resolves by name: the interpreter
// (`utils/ship/node-runtime.ts`) and the relocated GTK closure
// (`resolveGtkRuntime()` in `utils/ship/app-runtime.ts`).
const families = [
    { label: 'node-runtime', packages: packagesUnder('packages/node-runtime', (n) => n.startsWith('node-runtime-')) },
    { label: 'gtk-runtime', packages: packagesUnder('packages/node-gi', (n) => n.startsWith('gtk-runtime-')) },
];

// The control. A refactor that moves either family elsewhere must not leave this check
// passing over nothing — an empty selection is a typo, never an intent.
for (const family of families) {
    if (family.packages.length === 0) {
        fail(
            `enumeration found NO ${family.label} package. This check cannot pass on an empty set — ` +
                'the family moved, or the directory convention changed. Point the enumeration at it.',
        );
    }
}

const all = families.flatMap((f) => f.packages);
if (problems.length > 0) report();

// ---------------------------------------------------------------------------
// 2. A publish leg in release.yml.
// ---------------------------------------------------------------------------

const releaseYml = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8').split('\n');

// The shape in every publish job: `… publish \` (bash) or `… publish `` (PowerShell),
// with the package directory alone on the next line. Matrix legs interpolate
// `${{ matrix.<key> }}`, so the recorded argument is a pattern, not a literal.
const publishArguments = [];
releaseYml.forEach((line, i) => {
    if (!/\bpublish\s*[\\`]\s*$/.test(line)) return;
    const next = (releaseYml[i + 1] ?? '')
        .trim()
        .replace(/[\\`]\s*$/, '')
        .trim();
    if (next.startsWith('packages/')) publishArguments.push({ pattern: next, line: i + 2 });
});

if (publishArguments.length === 0) {
    fail(
        'found NO `gjsify publish <dir>` invocation in .github/workflows/release.yml. ' +
            'The publish-leg rule would pass vacuously — the workflow shape changed.',
    );
}

// Matrix values, collected from the workflow's own `matrix:` blocks in both shapes it
// uses: inline `target: [darwin-arm64, …]` and list-of-mappings `- arch: arm64`.
//
// The placeholder must expand to THE VALUES THAT EXIST, not to a wildcard. A wildcard
// made `packages/node-runtime/node-runtime-${{ matrix.target }}` match a hypothetical
// `node-runtime-linux-arm64` that no leg would ever publish — the rule reported a
// publish leg that does not exist, which is the failure shape it was written to catch.
const matrixValues = new Map();
for (const line of releaseYml) {
    let m = /^\s*([A-Za-z_][\w-]*):\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) {
        const values = m[2].split(',').map((v) => v.trim().replace(/^['"]|['"]$/g, ''));
        for (const v of values) if (v) (matrixValues.get(m[1]) ?? matrixValues.set(m[1], new Set()).get(m[1])).add(v);
        continue;
    }
    m = /^\s*-\s+([A-Za-z_][\w-]*):\s*(['"]?)([\w.-]+)\2\s*$/.exec(line);
    if (m) (matrixValues.get(m[1]) ?? matrixValues.set(m[1], new Set()).get(m[1])).add(m[3]);
}

/** `packages/node-runtime/node-runtime-${{ matrix.target }}` → a regex over real dirs. */
const argumentMatcher = (pattern) => {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Put each `${{ matrix.<key> }}` back as an alternation of that key's real values.
    // A placeholder naming a key with no collected values cannot be decided, so it
    // matches nothing — a rule that cannot decide must not report a pass.
    const body = escaped.replace(/\\\$\\\{\\\{\s*matrix\\?\.([\w-]+)\s*\\\}\\\}/g, (_all, key) => {
        const values = [...(matrixValues.get(key) ?? [])];
        return values.length === 0
            ? '(?!)'
            : `(?:${values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
    });
    // Any OTHER `${{ … }}` (a step output, an env) stays undecidable for the same reason.
    return new RegExp(`^${body.replace(/\\\$\\\{\\\{[^}]*\\\}\\\}/g, '(?!)')}$`);
};

const matchers = publishArguments.map((a) => argumentMatcher(a.pattern));
for (const pkg of all) {
    if (!matchers.some((m) => m.test(pkg.dir))) {
        fail(
            `${pkg.name} has no publish leg — no \`gjsify publish\` in release.yml names ${pkg.dir}. ` +
                'A package the ship pipeline resolves by name and that nothing publishes never reaches a consumer.',
        );
    }
}

// ---------------------------------------------------------------------------
// 3. Version bumper coverage.
// ---------------------------------------------------------------------------

const releaseIt = JSON.parse(readFileSync(join(ROOT, '.release-it.json'), 'utf8'));
const bumperGlobs = releaseIt?.plugins?.['@release-it/bumper']?.out ?? [];
if (bumperGlobs.length === 0) {
    fail('.release-it.json declares no @release-it/bumper `out` globs — the coverage rule would pass vacuously.');
}

/** Only the `*` shape these globs use; `*` matches within one path segment. */
const globMatcher = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
const bumperMatchers = bumperGlobs.map(globMatcher);

for (const pkg of all) {
    if (!bumperMatchers.some((m) => m.test(pkg.manifestPath))) {
        fail(
            `${pkg.name} is not matched by any @release-it/bumper \`out\` glob (${pkg.manifestPath}). ` +
                'It would keep its old version while the rest of the train moves.',
        );
    }
}

// ---------------------------------------------------------------------------
// 4. The registry.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** name → true (packument exists) | false (404) | Error (undecidable). */
const state = new Map();

async function probe(name) {
    const url = `${registry}/${name.replace('/', '%2f')}`;
    try {
        const res = await fetch(url, {
            headers: {
                // Abbreviated packument: version keys only. `no-cache` so a CDN edge
                // cannot answer with a document minted before a publish.
                accept: 'application/vnd.npm.install-v1+json',
                'cache-control': 'no-cache',
            },
            signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 404) return false;
        if (!res.ok) return new Error(`${res.status} ${res.statusText}`);
        const doc = await res.json();
        return Boolean(doc?.versions && Object.keys(doc.versions).length > 0);
    } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
    }
}

for (let round = 1; round <= attempts; round++) {
    const todo = all.map((p) => p.name).filter((n) => state.get(n) !== true);
    if (todo.length === 0) break;
    if (round > 1) {
        process.stderr.write(
            `check-shipped-runtime-packages: round ${round}/${attempts} — re-querying ${todo.length} ` +
                `unresolved name(s) in ${retryDelayMs}ms (registry propagation).\n`,
        );
        await sleep(retryDelayMs);
    }
    await Promise.all(todo.map(async (n) => state.set(n, await probe(n))));
}

// ---------------------------------------------------------------------------
// 5. The declared gap, and the disclosure it obliges.
// ---------------------------------------------------------------------------

// Files that could hand a reader a dependency line. Tracked docs and the website only —
// the tree's own manifests are not what an outside author copies.
const DOC_ROOTS = ['docs', 'website/src/content/docs'];
const DOC_FILE = /\.(md|mdx|markdown|json|jsonc)$/;

function walk(dir, out = []) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return out;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel, out);
        else if (DOC_FILE.test(entry.name)) out.push(rel);
    }
    return out;
}
const docFiles = DOC_ROOTS.flatMap((d) => walk(d));

/** Files declaring `"<name>": "<range>"` — a line a reader pastes into package.json. */
function dependencySites(name) {
    const line = new RegExp(`["']${name.replace('/', '\\/')}["']\\s*:\\s*["'][^"']+["']`);
    const sites = [];
    for (const file of docFiles) {
        let src;
        try {
            src = readFileSync(join(ROOT, file), 'utf8');
        } catch {
            continue;
        }
        if (!line.test(src)) continue;
        sites.push({ file, disclosed: DISCLOSURE.test(src) });
    }
    return sites;
}

let dependencySitesSeen = 0;

for (const pkg of all) {
    const live = state.get(pkg.name);
    const declared = PENDING_BOOTSTRAP.has(pkg.name);

    if (live instanceof Error) {
        fail(
            `${pkg.name}: the registry probe could not decide — ${live.message}. Undecidable is a failure, not a skip.`,
        );
        continue;
    }

    if (live === true && declared) {
        fail(
            `${pkg.name} IS published, but PENDING_BOOTSTRAP still lists it. ` +
                'The bootstrap is done — delete the entry and the disclosure it obliged. ' +
                'A stale entry turns a finished action into a permanent exemption.',
        );
        continue;
    }

    if (live === false && !declared) {
        fail(
            `${pkg.name} does not exist on npm (${registry} answered 404) and nothing declares that. ` +
                'The ship pipeline resolves it BY NAME, so an outside author following our docs hits E404. ' +
                'Either bootstrap it (docs/publishing.md § New @gjsify/* package) or add it to ' +
                'PENDING_BOOTSTRAP and disclose it wherever the docs recommend depending on it.',
        );
        continue;
    }

    if (live === false && declared) {
        const sites = dependencySites(pkg.name);
        dependencySitesSeen += sites.length;
        for (const site of sites.filter((s) => !s.disclosed)) {
            fail(
                `${site.file} tells a reader to depend on ${pkg.name}, which is not on npm, ` +
                    'and the file never says so. Add the disclosure, or drop the dependency line — ' +
                    'a copy-pasteable block that 404s is worse than no block.',
            );
        }
    }
}

// A declared gap with no dependency site anywhere means the site pattern stopped
// matching, and the disclosure rule then checks nothing. Only assert it while something
// IS pending: once the list empties, having no sites is the correct state.
if (PENDING_BOOTSTRAP.size > 0 && dependencySitesSeen === 0) {
    fail(
        'no documentation file declares a dependency on any PENDING_BOOTSTRAP name. ' +
            'Either the docs stopped recommending them (then empty PENDING_BOOTSTRAP) or the ' +
            'dependency-line pattern no longer matches — the disclosure rule is checking nothing.',
    );
}

// Names listed as pending that are not packages of this repo at all.
for (const name of PENDING_BOOTSTRAP.keys()) {
    if (!all.some((p) => p.name === name)) {
        fail(`PENDING_BOOTSTRAP lists ${name}, which this repository does not contain. Remove it.`);
    }
}

report();

function report() {
    if (problems.length === 0) {
        const pending = [...PENDING_BOOTSTRAP.keys()];
        process.stdout.write(
            `check-shipped-runtime-packages: ${all.length} by-name ship runtime package(s) checked — ` +
                `${all.length - pending.length} live on npm, ${pending.length} declared pending bootstrap.\n`,
        );
        for (const name of pending) {
            process.stdout.write(`  pending: ${name} — ${PENDING_BOOTSTRAP.get(name)}\n`);
        }
        process.exit(0);
    }
    process.stderr.write(
        `check-shipped-runtime-packages: ${problems.length} problem(s).\n` +
            '  These packages are resolved BY NAME at ship time and documented as consumer\n' +
            '  dependencies, so a name that does not exist on npm is an E404 for every outside\n' +
            '  author — and every CI leg here resolves them from the tree, so nothing else looks.\n\n',
    );
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    process.exit(1);
}
