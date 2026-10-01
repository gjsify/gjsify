// E2E: `scripts/bootstrap-native-facades.mjs` is self-sufficient on a COLD tree.
//
// The regression it guards (v0.24.1): the script hard-required
// `packages/infra/cli/lib/index.js` — the Node CLI entry it spawns, itself a
// BUILD OUTPUT — and exited 1 with "run `gjsify workspace @gjsify/cli build`
// first". Every caller therefore had to know the ordering, and one did not: the
// release workflow's `publish-napi` job, whose tree is checkout + install by
// design. `@gjsify/napi` was the single package that missed the v0.24.1 train,
// and the release was otherwise green.
//
// `verify-committed-bundles.mjs` already carried the cold-tree fallback in its
// own preflight; the fix moved it INTO the bootstrap so every caller inherits
// it, and deleted the copy.
//
// WHAT IS TESTED HERE, AND WHY IT IS THE PLAN AND NOT THE BUILD
//
// The cold branch runs root `build:infra` — a multi-minute tsc + bundler chain.
// Running it for real would make this suite unusable in the parallel e2e batch
// and would test the build, not the decision. So the script exposes
// `--print-plan`: it reports the cold/warm branch and exits without spawning.
// The fixture is a bare directory with the REAL script copied into its
// `scripts/`, which is what makes the fixture the script's `root` (it derives
// root from its own location) — no repo state is touched.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveGjsifySpawn } from '../../../scripts/resolve-gjsify.mjs';
import { FACADE_PACKAGES, NOT_OWED, offDiskToolchainDeps } from '../../../scripts/off-disk-toolchain-deps.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
// Every `scripts/` file the script under test imports has to be staged with it —
// the fixture IS its `root`, derived from its own location, so a sibling import
// resolves inside the fixture and nowhere else. `resolve-gjsify.mjs` is that
// sibling: it picks the `.cmd` member of npm's shim trio on Windows and routes
// it through `%COMSPEC%`, because `node_modules/.bin/gjsify` exists there and is
// the one member the OS cannot execute. `off-disk-toolchain-deps.mjs` is the
// other: the script names its facades through the SHARED list, so it must not
// resolve them from a list of its own that a reader would take for the fact.
//
// Listed rather than copying `scripts/` wholesale: the point of this fixture is
// that the tree holds the MINIMUM the script needs, so a new undeclared
// dependency has to show up here as an edit.
const SCRIPT_FILES = ['bootstrap-native-facades.mjs', 'resolve-gjsify.mjs', 'off-disk-toolchain-deps.mjs'];
const NO_RECURSE_ENV = 'GJSIFY_BOOTSTRAP_NO_BUILD_INFRA';

/**
 * A fixture root holding a copy of the real script at `<root>/scripts/`.
 *
 * `warm` / `bundle` create the two files the workspace `.bin/gjsify` shim can
 * hand control to; `shim` creates the shim itself. They are independent on
 * purpose — "the shim exists but both its targets do not" is the state a fresh
 * clone is in since ADR 0002 untracked the bundles, and it is the one the
 * resolver has to refuse.
 */
function makeFixture({ warm, shim = false, bundle = false }) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-bootstrap-cold-'));
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const name of SCRIPT_FILES) {
        cpSync(join(MONOREPO_ROOT, 'scripts', name), join(root, 'scripts', name));
    }
    if (warm) {
        const libDir = join(root, 'packages', 'infra', 'cli', 'lib');
        mkdirSync(libDir, { recursive: true });
        writeFileSync(join(libDir, 'index.js'), '// stand-in for the built Node CLI entry\n');
    }
    if (bundle) {
        const distDir = join(root, 'packages', 'infra', 'cli', 'dist');
        mkdirSync(distDir, { recursive: true });
        writeFileSync(join(distDir, 'cli.gjs.mjs'), '// stand-in for the built GJS bundle\n');
    }
    if (shim) {
        const binDir = join(root, 'node_modules', '.bin');
        mkdirSync(binDir, { recursive: true });
        // Both spellings, so the assertions hold on win32 too — npm writes the
        // extensionless sh shim beside the `.cmd`, and the resolver picks the
        // `.cmd` there (see `scripts/resolve-gjsify.mjs`).
        writeFileSync(join(binDir, 'gjsify'), '#!/bin/sh\n');
        writeFileSync(join(binDir, 'gjsify.cmd'), '@echo off\n');
    }
    return root;
}

