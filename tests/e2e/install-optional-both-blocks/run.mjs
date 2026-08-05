// E2E test for the REAL package that broke `gjsify install`: a napi parent whose
// per-platform binary packages are declared in BOTH `dependencies` and
// `optionalDependencies`.
//
// THE DEFECT, against the live registry: a project whose only dependency is
// `@parcel/rust@2.16.4` failed with
//   {"code":"EBADPLATFORM","pkgid":"@parcel/rust-darwin-x64@2.16.4",
//    "current":{"os":"linux","cpu":"x64","libc":"glibc"},"required":{"os":["darwin"]…}}
// while `npm install` on the same manifest exits 0, installs `@parcel/rust` plus
// `@parcel/rust-linux-x64-gnu`, and records the other seven as `"optional": true`.
// npm's rule: "entries in optionalDependencies will override entries of the same
// name in dependencies" — so those eight edges are OPTIONAL, and an incompatible
// optional dep is inert, not fatal.
//
// WHY THE FIXTURE IS THE REAL PACKAGE AND NOT A MOCK. `install-platform-filter/`
// already covers the filtering rules exhaustively, offline, with an in-process
// registry — and it passed throughout, because its corpus declares the platform
// binaries in ONE block, which is the shape every mock reaches for. The bug lived
// in the gap between the mock corpus and what publishers actually ship. So this
// suite spends the network to pin the shape itself: `@parcel/rust@2.16.4` is an
// immutable, exact-pinned published manifest, and if npm ever unpublishes it the
// row skips rather than lies (see `probeRegistry`).
//
// NETWORK-GUARDED: unreachable registry ⇒ skip, never fail. Nothing here asserts
// anything about a host, so the target is pinned with `--os/--cpu/--libc` and one
// Linux runner exercises the same verdict every other runner would.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** The committed GJS bundle — what a user runs, and what the defect shipped in. */
const GJS_BUNDLE = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
/** The same CLI from source, for hosts without gjs (Windows has no libgjs). */
const NODE_ENTRY = join(REPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

const PARENT = '@parcel/rust';
const VERSION = '2.16.4';
/** The sibling this Linux/glibc target must install… */
const MATCHING = '@parcel/rust-linux-x64-gnu';
/** …and one it must not, which is what used to abort the install. */
const FOREIGN = '@parcel/rust-darwin-x64';

function hasGjs() {
    try {
        execFileSync('gjs', ['--version'], { stdio: 'ignore', timeout: 15_000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Is the registry reachable AND does it still serve the pinned fixture with the
 * shape this suite is about? Both halves matter: a green run must mean the rule
 * held for a manifest declaring the same name in both blocks, so if that stops
 * being true of `@parcel/rust@2.16.4` the suite skips instead of asserting
 * something else by accident.
 */
async function probeRegistry() {
    let body;
    try {
        const res = await fetch(`https://registry.npmjs.org/${PARENT.replace('/', '%2f')}/${VERSION}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return `registry answered ${res.status} for ${PARENT}@${VERSION}`;
        body = await res.json();
    } catch (e) {
        return `registry unreachable (${e.message})`;
    }
    const deps = Object.keys(body.dependencies ?? {});
    const optional = Object.keys(body.optionalDependencies ?? {});
    if (!deps.includes(FOREIGN) || !optional.includes(FOREIGN)) {
        return `${PARENT}@${VERSION} no longer declares ${FOREIGN} in BOTH blocks — fixture stale`;
    }
    return null;
}

function runInstall(cwd, args, env) {
    const useGjs = existsSync(GJS_BUNDLE) && hasGjs();
    const [cmd, argv] = useGjs ? ['gjs', ['-m', GJS_BUNDLE, ...args]] : [process.execPath, [NODE_ENTRY, ...args]];
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const kill = setTimeout(() => child.kill('SIGKILL'), 300_000);
        child.on('close', (status) => {
            clearTimeout(kill);
            resolve({ status, stdout, stderr, runner: useGjs ? 'gjs bundle' : 'node lib' });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

describe('gjsify install — optionalDependencies overriding dependencies', { timeout: 600_000 }, () => {
    let tmpRoot;
    let baseEnv;
    /** Non-null ⇒ every row skips with this reason. */
    let skipReason;

    before(async () => {
        skipReason = await probeRegistry();
        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-both-blocks-'));
        baseEnv = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            // Per-run caches: the fixture is a 50 MB binary package, and the point
            // is a clean resolve, not a warm one. The user's real cache is neither
            // read nor written.
            XDG_CACHE_HOME: join(tmpRoot, 'cache'),
            GJSIFY_NO_VERSION_SKEW_WARNING: '1',
            // The ambient environment must not decide the target — see below.
            npm_config_os: '',
            npm_config_cpu: '',
            npm_config_libc: '',
            npm_config_force: '',
        };
    });

    after(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    function project(name) {
        const dir = join(tmpRoot, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '0.0.0', private: true, dependencies: { [PARENT]: VERSION } }, null, 2) +
                '\n',
        );
        return dir;
    }

    const installed = (dir, pkg) => existsSync(join(dir, 'node_modules', pkg, 'package.json'));
    const lockOf = (dir) => JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));
    /** Pinned target, so the expectations below are fixed values, not host facts. */
    const LINUX = ['--os=linux', '--cpu=x64', '--libc=glibc'];

    it('installs @parcel/rust with only the matching platform sibling', async (t) => {
        if (skipReason) return t.skip(skipReason);
        const dir = project('parcel');
        const r = await runInstall(dir, ['install', ...LINUX, '--verbose'], baseEnv);
        assert.equal(r.status, 0, `install failed (${r.runner}): ${r.stderr.slice(-4000)}`);

        assert.ok(installed(dir, PARENT), 'the napi parent must install');
        assert.ok(installed(dir, MATCHING), 'the matching platform sibling must install');
        assert.equal(installed(dir, FOREIGN), false, 'a darwin-only sibling must not be extracted');
        // The skip has to be recoverable from --verbose — silence here is what made
        // the mirror-image defect (3.67 GB of foreign binaries) invisible.
        assert.match(r.stderr, new RegExp(`platform-skip: ${FOREIGN.replace('/', '\\/')}@${VERSION}`));

        // RESOLVED for every platform, INSTALLED for one: all eight siblings stay
        // pinned so the file is portable, each flagged optional.
        const lock = lockOf(dir);
        assert.equal(lock.lockfileVersion, 4, 'edge kinds need lockfile v4');
        assert.equal(lock.packages[`node_modules/${FOREIGN}`].optional, true);
        assert.equal(lock.packages[`node_modules/${MATCHING}`].optional, true);
        assert.equal(lock.packages[`node_modules/${PARENT}`].optional, undefined, 'the parent is required');
        // The DECLARATION that makes the flag reproducible on the lockfile path,
        // recorded rather than derived away.
        assert.equal(
            typeof lock.packages[`node_modules/${PARENT}`].optionalDependencies?.[FOREIGN],
            'string',
            'the entry must record which of its edges are optional',
        );
    });

    it('reaches the same verdict from the lockfile alone (--immutable)', async (t) => {
        if (skipReason) return t.skip(skipReason);
        // The path a CI runs. It resolves nothing, so the optionality fixpoint has
        // only the file to work from — if the edge kinds were not persisted, this is
        // where the EBADPLATFORM comes back.
        const dir = project('parcel-frozen');
        writeFileSync(join(dir, 'gjsify-lock.json'), readFileSync(join(tmpRoot, 'parcel', 'gjsify-lock.json')));
        const r = await runInstall(dir, ['install', '--immutable', ...LINUX, '--verbose'], baseEnv);
        assert.equal(r.status, 0, `--immutable failed (${r.runner}): ${r.stderr.slice(-4000)}`);
        assert.ok(installed(dir, MATCHING));
        assert.equal(installed(dir, FOREIGN), false);
        // --immutable must not rewrite what it was handed.
        assert.deepEqual(lockOf(dir), lockOf(join(tmpRoot, 'parcel')));
    });

    it('self-heals a v3 lockfile left behind by the failing install', async (t) => {
        if (skipReason) return t.skip(skipReason);
        // The lockfile is written BEFORE the platform filter runs, so the broken
        // install committed its own diagnosis to disk: a v3 file with all eight
        // siblings and no edge kinds. Matching the request, it would short-circuit
        // the resolve forever and reproduce the failure on every later run — which
        // is why the version bump is part of the fix, not bookkeeping.
        const dir = project('parcel-stale-lock');
        const good = lockOf(join(tmpRoot, 'parcel'));
        const stale = { lockfileVersion: 3, requested: good.requested, packages: {} };
        for (const [path, entry] of Object.entries(good.packages)) {
            const { optionalDependencies, optional, ...rest } = entry;
            stale.packages[path] = rest;
        }
        writeFileSync(join(dir, 'gjsify-lock.json'), JSON.stringify(stale, null, 2) + '\n');

        const r = await runInstall(dir, ['install', ...LINUX, '--verbose'], baseEnv);
        assert.equal(r.status, 0, `a pre-v4 lockfile must be upgraded, not obeyed: ${r.stderr.slice(-4000)}`);
        assert.equal(lockOf(dir).lockfileVersion, 4);
        assert.ok(installed(dir, MATCHING));
        assert.equal(installed(dir, FOREIGN), false);
        // Version-preserving: the upgrade resolve must not bump anything.
        for (const [path, entry] of Object.entries(good.packages)) {
            assert.equal(lockOf(dir).packages[path].version, entry.version, `${path} must keep its pinned version`);
        }
    });

    it('still fails loudly when the SAME package is required for a foreign target', async (t) => {
        if (skipReason) return t.skip(skipReason);
        // The honest half, on the real fixture: ask for a target no sibling of this
        // tree can satisfy AND make the incompatible package required — a
        // dependency the host cannot run is a broken install, not a smaller one.
        // (`@parcel/rust-darwin-x64` as a DIRECT dependency is exactly that.)
        const dir = join(tmpRoot, 'parcel-required-foreign');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: 'req', version: '0.0.0', private: true, dependencies: { [FOREIGN]: VERSION } }) +
                '\n',
        );
        const r = await runInstall(dir, ['install', ...LINUX], baseEnv);
        assert.notEqual(r.status, 0, 'an incompatible REQUIRED dependency must fail');
        assert.match(`${r.stderr}${r.stdout}`, /EBADPLATFORM/);
        assert.equal(installed(dir, FOREIGN), false);
    });
});
