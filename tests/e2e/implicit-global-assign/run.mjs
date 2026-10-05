// E2E: `implicit-global-assign` through the built CLI, on real Excalibur bytes, on both hosts.
//
// The plugin has a unit spec and its bundles were proven by hand on Node, Bun and Deno
// (#2018/#2021), but every proof stopped at the bytes or at a bundle built from the package
// `lib/`. Two gaps only a full CLI run closes:
//
//   1. ADR 0079 dropped the `window` define from `--app node`, so code that was green only
//      because the define supplied the binding came apart. Excalibur 0.32.0's shipped ESM
//      carries the shape — `if (typeof window === 'undefined') { window = <any>{…}; }`, called
//      from a top-level `polyfill()` — and an ES module body is strict, so the write is a
//      `ReferenceError: window is not defined` on every runtime without `window`. This suite
//      runs the bundle and gets exit 0; without the plugin it dies at LOAD, which is the
//      failure this file exists to make reproducible.
//   2. On the two targets that DO define `window` the define also rewrote the assignment
//      TARGET, so `window = {…}` became `globalThis = {…}` — the whole global object
//      replaced. That was only ever seen by reading bytes, which is why leg 2 RUNS the
//      `--app gjs` bundle under `gjs`. It does not crash, so the run proves the absence of
//      collateral damage and the byte assertion below is what covers the retarget.
//
// Each leg RUNS before it reads the bundle: the load is the claim, and the text checks are
// how a failure is NAMED. The other order reports a regex mismatch where the incident is a
// crash, which is the wrong 900 KB of evidence. `--no-minify` because those two assertions
// have to read the artifact rather than a mangled copy of it (`cjs-require-stream`'s call).
//
// The fixture is a `.mts` INSIDE the suite with its own `package.json` declaring
// `excalibur@0.32.0` as a dependency — following the same self-contained fixture
// convention as `tests/e2e/cjs-require-stream/` (which uses `createTestEnvironment` +
// `setupProject`). This avoids depending on another test package's hoisted devDep.
//
// `--globals node` ON THE GJS LEG: `--globals auto` sees Excalibur's
// `Audio`/`AudioContext`/`document`/`Image` and injects registers pulling
// `gi://Gdk`, `gi://GdkPixbuf`, `gi://Gst`, `gi://GstApp`, `gi://Manette`,
// `gi://Pango`, `gi://PangoCairo`, `gi://Gio`, `gi://GjsifyGamepad`, and `gi://Soup`
// into the bundle — eleven typelibs a suite about ONE assignment would then need at load,
// and would fail on a host carrying none of them. The `window` define under test belongs
// to the `--app gjs` TARGET, not to `--globals`, so narrowing the allowlist costs this
// suite nothing.
//
// WHAT THE GJS LEG CANNOT CLAIM, and why its STUB marker stays unasserted there: that target's
// define is `window → globalThis`, so Excalibur's guard `typeof window === 'undefined'` reads
// `typeof globalThis` and is false on every host. The branch that installs the stub is
// unreachable BY DESIGN there, with the plugin or without it — which is the second reason
// this leg asserts bytes: there is no runtime symptom to catch.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MONOREPO_ROOT, e2eSkipReason, hasCommand } from '../helpers.mjs';

const cliEntry = join(MONOREPO_ROOT, 'packages/infra/cli/lib/index.js');
const fixture = fileURLToPath(new URL('./fixture/excalibur.mts', import.meta.url));
const fixtureDir = fileURLToPath(new URL('./fixture/', import.meta.url));
const fixturePkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf-8'));
const EXCALIBUR_VERSION = fixturePkg.dependencies.excalibur;

/**
 * A bare `window = {` the plugin did not rewrite — the exact bytes that throw at load.
 *
 * The lookbehind is the whole assertion: `globalThis.window = {` also contains `window = {`,
 * so a naive match would flag the FIXED bundle. What must not survive is the un-prefixed one.
 */