function run(root, { env = {}, expectFail = false } = {}) {
    const script = join(root, 'scripts', 'bootstrap-native-facades.mjs');
    try {
        const stdout = execFileSync(process.execPath, [script, '--print-plan'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        assert.ok(!expectFail, `expected a non-zero exit, got 0:\n${stdout}`);
        return { status: 0, output: stdout };
    } catch (err) {
        assert.ok(expectFail, `expected exit 0, got ${err.status}:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
        return { status: err.status, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
}

describe('bootstrap-native-facades on a cold tree', { timeout: 60_000 }, () => {
    it('plans `build:infra` when the Node CLI entry is absent', () => {
        const root = makeFixture({ warm: false });
        try {
            const { output } = run(root);
            assert.match(output, /plan: cold/);
            assert.match(output, /build:infra/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('builds the facades directly when the entry is present', () => {
        const root = makeFixture({ warm: true });
        try {
            const { output } = run(root);
            assert.match(output, /plan: warm/);
            assert.doesNotMatch(output, /build:infra/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not pick the workspace shim when both its targets are gone', () => {
        // The state a fresh clone is in after `gjsify install --immutable`
        // since ADR 0002: `.bin/gjsify` exists, and the `dist/cli.gjs.mjs` /
        // `lib/index.js` it dispatches to do not. Returning it would spawn fine
        // and then die inside `sh` with `Cannot find module …/lib/index.js`,
        // which reads as a broken install — and it would shadow the two rungs
        // below it. PATH is emptied so the assertion cannot be satisfied by a
        // global gjsify on the machine running this suite.
        const root = makeFixture({ warm: false, shim: true });
        try {
            const resolved = resolveGjsifySpawn(root, ['--version'], { platform: 'linux', env: { PATH: '' } });
            assert.equal(resolved, null);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('picks the workspace shim as soon as either target exists', () => {
        for (const targets of [{ warm: true }, { bundle: true }]) {
            const root = makeFixture({ warm: false, shim: true, ...targets });
            try {
                const resolved = resolveGjsifySpawn(root, ['--version'], { platform: 'linux', env: { PATH: '' } });
                assert.equal(resolved?.via, 'node_modules/.bin');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    });

    it('falls back to this tree’s own bundle, then to GJSIFY_BOOTSTRAP', () => {
        const bootstrapHost = makeFixture({ warm: false });
        const bootstrap = join(bootstrapHost, 'scripts', 'resolve-gjsify.mjs'); // any existing file
        const withBundle = makeFixture({ warm: false, bundle: true });
        const bare = makeFixture({ warm: false });
        try {
            // A built bundle in THIS tree outranks the published one: it is the
            // version the tree pins.
            const built = resolveGjsifySpawn(withBundle, ['--version'], {
                platform: 'linux',
                env: { PATH: '', GJSIFY_BOOTSTRAP: bootstrap },
            });
            assert.equal(built?.via, 'built bundle');
            assert.equal(built?.cmd, 'gjs');

            const fetched = resolveGjsifySpawn(bare, ['--version'], {
                platform: 'linux',
                env: { PATH: '', GJSIFY_BOOTSTRAP: bootstrap },
            });
            assert.equal(fetched?.via, 'GJSIFY_BOOTSTRAP');
            assert.deepEqual(fetched?.args, ['-m', bootstrap, '--version']);

            // A GJSIFY_BOOTSTRAP naming a file that is not there must not be
            // handed back — an unspawnable path is worse than no answer.
            const missing = resolveGjsifySpawn(bare, ['--version'], {
                platform: 'linux',
                env: { PATH: '', GJSIFY_BOOTSTRAP: join(bare, 'nope.gjs.mjs') },
            });
            assert.equal(missing, null);
        } finally {
            for (const r of [bootstrapHost, withBundle, bare]) rmSync(r, { recursive: true, force: true });
        }
    });

    it('covers every package the CLI resolves at RUN time', () => {
        // The edge `ensureCliEntryLinks()` cannot see, and the one that cost
        // v0.53.0 its `@gjsify/napi`: a RUNTIME `createRequire(…).resolve()` of a
        // sibling, which the bundler never inlines, so the package's own `lib/esm`
        // must already exist on a cold tree. A static import is not this hazard —
        // the CLI entry is a bundle — which is why the Node link probe passes and
        // the GJS-hosted `build:infra` still dies, reported as "no usable bundler
        // engine": it names the engine, never the package that is missing.
        //
        // So the list is checked against the SOURCES instead of trusted, over the
        // whole production closure of both toolchain roots — through the SAME scan
        // `check-build-infra-order.mjs` rule 5 orders with, because this suite used
        // to carry a third copy of it with its own roots list and its own two regexes,
        // and the copies disagreed: the rule's matched the one-line literal form
        // only, so the two-line `const specifier = '@gjsify/x'` that keeps tsc and
        // Rolldown off an optional peer read as "no runtime edge" to it.
        const script = readFileSync(join(MONOREPO_ROOT, 'scripts', 'bootstrap-native-facades.mjs'), 'utf8');
        const listed = new Set(
            (script.match(/const CLI_RUNTIME_DEPS = \[([^\]]*)\]/)?.[1] ?? '')
                .split(',')
                .map((n) => n.trim().replace(/^'|'$/g, ''))
                .filter(Boolean),
        );
        assert.ok(listed.size > 0, 'CLI_RUNTIME_DEPS did not parse — the assertion below would pass vacuously');

        // The positive fact, and the same refusal `check-build-infra-order.mjs`
        // makes: a scan that resolved nothing is a scan whose pattern stopped
        // matching, and an empty `missing` would then read as a tree that is fine.
        const { deps, scanned } = offDiskToolchainDeps(MONOREPO_ROOT);
        assert.ok(scanned > 0, 'the shared scan covered no toolchain package — the list below would pass vacuously');
        assert.ok(deps.size > 0, `the shared scan resolved no off-disk specifier across ${scanned} package(s)`);

        // Every carve-out carries the reason it holds, so the set cannot grow into a
        // blanket: an entry with a reason is a claim, an entry without is a shrug.
        for (const [name, reason] of NOT_OWED) {
            assert.equal(typeof reason, 'string', `${name} is exempt with no reason`);
            assert.ok(
                reason.length > 40,
                `${name} is exempt with a reason too short to be one: ${JSON.stringify(reason)}`,
            );
        }

        // The facades build themselves, so `CLI_RUNTIME_DEPS` must not list them —
        // and the exemption is the SHARED one, not a second hand-kept set here.
        const exempt = new Set([...FACADE_PACKAGES, ...NOT_OWED.keys()]);
        const missing = [];
        for (const [name, { file }] of deps) {
            if (!listed.has(name.slice('@gjsify/'.length)) && !exempt.has(name)) missing.push(`${name} (${file})`);
        }
        assert.deepEqual(
            missing,
            [],
            'these packages are resolved at RUN time (so the bundler never inlines them) but no CLI_RUNTIME_DEPS ' +
                'entry builds their lib/esm, so a cold tree cannot finish — the GJS-hosted build:infra reports it ' +
                'as "no usable bundler engine", naming the engine instead of the package. Add each to ' +
                `CLI_RUNTIME_DEPS in scripts/bootstrap-native-facades.mjs.\n  ${missing.join('\n  ')}`,
        );
    });

    it('refuses to recurse: a marked child with no entry fails loudly', () => {
        // `build:infra` ENDS by running this same script, so without the marker
        // a still-missing entry would spawn `build:infra` again, forever. The
        // marked child must report the real problem instead — the chain's own
        // `gjsify workspace @gjsify/cli build` step failed to produce it.
        const root = makeFixture({ warm: false });
        try {
            const { status, output } = run(root, { env: { [NO_RECURSE_ENV]: '1' }, expectFail: true });
            assert.equal(status, 1);
            assert.match(output, /still not found after/);
            assert.match(output, /gjsify workspace @gjsify\/cli build/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
