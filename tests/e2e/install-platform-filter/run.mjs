// E2E test for `gjsify install` OS/CPU/LIBC FILTERING.
//
// The defect: the resolver placed every optionalDependency a packument listed
// and never read the version's `os`/`cpu`/`libc`. Measured on a cold tree of
// this workspace: 183 foreign-platform packages / 3361 MB plus 9 musl-only
// packages / 308 MB — 3.67 GB of a 5.6 GB node_modules that npm would never
// have written.
//
// WHAT THIS ASSERTS IS THE FILTERING, NEVER THE HOST. Every run passes an
// explicit `--os/--cpu/--libc` (npm's config keys), so one Linux/glibc machine
// exercises the musl, arm64 and darwin branches and the expectations are fixed
// values rather than "whatever this runner happens to be". A fixture that read
// the host could only ever cover one of the five variants below.
//
// Offline: an in-process HTTP registry serves the packuments + tarballs, like
// its neighbours `native-install/` and `install-lock-preserve/` (whose tar
// helpers and `runCli` shape this reuses). `XDG_CACHE_HOME` is redirected into
// the temp dir so the packument/tarball caches are per-run and the user's real
// cache is neither read nor written.
//
// Four properties, one per requirement:
//   (a) a foreign-platform optional dep is RECORDED in the lockfile but not
//       extracted — the lockfile stays portable;
//   (b) `--libc=musl` and `--libc=glibc` select DIFFERENT variants from the
//       SAME lockfile (copied between projects, installed with --immutable);
//   (c) an incompatible REQUIRED dep FAILS (EBADPLATFORM), and `--force`
//       installs it anyway;
//   (d) `libc` only exists in the FULL packument, so the resolver reads the full
//       document for EVERY package — and the metadata cache keys the two shapes
//       apart, since one registry ETag covers both.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCKFILE_VERSION } from '../helpers.mjs';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

/**
 * The published corpus, as manifest fields per version. `libc` IS declared here
 * and is stripped from the ABBREVIATED document on the way out (see the
 * `onPackument` hook) — that mirrors the live registry:
 * `lightningcss-linux-x64-musl@1.33.0` returns `{os,cpu}` under the corgi accept
 * header and `{os,cpu,libc}` under `application/json`.
 */
const CORPUS = {
    'plat-app': {
        '1.0.0': {
            optionalDependencies: {
                'plat-bin-linux-x64-gnu': '^1.0.0',
                'plat-bin-linux-x64-musl': '^1.0.0',
                'plat-bin-darwin-arm64': '^1.0.0',
            },
        },
    },
    'plat-bin-linux-x64-gnu': { '1.0.0': { os: ['linux'], cpu: ['x64'], libc: ['glibc'] } },
    'plat-bin-linux-x64-musl': { '1.0.0': { os: ['linux'], cpu: ['x64'], libc: ['musl'] } },
    'plat-bin-darwin-arm64': { '1.0.0': { os: ['darwin'], cpu: ['arm64'] } },
    // A REQUIRED dependency no linux host can run — property (c).
    'win-only': { '1.0.0': { os: ['win32'] } },
};

/** The corpus with the fields every entry shares filled in. */
const PACKAGES = Object.fromEntries(
    Object.entries(CORPUS).map(([name, versions]) => [
        name,
        Object.fromEntries(
            Object.entries(versions).map(([version, meta]) => [
                version,
                {
                    main: 'index.js',
                    dependencies: {},
                    optionalDependencies: {},
                    ...meta,
                    files: { 'index.js': `module.exports = ${JSON.stringify({ name, version })};\n` },
                },
            ]),
        ),
    ]),
);

