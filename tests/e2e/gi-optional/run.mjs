// E2E: a `gi://Ns?version=X&optional` import of an ABSENT typelib starts, on BOTH
// build targets, and the packaging split follows the flag (ADR 0087).
//
// The control is the same program without the flag: it must keep dying at load, so the
// first row cannot pass by the namespace happening to exist on the host.
//
// The node rows are not a second copy of the gjs rows. `--app node` reaches GI
// through `@gjsify/node-gi`, whose hard shim is a LAZY Proxy that is never
// `undefined` — so before the node arm existed, the same source degraded on gjs and
// threw at the first member access on node, and the flag silently did nothing
// there. Everything this suite asserts about node is the same assertion the gjs
// rows make, and that symmetry is the point.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MONOREPO_ROOT } from '../helpers.mjs';
import { runCli } from '../mock-registry.mjs';

const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

// A namespace no host has, so the suite measures absence everywhere.
const ABSENT = 'GjsifyNoSuchNamespace';

// A namespace every GNOME host HAS, imported optionally: it proves the optional arm
// still yields the namespace when the typelib is present, which is the half of the
// contract a no-host fixture cannot see.
const PRESENT = 'GLib';

// The readers under test, IMPORTED from the CLI that writes them rather than
// restated. `scanGiRequirements` decides hard-vs-optional for a real artifact and
// `deriveDepends` decides what a `.deb` names — a copy of either here would keep
// agreeing with itself after it changed.
const { scanGiRequirements } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'gi-namespaces.js')).href
);
const { deriveDepends } = await import(
    pathToFileURL(join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'utils', 'ship', 'depends.js')).href
);

