// E2E for `--scope` on `scripts/audit-runtimes.mjs` — the two shipped populations and
// the anti-vacuity property that closed #1898.
//
// THE DEFECT THIS EXISTS FOR. `node scripts/audit-runtimes.mjs --check --strict` is what
// the release cut runs as its `after:bump` audit. Measured on `main`, it exited 0 on a
// fresh checkout and 1 after `gjsify run build:examples`, for no reason other than which
// of those trees it ran on: `@gjsify/example-*` is excluded from `gjsify run build`, so a
// rule whose subject is a built bundle had no bundle to read and the run reported success
// anyway. The showcases are PUBLISHED, so the population nobody audited was the population
// users install.
//
// A scope therefore does two things and the second is the point: it names the population
// (`ship` = what a release publishes, `examples` = what the showcases ship), and it makes
// "this package's shipped root entry is not on disk" a FAILURE. Without the second half a
// scope is the same vacuous sweep over fewer packages, which is worse than no scope: it
// reads like coverage.
//
// WHY TWO LEVELS. The RULE cases build a context over a synthetic tree and call
// `auditShippedGiDeps` directly, because the real tree has no headless package whose
// SHIPPED output hard-depends on a typelib — that is the state this rule keeps it out of,
// so the failing direction is unreachable there and only a fixture can reach it. The CLI
// cases then assert that `--scope` actually reaches the rule and selects the population
// it claims to, on the SPECIFIC finding rather than on the exit code: a whole-repo
// `--root` run also exercises repo-knowledge ledgers (`unchecked-fields`,
// `status/stylesheet-font-families.json`) that describe THIS repository and have nothing
// to say about a fixture, and a test that failed on those would be testing the fixture.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/audit-strict-scopes/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const AUDIT = join(MONOREPO_ROOT, 'scripts', 'audit-runtimes.mjs');
const MC = join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib');
const RULE = join(MC, 'rules', 'shipped-gi-deps.mjs');

const { auditShippedGiDeps, parseGiSpecifier, scanBundleGiNamespaces, walkShippedGraph } = await import(
    `file://${RULE}`
);
const { createContext } = await import(`file://${join(MC, 'context.mjs')}`);
const { auditStylesheetFontFamilies } = await import(
    `file://${join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'rules', 'stylesheet-font-families.mjs')}`
);
const { excludePatternsFor, inScope, SCOPES } = await import(
    `file://${join(MONOREPO_ROOT, 'scripts', 'manifest-conformance', 'ship-closure.mjs')}`
);

/** A planted hard `gi://Gtk` binding, in the shape a bundler synthesises. */
const PLANTED = 'import Gtk from "gi://Gtk?version=4.0";\nexport const plantedHardDep = Gtk;\n';
const CLEAN = 'export const ok = 1;\n';

let tmp;

/**
 * A workspace root holding one package per `[name, opts]`, each shipping a BUILT
 * `lib/esm/index.js` — the artifact the rule reads.
 *
 * No fixture has a `src/`. The promise under test is about the emitted file, and a fixture
 * with sources would invite a reader to believe the source-graph half is what is under
 * test; `headless`'s own rule already covers that and has its own cases.
 */