describe('gjsify install — os/cpu/libc filtering', { timeout: 180_000 }, () => {
    let registry, registryUrl, cliEntry, tmpRoot, baseEnv;
    /** Which document shapes were requested per package name, for property (d). */
    let requestedShapes;

    before(async () => {
        requestedShapes = new Map();
        registry = await startMockRegistry(PACKAGES, {
            onRequest: (req, res) => {
                const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
                if (!PACKAGES[name]) return false;

                // Recorded BEFORE the 304 branch, so a conditional request still
                // counts as a request for that shape — which is what property (d)
                // is about.
                const shape = String(req.headers.accept ?? '').includes('application/vnd.npm.install-v1+json')
                    ? 'corgi'
                    : 'full';
                let shapes = requestedShapes.get(name);
                if (!shapes) {
                    shapes = new Set();
                    requestedShapes.set(name, shapes);
                }
                shapes.add(shape);

                // ONE ETag for BOTH shapes — not laziness, this is what the npm
                // registry does: its ETag derives from the CouchDB document
                // `_rev`, which is a property of the package, not of the
                // representation. So a metadata cache that does not key on the
                // shape sends a corgi ETag on a full request, gets a 304, and
                // serves the abbreviated body — losing `libc` while reporting a
                // cache hit. That is the failure this fixture pins.
                const etag = `"rev-1-${name}"`;
                if (req.headers['if-none-match'] === etag) {
                    res.writeHead(304, { etag });
                    res.end();
                    return true;
                }
                // Set and fall through: `writeHead` merges with headers already
                // set, so the default packument route keeps this one.
                res.setHeader('etag', etag);
                return false;
            },
            onPackument: (doc, { req }) => {
                const corgi = String(req.headers.accept ?? '').includes('application/vnd.npm.install-v1+json');
                // THE POINT OF THIS FIXTURE: libc is served ONLY in the full
                // document. A resolver that trusts the abbreviated one judges
                // every musl-only package installable on glibc.
                if (corgi) for (const v of Object.values(doc.versions)) delete v.libc;
            },
        });
        registryUrl = registry.url;

        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platform-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        baseEnv = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            // Per-run caches: the packument cache is load-bearing here (property
            // d), and the user's real cache must not leak into or out of the run.
            XDG_CACHE_HOME: join(tmpRoot, 'cache'),
            GJSIFY_NO_VERSION_SKEW_WARNING: '1',
            // The ambient environment must not decide the target — every case
            // passes its own flags.
            npm_config_os: '',
            npm_config_cpu: '',
            npm_config_libc: '',
            npm_config_force: '',
        };
    });

    after(async () => {
        await registry?.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    /** A throwaway project declaring `deps`, in its own prefix. */
    function project(name, deps) {
        const dir = join(tmpRoot, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '0.1.0', private: true, type: 'commonjs', ...deps }, null, 2) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
        return dir;
    }

    const installed = (dir, pkg) => existsSync(join(dir, 'node_modules', pkg, 'package.json'));
    const lockOf = (dir) => JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));

    it('(a) records the foreign-platform optional deps but installs only the matching one', async () => {
        const dir = project('glibc-target', { dependencies: { 'plat-app': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'], {
            timeoutMs: 60_000,
            cwd: dir,
            env: baseEnv,
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        const lock = lockOf(dir);
        // v3 introduced the platform fields this suite is about; v4 adds the per-entry
        // `optionalDependencies` map, without which the optionality fixpoint cannot see
        // WHICH of an entry's edges are optional and a name declared in both blocks
        // comes out required. A fresh resolve therefore always writes the current
        // version — asserting the older one here would pin the format, not the fields.
        assert.equal(lock.lockfileVersion, LOCKFILE_VERSION, 'lockfile must be the version the writer records');

        // RESOLVED for every platform: all four packages are pinned, with their
        // declarations recorded, so this file installs correctly on any host.
        for (const pkg of ['plat-app', 'plat-bin-linux-x64-gnu', 'plat-bin-linux-x64-musl', 'plat-bin-darwin-arm64']) {
            assert.ok(lock.packages[`node_modules/${pkg}`], `lockfile must pin ${pkg} regardless of the target`);
        }
        assert.deepEqual(lock.packages['node_modules/plat-bin-darwin-arm64'].os, ['darwin']);
        assert.deepEqual(lock.packages['node_modules/plat-bin-darwin-arm64'].cpu, ['arm64']);
        assert.equal(lock.packages['node_modules/plat-bin-darwin-arm64'].optional, true);
        // libc reached the lockfile, which is only possible via the full document.
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-musl'].libc, ['musl']);
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-gnu'].libc, ['glibc']);
        // A package with no platform declaration carries no platform fields.
        assert.equal(lock.packages['node_modules/plat-app'].os, undefined);
        assert.equal(lock.packages['node_modules/plat-app'].libc, undefined);

        // INSTALLED for one: only the glibc variant is on disk.
        assert.ok(installed(dir, 'plat-app'), 'the app itself must install');
        assert.ok(installed(dir, 'plat-bin-linux-x64-gnu'), 'the matching variant must install');
        assert.equal(installed(dir, 'plat-bin-linux-x64-musl'), false, 'a musl-only package must not be extracted');
        assert.equal(installed(dir, 'plat-bin-darwin-arm64'), false, 'a darwin-only package must not be extracted');

        // The skip is recoverable from the verbose log with npm's payload shape.
        assert.match(r.stderr, /platform-skip: plat-bin-darwin-arm64@1\.0\.0/);
        assert.match(r.stderr, /current=\{"os":"linux","cpu":"x64","libc":"glibc"\}/);
    });

    it('(d) reads the FULL document for every package, declaration or not', async () => {
        // Set by the run above — one resolve, every name it touched.
        //
        // THIS ASSERTION USED TO BE ITS OWN INVERSE: it required `['corgi']` for
        // `plat-app` and escalation only for a package that declares `os`/`cpu`.
        // That rule reads as a tidy optimisation and has a hole the corpus above
        // cannot show, because the hole is a package shape it does not contain:
        // the abbreviated body omits `libc`, so it can never PROVE that a version
        // carries no libc restriction, and the nine `@gjsify/*` native bridges
        // declare `libc: ["glibc"]` with NO `os`/`cpu` at all. Under the old rule
        // they were never escalated — on Alpine the installer handed a glibc-only
        // prebuild to a musl host and failed at `dlopen` instead of at install
        // time. Every "escalate only where it can matter" predicate has some
        // version of that hole; one authoritative document per package has none.
        // Measured cost of the swap: ~1.10× the metadata bytes and ~0.89× the
        // requests of the corgi-plus-escalate shape it replaced.
        assert.ok(requestedShapes.has('plat-app'), 'the fixture must exercise a package with no declaration');
        for (const [name, shapes] of requestedShapes) {
            assert.deepEqual([...shapes], ['full'], `${name} must be read from the full document, exactly once`);
        }
    });

    it('(d) a re-resolve keeps libc — the metadata cache keys the two shapes apart', async () => {
        // Second resolve over a WARM packument cache, with the registry answering
        // 304 to both shapes under one ETag. A shape-blind cache serves the
        // abbreviated body to the escalated read, `libc` vanishes, and the musl
        // variant lands on disk — a wrong answer that looks like a cache hit.
        const dir = join(tmpRoot, 'glibc-target');
        const r = await runCli(
            cliEntry,
            ['install', '--refresh-lockfile', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'],
            { timeoutMs: 60_000, cwd: dir, env: baseEnv },
        );
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.match(r.stderr, /packument-cache-hit: plat-bin-linux-x64-musl \(full, 304/);
        const lock = lockOf(dir);
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-musl'].libc, ['musl']);
        assert.equal(installed(dir, 'plat-bin-linux-x64-musl'), false);
    });

    it('(b) the SAME lockfile installs the musl variant under --libc=musl', async () => {
        // Portability, end to end: the lockfile resolved on the glibc target above
        // is copied verbatim (as a commit would) and installed with --immutable,
        // which consumes it without re-resolving. The verdict is recomputed for
        // THIS target, so the selected variant flips.
        const dir = project('musl-target', { dependencies: { 'plat-app': '^1.0.0' } });
        copyFileSync(join(tmpRoot, 'glibc-target', 'gjsify-lock.json'), join(dir, 'gjsify-lock.json'));
        const r = await runCli(
            cliEntry,
            ['install', '--immutable', '--os=linux', '--cpu=x64', '--libc=musl', '--verbose'],
            { timeoutMs: 60_000, cwd: dir, env: baseEnv },
        );
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'plat-bin-linux-x64-musl'), '--libc=musl must select the musl variant');
        assert.equal(installed(dir, 'plat-bin-linux-x64-gnu'), false, 'the glibc variant must now be inert');
        assert.equal(installed(dir, 'plat-bin-darwin-arm64'), false);
        // --immutable must not rewrite the file it was handed.
        assert.deepEqual(lockOf(dir), lockOf(join(tmpRoot, 'glibc-target')));
    });

    it('(b) a darwin/arm64 target selects the darwin variant AND records the linux libc', async () => {
        const dir = project('darwin-target', { dependencies: { 'plat-app': '^1.0.0' } });
        requestedShapes = new Map();
        const r = await runCli(cliEntry, ['install', '--os=darwin', '--cpu=arm64', '--verbose'], {
            timeoutMs: 60_000,
            cwd: dir,
            env: baseEnv,
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'plat-bin-darwin-arm64'), 'the darwin variant must install');
        assert.equal(installed(dir, 'plat-bin-linux-x64-gnu'), false);
        assert.equal(installed(dir, 'plat-bin-linux-x64-musl'), false);

        // THE PORTABILITY PROPERTY, and this case used to assert its opposite:
        // that a non-linux target escalates NOTHING, because libc is meaningless
        // off linux. True of the VERDICT, false of the RECORD — and the two are
        // deliberately different things here. A macOS developer's lockfile is
        // consumed by Linux colleagues; written without `libc` it gives them no
        // libc filtering at all, and the musl-only package they must skip is
        // judged installable. The old assertion PINNED that outcome, so the
        // resolve is now target-blind and this reads the way round it should.
        const lock = lockOf(dir);
        assert.deepEqual(
            lock.packages['node_modules/plat-bin-linux-x64-musl'].libc,
            ['musl'],
            'a darwin-authored lockfile must still carry the linux libc, or it is a machine snapshot',
        );
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-gnu'].libc, ['glibc']);

        // Strongest form of the same claim: byte-for-byte the file the glibc
        // target produced from the same manifest. If the resolve ever learns
        // anything about the host again, this is what notices.
        assert.deepEqual(lock, lockOf(join(tmpRoot, 'glibc-target')), 'the resolve must be target-blind');
    });

    it('(c) an incompatible REQUIRED dependency fails with EBADPLATFORM', async () => {
        const dir = project('required-mismatch', { dependencies: { 'win-only': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--os=linux', '--cpu=x64', '--libc=glibc'], {
            timeoutMs: 60_000,
            cwd: dir,
            env: baseEnv,
        });
        assert.notEqual(r.status, 0, 'a required dep the target cannot run must fail the install');
        const output = `${r.stderr}${r.stdout}`;
        assert.match(output, /Unsupported platform for win-only@1\.0\.0/);
        assert.match(output, /win32/, 'the message must name what was required');
        assert.equal(installed(dir, 'win-only'), false);
    });

    it('(c) --force installs an incompatible REQUIRED dependency anyway', async () => {
        const dir = project('required-forced', { dependencies: { 'win-only': '^1.0.0' } });
        const args = ['install', '--force', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'];
        const r = await runCli(cliEntry, args, { timeoutMs: 60_000, cwd: dir, env: baseEnv });
        assert.equal(r.status, 0, `--force must bypass the check: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'win-only'), '--force must install the incompatible required dep');
    });

    it('(c) an incompatible OPTIONAL top-level dep is skipped, not fatal', async () => {
        // The `optionalDependencies: { fsevents }` shape: npm leaves it out on
        // linux and installs fine. The specs reaching the backend are flat
        // strings, so the KIND travels beside them — get that wrong and this
        // install fails instead of thinning.
        const dir = project('optional-mismatch', { optionalDependencies: { 'win-only': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'], {
            timeoutMs: 60_000,
            cwd: dir,
            env: baseEnv,
        });
        assert.equal(r.status, 0, `an optional platform mismatch must not fail: ${r.stderr}\n${r.stdout}`);
        assert.equal(installed(dir, 'win-only'), false);
        const lock = lockOf(dir);
        assert.equal(lock.packages['node_modules/win-only'].optional, true, 'it must still be pinned, as optional');
    });

    it('reads the same target from the npm_config_* env keys', async () => {
        // The flags ARE npm config keys; `npm_config_libc=musl gjsify install` is
        // the same input as `--libc=musl`. Pinned because that equivalence is
        // what lets the flags be a thin wrapper rather than a second mechanism.
        const dir = project('env-target', { dependencies: { 'plat-app': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--verbose'], {
            timeoutMs: 60_000,
            cwd: dir,
            env: { ...baseEnv, npm_config_os: 'linux', npm_config_cpu: 'x64', npm_config_libc: 'musl' },
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'plat-bin-linux-x64-musl'));
        assert.equal(installed(dir, 'plat-bin-linux-x64-gnu'), false);
    });
});
