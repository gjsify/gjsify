// E2E test for `gjsify install` and REQUIRED peerDependencies.
//
// The defect: the native backend never read `peerDependencies`, while npm ≥ 7
// installs every peer not marked optional in `peerDependenciesMeta`. Measured in
// a consumer: devDependency `wxt@^0.21.4` installed cleanly (exit 0, 436
// packages) and `wxt prepare` then died with "Builder not found. Make sure vite
// is installed." — wxt declares `vite` as a REQUIRED peer and only
// eslint/web-ext/typescript as optional ones. `npm install` lays vite down.
//
// Offline: the shared in-process registry (`mock-registry.mjs`) serves the corpus
// below, and `XDG_CACHE_HOME` is per-run so the user's cache is neither read nor
// written.
//
// The rows, one per rule:
//   (a) a required peer is installed where the dependent resolves it, an OPTIONAL
//       peer is not (ADR 0020's `@gjsify/rolldown-native` relies on that), and a
//       peer's own required peer is installed too;
//   (b) a peer the tree already satisfies is REUSED — no second copy;
//   (c) a nested dependent gets its peer as a nested SIBLING when the root holds
//       an incompatible version;
//   (d) a conflict at the slot the peer must occupy warns and does not fail;
//   (e) the lockfile carries the peer edges, and `--immutable` reproduces the tree;
//   (f) a lockfile written before peers were resolved is re-resolved (version-
//       preserving) on a plain install, so an existing consumer gets the fix
//       without `--refresh-lockfile`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCKFILE_VERSION } from '../helpers.mjs';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

/** The wxt shape: one required peer, one optional peer, no regular deps. */
const HOST_PEERS = {
    peerDependencies: { 'peer-lib': '^2.0.0', 'peer-opt': '^1.0.0' },
    peerDependenciesMeta: { 'peer-opt': { optional: true } },
};

const CORPUS = {
    'peer-host': {
        '1.0.0': HOST_PEERS,
        // Nested by row (c): wants the OLD major of the peer the root copy of
        // `peer-host@1` pulls in at the new one.
        '2.0.0': { peerDependencies: { 'peer-lib': '^1.0.0' } },
    },
    'peer-lib': {
        '1.0.0': {},
        // A peer with a required peer of its own — the transitive half of (a).
        '2.0.0': { peerDependencies: { 'peer-core': '^3.0.0' } },
        '2.1.0': { peerDependencies: { 'peer-core': '^3.0.0' } },
    },
    'peer-core': { '3.0.0': {}, '3.1.0': {} },
    'peer-opt': { '1.0.0': {} },
    'nest-parent': { '1.0.0': { dependencies: { 'peer-host': '2.0.0' } } },
};

const PACKAGES = Object.fromEntries(
    Object.entries(CORPUS).map(([name, versions]) => [
        name,
        Object.fromEntries(
            Object.entries(versions).map(([version, meta]) => [
                version,
                {
                    main: 'index.js',
                    ...meta,
                    files: { 'index.js': `module.exports = ${JSON.stringify({ name, version })};\n` },
                },
            ]),
        ),
    ]),
);

