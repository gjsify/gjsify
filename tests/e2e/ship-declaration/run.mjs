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
import { spawnSync } from 'node:child_process';
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

    // `TARGETS` in the rule above is the ONE copy of the ship format vocabulary the
    // compiler cannot bind: it lives in a package that must not import the CLI,
    // because the rule is `scope: 'portable'` and runs where `@gjsify/cli` is not a
    // dependency. `scripts/check-ship-format-vocabulary.mjs` is that binding, and the
    // direction that matters is the counter-intuitive one — a stale `TARGETS` does
    // not MISS a check, it REJECTS the first correct declaration of a newly
    // supported format, in a downstream tree, saying the format cannot be built.
    describe('the format vocabulary has one source of truth', () => {
        const CHECK = join(MONOREPO_ROOT, 'scripts', 'check-ship-format-vocabulary.mjs');

        /** A fixture tree holding just the two files the check compares. */
        function vocabularyRoot(name, formatIds, targets) {
            const root = makeRoot(`vocab-${name}`);
            const types = join(root, 'packages', 'infra', 'cli', 'src', 'utils', 'ship');
            const rules = join(root, 'packages', 'infra', 'manifest-conformance', 'lib', 'rules');
            mkdirSync(types, { recursive: true });
            mkdirSync(rules, { recursive: true });
            writeFileSync(
                join(types, 'types.ts'),
                `export type FormatId = ${formatIds.map((id) => `'${id}'`).join(' | ')};\n`,
            );
            writeFileSync(
                join(rules, 'ship.mjs'),
                `const TARGETS = new Set([${targets.map((id) => `'${id}'`).join(', ')}]);\n`,
            );
            return root;
        }

        const runCheck = (root) => spawnSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf8' });

        it('passes when the two agree', () => {
            const result = runCheck(vocabularyRoot('agree', ['deb', 'rpm'], ['deb', 'rpm']));
            assert.equal(result.status, 0, result.stdout + result.stderr);
        });

        it('FAILS when the rule has not learned a format the CLI declares', () => {
            const result = runCheck(vocabularyRoot('behind', ['deb', 'rpm', 'dmg'], ['deb', 'rpm']));
            assert.equal(result.status, 1);
            assert.match(result.stderr, /`TARGETS` is missing "dmg"/);
            // The consequence, not just the drift — this is what makes it urgent.
            assert.match(result.stderr, /would REJECT a package that legitimately declares/);
        });

        it('FAILS when the rule accepts a format the CLI cannot build', () => {
            const result = runCheck(vocabularyRoot('ahead', ['deb', 'rpm'], ['deb', 'rpm', 'msi']));
            assert.equal(result.status, 1);
            assert.match(result.stderr, /`TARGETS` names "msi", which `FormatId` does not/);
        });

        // A textual comparison that stops matching must FAIL. Reporting agreement
        // because it found nothing on both sides is the exact shape of a check that
        // has quietly stopped checking.
        it('FAILS rather than reporting agreement when it can no longer parse either side', () => {
            const root = makeRoot('vocab-unparseable');
            const types = join(root, 'packages', 'infra', 'cli', 'src', 'utils', 'ship');
            const rules = join(root, 'packages', 'infra', 'manifest-conformance', 'lib', 'rules');
            mkdirSync(types, { recursive: true });
            mkdirSync(rules, { recursive: true });
            writeFileSync(join(types, 'types.ts'), 'export type FormatId = (typeof FORMAT_IDS)[number];\n');
            writeFileSync(join(rules, 'ship.mjs'), 'const TARGETS = KNOWN_TARGETS;\n');
            const result = runCheck(root);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /could not read the `FormatId` union — .*names nothing/);
            assert.match(result.stderr, /could not read the target set — no `const TARGETS/);
        });

        // A COMMENT quoting the declaration used to win over the declaration: a
        // non-global `.exec()` returns the earliest match, and this tree quotes code
        // in comments constantly. Measured before the fix — rule a whole format
        // behind, check said "agree", exit 0. Two matches must fail.
        it('FAILS when a comment quotes the declaration, rather than reading the comment', () => {
            const root = makeRoot('vocab-quoted');
            const types = join(root, 'packages', 'infra', 'cli', 'src', 'utils', 'ship');
            const rules = join(root, 'packages', 'infra', 'manifest-conformance', 'lib', 'rules');
            mkdirSync(types, { recursive: true });
            mkdirSync(rules, { recursive: true });
            writeFileSync(
                join(types, 'types.ts'),
                "// Before dmg this was: export type FormatId = 'deb' | 'rpm';\n" +
                    "export type FormatId = 'deb' | 'rpm' | 'dmg';\n",
            );
            writeFileSync(join(rules, 'ship.mjs'), "const TARGETS = new Set(['deb', 'rpm']);\n");
            const result = runCheck(root);
            assert.equal(result.status, 1, 'a stale rule behind a quoting comment must not read as agreement');
            assert.match(result.stderr, /matches 2 times/);
        });

        // The `read()` failure branch — the one thing `--root` was added for and, until
        // this case, never aimed at. A missing file must name itself, not fall through
        // to a parse message that sounds like a formatting problem.
        it('names the file it could not read', () => {
            const root = makeRoot('vocab-missing');
            const types = join(root, 'packages', 'infra', 'cli', 'src', 'utils', 'ship');
            mkdirSync(types, { recursive: true });
            writeFileSync(join(types, 'types.ts'), "export type FormatId = 'deb' | 'rpm';\n");
            const result = runCheck(root);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /manifest-conformance\/lib\/rules\/ship\.mjs could not be read \(ENOENT\)/);
        });

        // `--root` with nothing after it silently answered about the REAL repository —
        // green, for a tree the caller never asked about.
        it('refuses --root with no directory after it', () => {
            const result = spawnSync(process.execPath, [CHECK, '--root'], { encoding: 'utf8' });
            assert.equal(result.status, 2);
            assert.match(result.stderr, /--root was given with no directory/);
        });

        // The real tree, so the two lists are actually compared on every run and not
        // only against fixtures that agree by construction.
        it('holds for this checkout', () => {
            const result = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stdout + result.stderr);
            assert.match(result.stdout, /FormatId and conformance TARGETS agree on deb, rpm/);
        });
    });
});