function hasGjs() {
    const r = spawnSync('gjs', ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

// `--app node` needs a Node on PATH to run the result; every host running this
// suite has one (the suite itself runs under it), so this is the `gjs` probe's twin.
function hasNode() {
    const r = spawnSync(process.execPath, ['--version'], { stdio: 'ignore' });
    return r.status === 0 && r.error === undefined;
}

describe('an optional gi:// import', { timeout: 8 * 60 * 1000, skip: hasGjs() ? false : 'no gjs on PATH' }, () => {
    let projectDir;

    async function build(name, source, app = 'gjs') {
        writeFileSync(join(projectDir, 'src', `${name}.ts`), source);
        const built = await runCli(
            CLI_ENTRY,
            ['build', `src/${name}.ts`, '--app', app, '--outfile', `dist/${name}.js`],
            { cwd: projectDir, env: process.env, timeoutMs: 4 * 60 * 1000 },
        );
        assert.equal(built.status, 0, `gjsify build --app ${app} failed:\n${built.stdout}\n${built.stderr}`);
        return join(projectDir, 'dist', `${name}.js`);
    }

    const runGjs = (file) => spawnSync('gjs', ['-m', file], { cwd: projectDir, encoding: 'utf-8', timeout: 60_000 });
    const runNode = (file) =>
        spawnSync(process.execPath, [file], { cwd: projectDir, encoding: 'utf-8', timeout: 60_000 });

    before(() => {
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`gjsify workspace @gjsify/cli run build\``);
        }
        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-gi-optional-'));
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'gi-optional-fixture', version: '0.0.0', private: true, type: 'module' }) + '\n',
        );
    });

    after(() => {
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    // ── --app gjs: the runtime contract ──────────────────────────────────

    it('starts without the typelib and hands the app `undefined`', async () => {
        const file = await build(
            'optional',
            `import Ns from 'gi://${ABSENT}?version=1.0&optional';\nconsole.log('ns:' + (Ns === undefined ? 'absent' : 'present'));\n`,
        );
        const r = runGjs(file);
        assert.equal(r.status, 0, `the bundle did not start:\n${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /ns:absent/);
    });

    it('names the namespace, version and cause in the diagnostic', async () => {
        const r = runGjs(join(projectDir, 'dist', 'optional.js'));
        const out = r.stdout + r.stderr;
        assert.match(out, new RegExp(`optional GI namespace ${ABSENT} 1\\.0 is not available`));
        assert.match(out, /not found/);
    });

    it('still hands the app the namespace when the typelib IS present', async () => {
        // The control for the arm's whole point. A fixture with only an ABSENT
        // namespace passes an implementation that returns `undefined`
        // unconditionally — which is exactly the shape a "swallow the error"
        // patch takes, and it would cost every consumer the feature they declared
        // optional rather than unavailable.
        const file = await build(
            'present',
            `import G from 'gi://${PRESENT}?version=2.0&optional';\nconsole.log('glib:' + (G === undefined ? 'absent' : 'present'));\n`,
        );
        const r = runGjs(file);
        assert.equal(r.status, 0, `the bundle did not start:\n${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /glib:present/);
        // And it says NOTHING — a warn on the success path would train every
        // reader to ignore the one line that matters.
        assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`optional GI namespace ${PRESENT}`));
    });

    it('keeps the clean specifier in the bundle, flag removed', () => {
        const bundle = readFileSync(join(projectDir, 'dist', 'optional.js'), 'utf-8');
        assert.ok(bundle.includes(`gi://${ABSENT}?version=1.0`), 'the verbatim specifier is not in the bundle');
        assert.ok(!bundle.includes('&optional'), 'the flag leaked into the emitted specifier');
    });

    it('control: the same import without the flag still fails at load', async () => {
        const file = await build('hard', `import Ns from 'gi://${ABSENT}?version=1.0';\nconsole.log(typeof Ns);\n`);
        const r = runGjs(file);
        assert.notEqual(r.status, 0, 'an unflagged absent typelib must keep failing');
        assert.match(r.stdout + r.stderr, /not found/);
    });

    // ── --app node: the same contract, through node-gi ───────────────────

    describe('the same source built for --app node', { skip: hasNode() ? false : 'no node on PATH' }, () => {
        it('starts without the typelib and hands the app `undefined`', async () => {
            const file = await build(
                'node-optional',
                `import Ns from 'gi://${ABSENT}?version=1.0&optional';\nconsole.log('ns:' + (Ns === undefined ? 'absent' : 'present'));\n`,
                'node',
            );
            const r = runNode(file);
            // The arm lands `undefined` because `require('@gjsify/node-gi/gi')`
            // itself rejects in this fixture (node-gi is not installed here), and
            // the catch covers both — without which the bundle would die at load on
            // every host that has not installed the reverse bridge.
            assert.equal(r.status, 0, `the node bundle did not start:\n${r.stdout}\n${r.stderr}`);
            assert.match(r.stdout, /ns:absent/);
            assert.match(r.stdout + r.stderr, new RegExp(`optional GI namespace ${ABSENT} 1\\.0 is not available`));
        });

        it('carries NO gi:// specifier, and no top-level await', async () => {
            // Both properties of the node arm, and both would be a defect on their
            // own: a bare `gi://` is `ERR_UNSUPPORTED_ESM_URL_SCHEME` at Node's
            // loader, and a top-level await would make every IMPORTER async for a
            // flag whose purpose is that the app can branch on the result.
            const bundle = readFileSync(join(projectDir, 'dist', 'node-optional.js'), 'utf-8');
            assert.ok(!bundle.includes('gi://'), `the node bundle still names a gi:// specifier:\n${bundle}`);
            // The positive control: it must still name the node-gi module, or the
            // row above passes on a bundle that never reached GI at all.
            assert.ok(
                bundle.includes('@gjsify/node-gi/gi'),
                'the node bundle never names @gjsify/node-gi/gi, so the row above proves nothing',
            );
        });

        it('is classified optional by the packaging reader, which sees no gi:// at all', async () => {
            // THE REASON the node arm has to exist as a build change rather than a
            // documentation note. `scanGiRequirements` on this artifact answers
            // `Soup-3.0` from a `requireGi(...)` call — the one reader both targets
            // share — and without the marker statement the answer would carry no
            // optional flag, so a shipped node package would declare the typelib
            // hard.
            const bundle = readFileSync(join(projectDir, 'dist', 'node-optional.js'), 'utf-8');
            const scanned = scanGiRequirements(bundle);
            assert.deepEqual(scanned.namespaces, [`${ABSENT}-1.0`]);
            assert.deepEqual(scanned.optional, [`${ABSENT}-1.0`]);
        });
    });

    // ── the packaging split, read off a real artifact ────────────────────

    it('derives hard vs optional typelibs from a real --app gjs bundle', async () => {
        // A bundle that imports one namespace each way, which is the shape an
        // author actually writes. Scanned off the EMITTED file — the artifact is
        // what ships, and `depends.ts`'s whole premise is that a declaration can be
        // stale in a way nothing notices until a user's linker complains.
        await build(
            'mixed',
            [
                `import Gtk from 'gi://Gtk?version=4.0';`,
                `import Notify from 'gi://Notify?version=0.7&optional';`,
                `console.log(typeof Gtk, typeof Notify);`,
                '',
            ].join('\n'),
        );
        const scanned = scanGiRequirements(readFileSync(join(projectDir, 'dist', 'mixed.js'), 'utf-8'));
        assert.deepEqual(scanned.namespaces, ['Gtk-4.0', 'Notify-0.7']);
        assert.deepEqual(scanned.optional, ['Notify-0.7']);

        const deb = deriveDepends('deb', {
            namespaces: scanned.namespaces,
            optionalNamespaces: scanned.optional,
            hasIcons: false,
            hasSchemas: false,
            interpreter: 'gjs',
            extra: [],
        });
        // The whole point of the split, on a scan of a real bundle rather than a
        // hand-written list: the optional namespace must reach `Recommends:` and
        // must NOT reach `Depends:`, because in `Depends:` it would mean apt
        // refuses to install the package on a host without libnotify.
        assert.ok(deb.requires.includes('gir1.2-gtk-4.0'));
        assert.ok(!deb.requires.includes('gir1.2-notify-0.7'));
        assert.deepEqual(deb.recommends, ['gir1.2-notify-0.7']);
        assert.deepEqual(deb.unmappedOptional, []);
    });

    it('reads the marker out of a MINIFIED bundle, which is the build default', async () => {
        // Not a hypothetical: `--minify` defaults to true, and it rewrites the
        // marker's string literals to backticks. A reader that only understood
        // quoted strings would classify every real artifact as hard, and the split
        // would be a property of the test suite rather than of the products.
        const bundle = readFileSync(join(projectDir, 'dist', 'mixed.js'), 'utf-8');
        assert.ok(
            bundle.includes('`') || !bundle.includes('"'),
            'the fixture build was not minified, so it proves nothing',
        );
        const scanned = scanGiRequirements(bundle);
        assert.deepEqual(scanned.optional, ['Notify-0.7']);
    });
});