describe('gjsify install — required peerDependencies', { timeout: 180_000 }, () => {
    let registry, registryUrl, cliEntry, tmpRoot, baseEnv;

    before(async () => {
        registry = await startMockRegistry(PACKAGES);
        registryUrl = registry.url;
        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-peers-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        baseEnv = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            XDG_CACHE_HOME: join(tmpRoot, 'cache'),
            GJSIFY_NO_VERSION_SKEW_WARNING: '1',
        };
    });

    after(async () => {
        await registry?.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    function project(name, fields) {
        const dir = join(tmpRoot, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '0.1.0', private: true, ...fields }, null, 2) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
        return dir;
    }

    const install = (dir, args = []) =>
        runCli(cliEntry, ['install', '--verbose', ...args], { timeoutMs: 60_000, cwd: dir, env: baseEnv });
    const versionAt = (dir, rel) => {
        const file = join(dir, rel, 'package.json');
        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')).version : null;
    };
    const lockOf = (dir) => JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));

    it('(a) installs a required peer and its own peer, skips an optional one', async () => {
        const dir = project('required', { devDependencies: { 'peer-host': '^1.0.0' } });
        const r = await install(dir);
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assert.equal(versionAt(dir, 'node_modules/peer-host'), '1.0.0');
        assert.equal(versionAt(dir, 'node_modules/peer-lib'), '2.1.0', 'the required peer must be installed');
        assert.equal(versionAt(dir, 'node_modules/peer-core'), '3.1.0', "the peer's own required peer too");
        assert.equal(versionAt(dir, 'node_modules/peer-opt'), null, 'an OPTIONAL peer must not be installed');
        assert.equal(lockOf(dir).packages['node_modules/peer-opt'], undefined, 'nor recorded');
    });

    it('(b) reuses a peer the root already provides instead of adding a copy', async () => {
        const dir = project('satisfied', { dependencies: { 'peer-host': '^1.0.0', 'peer-lib': '2.0.0' } });
        const r = await install(dir);
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assert.equal(versionAt(dir, 'node_modules/peer-lib'), '2.0.0', 'the root pin must win over newest-in-range');
        assert.equal(versionAt(dir, 'node_modules/peer-host/node_modules/peer-lib'), null, 'no second copy');
        const lock = lockOf(dir);
        assert.deepEqual(
            Object.keys(lock.packages).filter((p) => p.endsWith('/peer-lib')),
            ['node_modules/peer-lib'],
        );
        assert.equal(versionAt(dir, 'node_modules/peer-core'), '3.1.0');
    });

    it("(c) places a nested dependent's peer beside it when the root holds another major", async () => {
        const dir = project('nested', { dependencies: { 'peer-host': '^1.0.0', 'nest-parent': '^1.0.0' } });
        const r = await install(dir);
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assert.equal(versionAt(dir, 'node_modules/peer-lib'), '2.1.0', "the root dependent's peer stays hoisted");
        assert.equal(versionAt(dir, 'node_modules/nest-parent/node_modules/peer-host'), '2.0.0');
        // A SIBLING of the nested dependent, not a child of it: a peer is shared with
        // whatever requires the dependent, which is what makes it a peer.
        assert.equal(versionAt(dir, 'node_modules/nest-parent/node_modules/peer-lib'), '1.0.0');
        assert.equal(versionAt(dir, 'node_modules/nest-parent/node_modules/peer-host/node_modules/peer-lib'), null);
    });

    it('(d) warns on a conflicting peer and keeps the installed version', async () => {
        const dir = project('conflict', { dependencies: { 'peer-host': '^1.0.0', 'peer-lib': '1.0.0' } });
        const r = await install(dir);
        assert.equal(r.status, 0, `a peer conflict must not fail the install: ${r.stderr}\n${r.stdout}`);

        assert.equal(versionAt(dir, 'node_modules/peer-lib'), '1.0.0', 'the declared version stays');
        assert.equal(versionAt(dir, 'node_modules/peer-host/node_modules/peer-lib'), null, 'no private copy');
        assert.match(r.stderr, /peer dependency conflict: peer-host@1\.0\.0 wants peer-lib@\^2\.0\.0/);
    });

    it('(e) records the peer edges and reproduces the tree with --immutable', async () => {
        const source = join(tmpRoot, 'required');
        const lock = lockOf(source);
        assert.equal(lock.lockfileVersion, LOCKFILE_VERSION);
        assert.deepEqual(lock.packages['node_modules/peer-host'].peerDependencies, HOST_PEERS.peerDependencies);
        assert.deepEqual(lock.packages['node_modules/peer-host'].peerDependenciesMeta, HOST_PEERS.peerDependenciesMeta);
        // Reached through a required PEER edge only — so the optionality fixpoint must
        // walk peer edges, or this comes out optional on one path and not the other.
        assert.equal(lock.packages['node_modules/peer-lib'].optional, undefined, 'a required peer is required');
        assert.equal(lock.packages['node_modules/peer-core'].optional, undefined);

        const dir = project('frozen', { devDependencies: { 'peer-host': '^1.0.0' } });
        writeFileSync(join(dir, 'gjsify-lock.json'), readFileSync(join(source, 'gjsify-lock.json')));
        const r = await install(dir, ['--immutable']);
        assert.equal(r.status, 0, `--immutable failed: ${r.stderr}\n${r.stdout}`);
        assert.equal(versionAt(dir, 'node_modules/peer-lib'), '2.1.0');
        assert.equal(versionAt(dir, 'node_modules/peer-core'), '3.1.0');
        assert.equal(versionAt(dir, 'node_modules/peer-opt'), null);
        assert.deepEqual(lockOf(dir), lock, '--immutable must not rewrite the lockfile');
    });

    it('(f) re-resolves a lockfile written before peers were installed', async () => {
        // What every existing consumer holds: same format version, same request, and
        // no peer anywhere in it. Short-circuiting on it would keep the tree broken
        // until the user happened to change a dependency.
        const good = lockOf(join(tmpRoot, 'required'));
        const { peersResolved, ...rest } = good;
        assert.equal(peersResolved, true, 'the writer must mark a peer-aware resolve');
        const stale = { ...rest, packages: {} };
        for (const [path, entry] of Object.entries(good.packages)) {
            if (path === 'node_modules/peer-lib' || path === 'node_modules/peer-core') continue;
            const { peerDependencies, peerDependenciesMeta, ...kept } = entry;
            stale.packages[path] = kept;
        }

        const dir = project('stale', { devDependencies: { 'peer-host': '^1.0.0' } });
        writeFileSync(join(dir, 'gjsify-lock.json'), JSON.stringify(stale, null, 2) + '\n');
        const r = await install(dir);
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.equal(versionAt(dir, 'node_modules/peer-lib'), '2.1.0', 'the missing peer must arrive');
        assert.equal(versionAt(dir, 'node_modules/peer-core'), '3.1.0');
        assert.deepEqual(lockOf(dir), good, 'the rewritten lockfile equals a fresh peer-aware one');
    });
});