const BARE_WINDOW_ASSIGN = /(?<![.\w])window = \{/;

/** What a leg asserts, and what it only reports: see `fixture/excalibur.mts` for the three. */
const marker = (name) => new RegExp(`IMPLICIT_GLOBAL_ASSIGN_${name}=true`);

/**
 * The bytes around `pattern`'s first hit, or `null` for no hit — because
 * `assert.doesNotMatch` on a 1.3 MB bundle prints the whole bundle, and a CI log that cannot
 * say which line failed is a log somebody has to re-run locally to read.
 */
function firstHit(bundle, pattern) {
    const at = bundle.search(pattern);
    if (at < 0) return null;
    return bundle.slice(Math.max(0, at - 30), at + 40).replace(/\n/g, ' ');
}

/** Build the fixture for one target, return the bundle path and its bytes. */
function build(outDir, app, extra = []) {
    const outfile = join(outDir, `excalibur.${app}.mjs`);
    execFileSync(
        process.execPath,
        [cliEntry, 'build', fixture, '--app', app, '--outfile', outfile, '--no-minify', ...extra],
        { cwd: MONOREPO_ROOT, stdio: 'pipe', timeout: 10 * 60 * 1000 },
    );
    return { bundle: readFileSync(outfile, 'utf-8'), outfile };
}

let outDir;

describe(
    'implicit-global-assign — an implicit global write survives the CLI and both hosts',
    {
        // A `gjs` host is the whole of leg 2; without one this suite would measure a build
        // and claim the runtime, which is the gap #2022 exists to close.
        skip: e2eSkipReason('implicit-global-assign', [['a gjs host', hasCommand('gjs')]]),
        timeout: 30 * 60 * 1000,
    },
    () => {
        before(() => {
            outDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-iga-'));
            // Install the fixture's declared dependency (excalibur@0.32.0) so the build
            // resolves it from the fixture's own node_modules, not from a hoisted devDep
            // of another test package. This follows the self-contained fixture convention
            // established by `tests/e2e/cjs-require-stream/`.
            execSync('npm install', { cwd: fixtureDir, stdio: 'pipe', timeout: 60 * 1000 });
        });

        after(() => {
            rmSync(outDir, { recursive: true, force: true });
        });

        it(`resolves the excalibur@${EXCALIBUR_VERSION} the fixture was written against`, () => {
            const installed = JSON.parse(
                readFileSync(join(fixtureDir, 'node_modules', 'excalibur', 'package.json'), 'utf-8'),
            );
            assert.equal(installed.version, EXCALIBUR_VERSION);
        });

        it('runs the --app node bundle on Node, where the implicit write is a ReferenceError', () => {
            const { bundle, outfile } = build(outDir, 'node');

            const out = execFileSync(process.execPath, [outfile], { encoding: 'utf-8', timeout: 5 * 60 * 1000 });
            assert.match(out, marker('VECTOR'), 'the bundle must run its own module body');
            assert.match(out, marker('GLOBALS_INTACT'));
            // The Node leg is where STUB is a claim rather than a report: no `window` exists
            // here, so the guard ran, and the plugin's rewrite is the only reason it could.
            assert.match(out, marker('STUB'), "the author's window stub must be reachable");

            assert.equal(firstHit(bundle, BARE_WINDOW_ASSIGN), null, 'an un-prefixed `window = {` throws at load');
        });

        it('runs the --app gjs bundle under gjs, where the define used to eat the assignment', () => {
            const { bundle, outfile } = build(outDir, 'gjs', ['--globals', 'node']);

            const out = execFileSync('gjs', ['-m', outfile], { encoding: 'utf-8', timeout: 5 * 60 * 1000 });
            assert.match(out, marker('VECTOR'), 'the bundle must run its own module body');
            assert.match(out, marker('GLOBALS_INTACT'), 'globalThis must survive the module load');

            assert.equal(firstHit(bundle, BARE_WINDOW_ASSIGN), null);
            // ADR 0079's addendum: the plugin's transform runs BEFORE the define, so the
            // define finds no target left. Nothing CRASHES when this regresses — see the
            // header — so this assertion is the whole of the leg's coverage of it.
            assert.equal(firstHit(bundle, /globalThis = \{/), null, 'the window define must never retarget the write');
        });
    },
);
