// E2E for the `ship` conformance rule — every declared `gjsify.ship` path
// exists and every declared identifier is one the packers accept.
//
// WHY THIS SUITE EXISTS, and why it drives the rule through `createContext`
// rather than through `audit-runtimes --check`: the rule is `scope: 'portable'`,
// a claim that it is correct in ANY consumer's tree. Running it only against this
// repository would leave that claim barely tested, because exactly ONE package
// here declares `gjsify.ship` — `packages/infra/cli` itself, with `kind` resolved
// from `gjsify.flatpak`, three keys, and both landed targets — so nearly every
// branch of the rule would still never fire, and a rule that stopped firing would
// look exactly like a passing one.
//
// Corrected 2026-08-21: this header (and `status/open-todos.md` with it) used to
// say "no package here declares `gjsify.ship` at all". That was measurably false —
// `release-cut.yml` runs `ship --skip-build` against that declaration on every
// cut — and three separate design passes reasoned from it. The suite's shape is
// unchanged; only the reason it gives for that shape was wrong.
//
// Synthetic roots in a tmpdir, never this checkout: a fixture that reads repo
// state goes red when unrelated work lands (see the header of
// `tests/e2e/prebuild-declaration-invariant`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');

const { createContext, shipRule } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs')}`
);

let tmp;

/** A workspace root with `packages/*`. */
function makeRoot(name) {
    const root = join(tmp, name);
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: `${name}-root`, private: true, workspaces: ['packages/*'] }, null, 2),
    );
    return root;
}

/** Write `packages/<dir>/package.json` plus any files (path → contents). */
function addPackage(root, dir, pkg, files = {}) {
    const pkgDir = join(root, 'packages', dir);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2));
    for (const [rel, contents] of Object.entries(files)) {
        const abs = join(pkgDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, contents);
    }
    return pkgDir;
}

/** Run the rule over a synthetic root and return its findings. */
function run(root) {
    const ctx = createContext({ root, discoveryRoots: ['packages'] });
    return shipRule.run(ctx);
}

describe('ship declaration invariant', { timeout: 5 * 60 * 1000 }, () => {
    before(() => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ship-decl-'));
    });

    after(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it('passes a block whose declared paths all exist', () => {
        const root = makeRoot('ok');
        addPackage(
            root,
            'app',
            {
                name: '@fixture/app',
                gjsify: {
                    ship: {
                        appId: 'io.github.fixture.App',
                        binaryName: 'fixture-app',
                        icon: 'data/icons',
                        schemas: 'data',
                        targets: ['deb', 'rpm'],
                        typelibPackages: { 'Nautilus-3.0': { deb: 'gir1.2-nautilus-3.0', rpm: 'nautilus' } },
                        extraFiles: { 'share/doc/extra': 'EXTRA.md' },
                    },
                },
            },
            {
                'data/icons/io.github.fixture.App.svg': '<svg/>\n',
                'data/io.github.fixture.App.gschema.xml': '<schemalist/>\n',
                'EXTRA.md': 'extra\n',
            },
        );
        assert.deepEqual(run(root).failures, []);
    });

    it('passes a package that declares nothing — every key has a derived default', () => {
        const root = makeRoot('absent');
        addPackage(root, 'plain', { name: '@fixture/plain' });
        const { failures, stats } = run(root);
        assert.deepEqual(failures, []);
        assert.equal(stats.declared, 0);
    });

    it('FAILS a declared path that does not exist — the typo this rule exists for', () => {
        const root = makeRoot('typo');
        addPackage(root, 'app', {
            name: '@fixture/app',
            gjsify: { ship: { icon: 'data/icons/app.svg', schemas: 'data' } },
        });
        const { failures } = run(root);
        assert.equal(failures.length, 2);
        assert.match(failures.join('\n'), /`gjsify\.ship\.icon` points at data\/icons\/app\.svg/);
        assert.match(failures.join('\n'), /`gjsify\.ship\.schemas` points at data/);
    });

    it('FAILS an app id that is not reverse-DNS', () => {
        // It installs fine and is then invisible to every app store — the kind
        // of wrong that is only discovered by someone else.
        const root = makeRoot('appid');
        addPackage(root, 'app', { name: '@fixture/app', gjsify: { ship: { appId: 'myapp' } } });
        assert.match(run(root).failures.join('\n'), /not a reverse-DNS application id/);
    });

    it('FAILS a package name dpkg would refuse', () => {
        const root = makeRoot('binaryname');
        addPackage(root, 'app', { name: '@fixture/app', gjsify: { ship: { binaryName: 'My_App' } } });
        assert.match(run(root).failures.join('\n'), /which dpkg will not accept/);
    });

    it('FAILS an unknown target and a half-filled typelib row', () => {
        const root = makeRoot('shapes');
        addPackage(root, 'app', {
            name: '@fixture/app',
            gjsify: { ship: { targets: ['snap'], typelibPackages: { 'Foo-1.0': { deb: 'gir1.2-foo-1.0' } } } },
        });
        const { failures } = run(root);
        assert.match(failures.join('\n'), /names "snap", which `gjsify ship` cannot build/);
        // A row missing one format silently falls back to the built-in table —
        // which is what did not know the namespace — so the build fails for
        // that format only, and usually the one the author does not build.
        assert.match(failures.join('\n'), /needs BOTH a `deb` and an `rpm`/);
    });

    it('FAILS a block that is not an object', () => {
        const root = makeRoot('shape');
        addPackage(root, 'app', { name: '@fixture/app', gjsify: { ship: ['deb'] } });
        assert.match(run(root).failures.join('\n'), /must be an object/);
    });
});