function fixture(packages) {
    const dir = join(tmp, `root-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(
        join(dir, 'package.json'),
        `${JSON.stringify({ name: 'fixture-root', private: true, version: '0.0.0', workspaces: ['packages/*'] }, null, 2)}\n`,
    );
    for (const [name, opts = {}] of packages) {
        // The directory is the BARE name and the package NAME is scoped, so a scope keyed
        // on the directory rather than the name would not select it — the fixtures fail a
        // wrong implementation instead of passing it by accident.
        const dest = join(dir, 'packages', name.replace(/^@gjsify\//, ''));
        mkdirSync(join(dest, 'lib', 'esm'), { recursive: true });
        writeFileSync(join(dest, 'lib', 'esm', 'index.js'), opts.bundle ?? CLEAN);
        const manifest = {
            name,
            version: '0.0.0',
            type: 'module',
            main: 'lib/esm/index.js',
            exports: { '.': './lib/esm/index.js' },
            files: ['lib'],
            license: 'MIT',
            gjsify: { tier: 1 },
        };
        if (opts.headless !== undefined) manifest.gjsify.headless = opts.headless;
        writeFileSync(join(dest, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return dir;
}

/** The context a scoped run builds, so the cases exercise the real option wiring. */
function scopedContext(dir, scope, { allowUnbuilt = false } = {}) {
    return createContext({
        root: dir,
        allowUnbuilt,
        extra: { shippedAudit: scope !== '', shippedScope: excludePatternsFor(scope) },
    });
}

/** Run the CLI. `cwd` is the fixture so nothing resolves against the real repository. */
function cli(dir, extraArgs = []) {
    return spawnSync(process.execPath, [AUDIT, '--check', '--strict', `--root=${dir}`, ...extraArgs], {
        encoding: 'utf8',
        cwd: dir,
    });
}

before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gjsify-audit-scopes-'));
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
});

describe('strict fails on a planted hard GI dependency, in BOTH scopes', () => {
    it('--scope=ship: a headless package whose SHIPPED root hard-depends on Gtk', async () => {
        // The source graph here is empty — there is no `src/` in the fixture — so the
        // source-graph half of the promise cannot see this binding. That IS the class: a GI
        // binding the BUNDLER synthesises (`--globals auto`, a bare side-effect
        // `import "gi://X"` inside a dependency, an alias substitution) reaches no source
        // file of the package, so only the emitted artifact can.
        const dir = fixture([['@gjsify/lib-pkg', { headless: true, bundle: PLANTED }]]);
        const result = await auditShippedGiDeps(scopedContext(dir, 'ship'));
        assert.equal(result.failures.length, 1, `expected one finding, got: ${result.failures.join(' | ')}`);
        assert.match(result.failures[0], /shipped-headless-violated/);
        assert.match(result.failures[0], /gi:\/\/Gtk/);
        assert.match(result.failures[0], /gjsify\.headless=true/);
        // The message must be pasteable: package-relative, not host-absolute.
        assert.match(result.failures[0], /lib\/esm\/index\.js/);
        assert.doesNotMatch(result.failures[0], /\/home\/|\/tmp\//);
    });

    it('--scope=examples: the same defect through the other door', async () => {
        // The SAME finding, selected by the OTHER population. One rule, two scopes, and a
        // scope wired to the wrong patterns would pass here — which is why this is a
        // separate case rather than one case with the flag swapped at the assertion.
        const dir = fixture([['@gjsify/example-pkg', { headless: true, bundle: PLANTED }]]);
        const result = await auditShippedGiDeps(scopedContext(dir, 'examples'));
        assert.equal(result.failures.length, 1, `expected one finding, got: ${result.failures.join(' | ')}`);
        assert.match(result.failures[0], /shipped-headless-violated/);
    });

    it('passes both scopes on the same package with a clean shipped root', async () => {
        // The control beside each case that must fire. A rule that fails on everything is
        // as useless as one that fails on nothing, and only the pair says which this is.
        const dir = fixture([['@gjsify/clean-pkg', { headless: true }]]);
        for (const scope of ['ship', 'examples']) {
            const result = await auditShippedGiDeps(scopedContext(dir, scope));
            assert.deepEqual(result.failures, [], `--scope=${scope} failed on a clean tree`);
        }
    });

    it('holds a headless LIST, not just the closed promise', async () => {
        // `canvas2d-core` declares the scoped form (`["Gdk","Gtk",…]`): the root must
        // reach none of THOSE, and is free to reach anything else. A rule that read the
        // list as "no typelib at all" would make the scoped spelling unusable, and one that
        // ignored it would let Gdk through.
        const dir = fixture([
            [
                '@gjsify/forbidden',
                {
                    headless: ['Gdk', 'Gtk'],
                    bundle: 'import Gdk from "gi://Gdk?version=4.0";\nexport const a = Gdk;\n',
                },
            ],
            [
                '@gjsify/allowed',
                {
                    headless: ['Gdk', 'Gtk'],
                    bundle: 'import Gio from "gi://Gio?version=2.0";\nexport const b = Gio;\n',
                },
            ],
        ]);
        const result = await auditShippedGiDeps(scopedContext(dir, 'ship'));
        assert.equal(result.failures.length, 1, `expected exactly the Gdk finding: ${result.failures.join(' | ')}`);
        assert.match(result.failures[0], /@gjsify\/forbidden/);
        assert.match(result.failures[0], /gi:\/\/Gdk/);
    });

    it('rejects a malformed headless declaration rather than reading it as "nothing forbidden"', async () => {
        // An unreadable declaration must fail loudly. Degrading to "no namespace is
        // forbidden" would pass on any bundle, which is the failure direction that turns a
        // gate into decoration.
        const dir = fixture([['@gjsify/bad-decl', { headless: [], bundle: PLANTED }]]);
        const result = await auditShippedGiDeps(scopedContext(dir, 'ship'));
        assert.ok(
            result.failures.some((f) => /shipped-headless-declaration-invalid/.test(f)),
            `expected the invalid declaration to fail: ${result.failures.join(' | ')}`,
        );
    });
});

describe('a scope makes the UNREAD half fatal, which is the vacuity itself', () => {
    it('fails a scoped run whose package has no shipped root entry on disk', async () => {
        // The vacuous case, stated directly. A scope named this population; answering
        // "success" for a package it never opened is the defect #1898 measured.
        const dir = fixture([['@gjsify/absent', { headless: true }]]);
        rmSync(join(dir, 'packages', 'absent', 'lib'), { recursive: true, force: true });
        const result = await auditShippedGiDeps(scopedContext(dir, 'ship'));
        assert.ok(
            result.failures.some((f) => /not on disk/.test(f)),
            `expected the unbuilt package to fail: ${result.failures.join(' | ')}`,
        );
        assert.equal(result.unbuilt.length, 1);
    });

    it('--allow-unbuilt records the same gap without failing on it', async () => {
        // The seam that lets a job with no build run a scope without being a gate that can
        // never pass. The package is still NAMED — an allowance that hides the population
        // it excuses is the vacuity wearing a flag.
        const dir = fixture([['@gjsify/absent', { headless: true }]]);
        rmSync(join(dir, 'packages', 'absent', 'lib'), { recursive: true, force: true });
        const result = await auditShippedGiDeps(scopedContext(dir, 'ship', { allowUnbuilt: true }));
        assert.deepEqual(result.failures, []);
        assert.equal(result.unbuilt.length, 1, 'the excused package is still reported');
    });

    it('leaves the DEFAULT sweep non-fatal on the same unbuilt package', async () => {
        // The default must not move. `audit-runtimes.yml` installs nothing and builds
        // nothing on purpose, and a required check that can never pass is one people route
        // around — so the unbuilt state stays a NOTE there and only a scope makes it fatal.
        const dir = fixture([['@gjsify/absent', { headless: true }]]);
        rmSync(join(dir, 'packages', 'absent', 'lib'), { recursive: true, force: true });
        const result = await auditShippedGiDeps(scopedContext(dir, ''));
        assert.deepEqual(result.failures, []);
        assert.equal(result.unbuilt.length, 1);
    });

    it('does not excuse a package whose shipped root IS on disk', async () => {
        // Self-retiring, or the ledger is where omissions go to die. An entry describing a
        // gap that closed FAILS, so a package that starts building cannot leave a standing
        // excuse behind.
        const dir = fixture([['@gjsify/lib-pkg', { headless: true }]]);
        const ctx = scopedContext(dir, 'ship');
        ctx.options.shippedUnbuiltAllowlist = { '@gjsify/lib-pkg': { reason: 'stale', issue: '#1' } };
        const result = await auditShippedGiDeps(ctx);
        assert.ok(
            result.failures.some((f) => /allowlist/.test(f) && /no longer needed/.test(f)),
            `a stale excuse must fail: ${result.failures.join(' | ')}`,
        );
    });

    it('honours a standing excuse for a package it cannot build', async () => {
        const dir = fixture([['@gjsify/lib-pkg', { headless: true }]]);
        rmSync(join(dir, 'packages', 'lib-pkg', 'lib'), { recursive: true, force: true });
        const ctx = scopedContext(dir, 'ship');
        ctx.options.shippedUnbuiltAllowlist = { '@gjsify/lib-pkg': { reason: 'built elsewhere', issue: '#1' } };
        const result = await auditShippedGiDeps(ctx);
        assert.deepEqual(result.failures, []);
        assert.deepEqual(result.excused, ['@gjsify/lib-pkg']);
    });
});

describe('--scope selects the population the banner claims', () => {
    it('reaches the rule and names the population, for both scopes', () => {
        // End-to-end wiring, asserted on the SPECIFIC finding rather than the exit code: a
        // whole-repo run over a fixture also exercises repo-knowledge ledgers that describe
        // THIS repository, and a test that failed on those would be testing the fixture.
        for (const [scope, pkg] of [
            ['ship', '@gjsify/lib-pkg'],
            ['examples', '@gjsify/example-pkg'],
        ]) {
            const dir = fixture([[pkg, { headless: true, bundle: PLANTED }]]);
            const run = cli(dir, [`--scope=${scope}`]);
            assert.match(run.stderr, new RegExp(`population = --scope=${scope}`), `${scope}: banner`);
            assert.match(run.stderr, /shipped-headless-violated/, `${scope}: the rule ran`);
        }
    });

    it('does not run a package the scope excludes', () => {
        // The negative direction of selection, and the reason the two scopes are separate
        // populations rather than one: the ship scope must not answer for a showcase, and
        // the examples scope must not answer for a library.
        const dir = fixture([['@gjsify/example-pkg', { headless: true, bundle: PLANTED }]]);
        const run = cli(dir, ['--scope=ship']);
        assert.doesNotMatch(run.stderr, /shipped-headless-violated/, 'a showcase is not in the ship closure');
    });

    it('names the population on the GREEN line too', () => {
        // A green line that does not say what it covered is the shape of the defect: the
        // reader of a CI log cannot learn the scope from an exit code.
        const dir = fixture([['@gjsify/lib-pkg', { headless: true }]]);
        const run = cli(dir, ['--scope=ship']);
        assert.match(run.stdout + run.stderr, /population = --scope=ship/);
    });

    it('refuses an unknown --scope by name instead of auditing a population nobody asked for', () => {
        const run = spawnSync(process.execPath, [AUDIT, '--check', '--strict', '--scope=bogus'], { encoding: 'utf8' });
        assert.equal(run.status, 2);
        assert.match(run.stderr, /--scope must be one of/);
    });
});

describe('the scope populations are DERIVED once, shared with the publish path', () => {
    it('splits the closure the way verify-package-outputs does', () => {
        // Two scripts must agree on what a release ships. `ship` and `examples` are
        // complementary over the published set, and both exclude the generated `@girs/*`
        // and the Astro website.
        const ship = excludePatternsFor('ship');
        const examples = excludePatternsFor('examples');
        for (const name of ['@gjsify/adwaita-app', '@gjsify/example-node-express-webserver']) {
            assert.equal(inScope(name, ship) !== inScope(name, examples), true, `${name} must be in exactly one scope`);
        }
        assert.equal(inScope('@gjsify/example-node-express-webserver', examples), true);
        assert.equal(inScope('@girs/gtk-4.0', ship), false, '@girs/* is a type package, not a shipped artifact');
        assert.equal(inScope('@gjsify/website', ship), false);
        assert.deepEqual([...SCOPES], ['core', 'ship', 'examples']);
    });
});

describe('the font ledger does not become a tripwire on an unbuilt checkout', () => {
    // Found by running the issue's own repro — a FRESH checkout, nothing built — which is
    // the only state in which this is ever reached. `stylesheet-font-families` retires an
    // entry that matches no live claim, and its shipped tree is a build output, so on an
    // unbuilt tree it cannot see the claim its own entry was written for and reports the
    // entry as stale. That is the ledger demanding its own deletion on every fresh clone:
    // a self-retiring ledger turned into a tripwire, and a check that cries wolf on the
    // one checkout every developer makes first is a check people stop reading.
    it('keeps a ledger entry whose package has not been built', () => {
        const dir = fixture([['@gjsify/font-pkg', { bundle: 'export const ok = 1;\n' }]]);
        // A shipped stylesheet the rule will find, plus a declared built tree it cannot
        // read — the exact shape of a showcase before `build:examples` has run.
        mkdirSync(join(dir, 'packages', 'font-pkg', 'src'), { recursive: true });
        writeFileSync(
            join(dir, 'packages', 'font-pkg', 'src', 'style.css'),
            'h1 { font-family: "Adwaita Sans", sans-serif; }\n',
        );
        rmSync(join(dir, 'packages', 'font-pkg', 'lib'), { recursive: true, force: true });
        // The entry under test: a recorded decision for a claim that is real but lives in
        // the tree this checkout has not built yet.
        mkdirSync(join(dir, 'status'), { recursive: true });
        writeFileSync(
            join(dir, 'status', 'stylesheet-font-families.json'),
            `${JSON.stringify({ reviewed: { 'packages/font-pkg: Adwaita Sans': 'a decision, recorded' } }, null, 2)}\n`,
        );

        const ctx = createContext({ root: dir });
        const result = auditStylesheetFontFamilies(ctx);
        const stale = (result.failures ?? []).filter((f) => /matches no font-family claim/.test(f));
        assert.deepEqual(stale, [], 'an unbuilt package must not make its own ledger entry look stale');
    });
});

describe('the emitted-bundle reader reads the BUILD, not the source', () => {
    it('separates a hard namespace from an ADR 0086 optional one', () => {
        // The seam the whole hard-dep set is built to leave open: `?…&optional` resolves in
        // a try/catch and yields `undefined`, so it is not a dependency a consumer must
        // satisfy before the module loads. PR #1947 is not merged here, so nothing in the
        // tree emits it — which is exactly why the classification needs a case of its own.
        // An untested seam is a comment.
        assert.deepEqual(parseGiSpecifier('gi://Gtk?version=4.0'), { ns: 'Gtk', optional: false });
        assert.deepEqual(parseGiSpecifier('gi://Gtk?version=4.0&optional'), { ns: 'Gtk', optional: true });
        assert.deepEqual(parseGiSpecifier('gi://Gtk?optional&version=4.0'), { ns: 'Gtk', optional: true });
        assert.deepEqual(parseGiSpecifier('gi://Gtk'), { ns: 'Gtk', optional: false });
        // An unrecognised parameter must not be able to hide `optional`.
        assert.deepEqual(parseGiSpecifier('gi://Gtk?future=1&optional'), { ns: 'Gtk', optional: true });

        const scanned = scanBundleGiNamespaces(
            'import Gtk from "gi://Gtk?version=4.0";\nimport Gdk from "gi://Gdk?version=4.0&optional";\n',
        );
        assert.deepEqual(
            scanned.hard.map((b) => b.ns),
            ['Gtk'],
        );
        assert.deepEqual(
            scanned.optional.map((b) => b.ns),
            ['Gdk'],
        );
    });

    it('reads the bare side-effect import a regex-over-text reader historically missed', () => {
        // `gi-namespaces.ts`'s header records that the first version of that reader missed
        // this form — the exact shape `@gjsify/fetch` puts at the top of every bundle that
        // pulls it. A bundle that shipped without libsoup installed cleanly and died at its
        // first request.
        const scanned = scanBundleGiNamespaces('import "gi://Soup?version=3.0";\n');
        assert.deepEqual(
            scanned.hard.map((b) => b.ns),
            ['Soup'],
        );
    });

    it('does not read a `gi://` that only appears in prose or a comment', () => {
        // The other half of the same incident: that reader also matched `gi://…` inside a
        // diagnostic STRING, which made a correct project unpackageable. The mirror failure
        // here is quieter and worse — a dependency that can be invented by rewording a
        // comment is a finding people switch off.
        const scanned = scanBundleGiNamespaces(
            [
                '/** Resolve `gi://Ns?version=X` to a namespace. See `gi://Gtk?version=4.0`. */',
                '// the emitted form is import x from "gi://Soup?version=3.0"',
                "const help = 'load gi://Gtk first';",
                'export const x = 1;',
            ].join('\n'),
        );
        assert.deepEqual(scanned.hard, [], 'prose and comments are not module specifiers');
        assert.deepEqual(scanned.optional, []);
    });

    it('does not read a dynamic import as a hard dependency', () => {
        // `await import('gi://X')` behind a runtime branch is the sanctioned
        // graceful-degradation shape and `DYNAMIC_GI_RE` says so for source. Counting it
        // here would make every optional namespace in the tree a violation.
        const scanned = scanBundleGiNamespaces('const Gtk = await import("gi://Gtk?version=4.0").catch(() => null);\n');
        assert.deepEqual(scanned.hard, []);
    });

    it('does not read a @girs vocabulary import as a typelib binding', () => {
        // `/vocabulary` is generated DATA — zero `gi://` references in the published
        // `gtk-4.0-vocabulary.js` against the one its main entry holds. Counting it made
        // `@gjsify/blueprint` and `@gjsify/cli` look hard-bound to `gi://adw`.
        const scanned = scanBundleGiNamespaces('import { OWN_PROPS } from "@girs/adw-1/vocabulary";\n');
        assert.deepEqual(scanned.hard, []);
        // The value import of the MAIN entry is a binding, which is the other half.
        assert.deepEqual(
            scanBundleGiNamespaces('import Gio from "@girs/gio-2.0";\n').hard.map((b) => b.ns),
            ['gio'],
        );
    });

    it('reports the specifier it was reached by, not a fabricated `gi://` one', () => {
        // `@gjsify/child_process` binds Gio through the type package and its emitted root
        // contains no `gi://` text at all. A set printing `gi://gio` would invent a
        // dependency the file does not have, and a hard-dep set is only useful if its
        // entries can be pasted into a `depends.ts` or a bug report.
        const scanned = scanBundleGiNamespaces('import Gio from "@girs/gio-2.0";\n');
        assert.deepEqual(
            scanned.hard.map((b) => b.form),
            ['@girs/gio-2.0'],
        );
    });

    it('reads the `--app node` requireGi form, where the specifier is rewritten away', () => {
        // `gjsGiNodePlugin` rewrites every `gi://Ns?version=X` into a requireGi call, so a
        // reader looking only for the specifier finds NOTHING in a `--app node` bundle —
        // the empty dependency set that installs cleanly and dies at the first GI call.
        const scanned = scanBundleGiNamespaces('const e=require("@gjsify/node-gi/gi").requireGi("Gtk","4.0");\n');
        assert.deepEqual(
            scanned.hard.map((b) => b.ns),
            ['Gtk'],
        );
    });
});

describe('the shipped graph is the ROOT ENTRY graph, not every shipped file', () => {
    it('follows a relative import the root reaches and stops at one it does not', () => {
        // `@gjsify/canvas2d-core` declares `headless: ["Gdk", …]` and its shipped tree
        // really does contain a module importing `gi://Gdk` — that is the FIX for the
        // violation the rule exists to catch, moved behind a subpath the root no longer
        // reaches. A rule that scans every module of `lib/` re-reports the repair as the
        // disease, and the only way to quiet that is to switch the check off.
        const dir = join(tmp, `graph-${Math.random().toString(36).slice(2)}`);
        mkdirSync(join(dir, 'lib', 'esm'), { recursive: true });
        writeFileSync(join(dir, 'lib', 'esm', 'index.js'), 'export { x } from "./other.js";\n');
        writeFileSync(join(dir, 'lib', 'esm', 'other.js'), 'export const x = 1;\n');
        writeFileSync(
            join(dir, 'lib', 'esm', 'gdk-bridge.js'),
            'import Gdk from "gi://Gdk?version=4.0";\nexport const b = Gdk;\n',
        );

        const byName = new Map([['@gjsify/core', { roots: [join(dir, 'lib', 'esm', 'index.js')] }]]);
        const reached = walkShippedGraph(join(dir, 'lib', 'esm', 'index.js'), byName);
        // `parents` maps every VISITED file to the one that imported it, so its KEYS are the
        // graph — which is what "the root entry graph" has to mean for the promise to stay
        // the promise `headless` makes.
        const visited = [...reached.parents.keys()];
        assert.ok(
            visited.includes(join(dir, 'lib', 'esm', 'other.js')),
            'a relative import the root DOES reach is followed',
        );
        assert.ok(
            !visited.includes(join(dir, 'lib', 'esm', 'gdk-bridge.js')),
            'a subpath the root does not import is not reached',
        );
        assert.deepEqual(reached.hits, [], 'and it contributes no GI binding');
    });
});
