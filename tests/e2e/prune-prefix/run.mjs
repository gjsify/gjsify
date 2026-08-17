// E2E: `gjsify prune`, and the automatic pass that runs after an install.
//
// The unit suite decides the rules from injected values; this one drives the real
// command against a real prefix, because what it must prove is the part no pure
// function can: that a foreign-platform directory an EARLIER install put on disk is
// actually gone afterwards, and that the automatic pass refuses when the target was
// typed rather than measured.
//
// The target is injected through `npm_config_os`/`npm_config_cpu`, so one Linux
// runner exercises both directions: install AS darwin (landing a darwin package
// this host cannot use), then prune AS the host.
//
// Uses the shared harness (`startMockRegistry`, `runCli`) rather than a private
// registry — `scripts/check-e2e-harness-duplication.mjs` exists because that block
// was copy-pasted into a dozen suites and drifted.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

const CLI_ENTRY = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

// `demo-tool` optionally depends on one binding per platform. Only the one matching
// the install target lands — that is `applyPlatformFilter` doing its job — so
// installing twice against two targets is what produces the residue this suite
// prunes. `demo-bin-any` declares NO platform and must survive every prune.
const PACKAGES = {
    'demo-tool': {
        '1.0.0': {
            optionalDependencies: {
                'demo-bin-linux-x64': '1.0.0',
                'demo-bin-darwin-arm64': '1.0.0',
                'demo-bin-any': '1.0.0',
            },
        },
    },
    'demo-bin-linux-x64': { '1.0.0': { os: ['linux'], cpu: ['x64'], files: { 'blob.bin': 'L'.repeat(4096) } } },
    'demo-bin-darwin-arm64': { '1.0.0': { os: ['darwin'], cpu: ['arm64'], files: { 'blob.bin': 'D'.repeat(4096) } } },
    'demo-bin-any': { '1.0.0': { files: { 'blob.bin': 'A'.repeat(4096) } } },
};

describe('gjsify prune', { timeout: 120_000 }, () => {
    let registry, tmpRoot, baseEnv;

    before(async () => {
        registry = await startMockRegistry(PACKAGES);
        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-prune-'));
        baseEnv = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registry.url,
            GJSIFY_GLOBAL_PREFIX: join(tmpRoot, 'global'),
            GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin'),
            XDG_CACHE_HOME: join(tmpRoot, 'cache'),
            GJSIFY_NO_VERSION_SKEW_WARNING: '1',
            // The ambient environment must not decide the target — each case passes
            // its own.
            npm_config_os: '',
            npm_config_cpu: '',
            npm_config_libc: '',
            npm_config_force: '',
        };
    });

    after(async () => {
        if (registry) await registry.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    const globalPrefix = () => join(tmpRoot, 'global');
    const pkgDir = (name) => join(globalPrefix(), 'node_modules', name);

    /** Install globally, resolving AS the given target. */
    function installAs(os, cpu, extra = []) {
        return runCli(CLI_ENTRY, ['install', '-g', 'demo-tool', ...extra], {
            cwd: tmpRoot,
            env: { ...baseEnv, npm_config_os: os, npm_config_cpu: cpu },
            timeoutMs: 90_000,
        });
    }

    function prune(args, env = {}) {
        return runCli(CLI_ENTRY, ['prune', '-g', ...args], {
            cwd: tmpRoot,
            env: { ...baseEnv, ...env },
            timeoutMs: 60_000,
        });
    }

    it('an install AS darwin lands the darwin binding on this linux host', async () => {
        // The residue every later case is about. `--no-prune` because THIS install is
        // the one creating it, and the automatic pass would refuse anyway (the target
        // is overridden) — passing it makes that independent of the guard.
        const r = await installAs('darwin', 'arm64', ['--no-prune']);
        assert.equal(r.status, 0, r.stderr);
        assert.ok(existsSync(pkgDir('demo-bin-darwin-arm64')), 'darwin binding should have been installed');
        assert.ok(
            !existsSync(pkgDir('demo-bin-linux-x64')),
            'the linux binding is filtered out by an AS-darwin install',
        );
        assert.ok(existsSync(pkgDir('demo-bin-any')), 'a package declaring no platform always lands');
    });

    it('--dry-run names the foreign package and removes nothing', async () => {
        const r = await prune(['--dry-run']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /demo-bin-darwin-arm64/);
        assert.match(r.stdout, /would free/);
        assert.ok(existsSync(pkgDir('demo-bin-darwin-arm64')), 'a dry run must not touch the filesystem');
    });

    it('removes exactly the package this host cannot use', async () => {
        const r = await prune([]);
        assert.equal(r.status, 0, r.stderr);
        assert.ok(!existsSync(pkgDir('demo-bin-darwin-arm64')), 'the darwin binding should be gone');
        assert.ok(existsSync(pkgDir('demo-tool')), 'the tool itself is usable here and must stay');
        // The wasm32-wasi shape: unusable in practice, declares nothing, so no rule
        // this command has can justify deleting it.
        assert.ok(existsSync(pkgDir('demo-bin-any')), 'a package declaring no platform is never pruned');
        assert.match(r.stdout, /freed/);
    });

    it('is idempotent — a second run reports nothing to do and still exits 0', async () => {
        const r = await prune([]);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /nothing to prune/);
    });

    it('honours an explicitly typed target, which is the opposite of what an install may do', async () => {
        // Asking to see what a darwin-arm64 host could not use is a REQUEST. The same
        // values inherited by an install would be a catastrophe, which is what the
        // next case pins. Seeded here rather than relying on a previous case's
        // leftovers, so the assertion means the same thing whatever ran before it.
        const seed = await installAs('linux', 'x64', ['--no-prune']);
        assert.equal(seed.status, 0, seed.stderr);

        const r = await prune(['--os=darwin', '--cpu=arm64', '--dry-run']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /target darwin-arm64/);
        assert.match(r.stdout, /demo-bin-linux-x64/, 'the typed target is what decides, not the host');
        assert.ok(existsSync(pkgDir('demo-bin-linux-x64')), 'still a dry run');
    });

    it('the automatic pass REFUSES when the install target was overridden', async () => {
        // The data-loss path: `install -g … --os=darwin` reaching a prune that then
        // deletes every linux package in the user's real shared prefix. First put a
        // linux package in the prefix, then install AS darwin WITHOUT --no-prune.
        const seed = await installAs('linux', 'x64', ['--no-prune']);
        assert.equal(seed.status, 0, seed.stderr);
        assert.ok(existsSync(pkgDir('demo-bin-linux-x64')), 'the linux binding should be installed');

        const r = await installAs('darwin', 'arm64');
        assert.equal(r.status, 0, r.stderr);
        assert.ok(
            existsSync(pkgDir('demo-bin-linux-x64')),
            'an install with a TYPED target must never prune against it — the host still needs this',
        );
        assert.doesNotMatch(r.stdout, /pruned \d+ package/);
    });

    it('the automatic pass DOES run on a plain install, and says what it freed', async () => {
        // Same prefix, now holding a darwin binding from the case above, installed
        // with no target flags at all — so the pass acts on the measured host.
        assert.ok(existsSync(pkgDir('demo-bin-darwin-arm64')), 'precondition: the darwin binding is present');
        const r = await runCli(CLI_ENTRY, ['install', '-g', 'demo-tool'], {
            cwd: tmpRoot,
            env: baseEnv,
            timeoutMs: 90_000,
        });
        assert.equal(r.status, 0, r.stderr);
        assert.ok(!existsSync(pkgDir('demo-bin-darwin-arm64')), 'the automatic pass should have removed it');
        assert.match(r.stdout, /pruned 1 package\(s\)/);
        assert.ok(existsSync(pkgDir('demo-bin-linux-x64')), 'and must not have touched the usable one');
    });

    it('--no-prune leaves the residue in place', async () => {
        const seed = await installAs('darwin', 'arm64', ['--no-prune']);
        assert.equal(seed.status, 0, seed.stderr);
        const r = await runCli(CLI_ENTRY, ['install', '-g', 'demo-tool', '--no-prune'], {
            cwd: tmpRoot,
            env: baseEnv,
            timeoutMs: 90_000,
        });
        assert.equal(r.status, 0, r.stderr);
        assert.ok(existsSync(pkgDir('demo-bin-darwin-arm64')), '--no-prune must be honoured');
    });

    it('reports an empty project prefix instead of failing', async () => {
        const empty = join(tmpRoot, 'empty-project');
        mkdirSync(empty, { recursive: true });
        writeFileSync(join(empty, 'package.json'), JSON.stringify({ name: 'empty', version: '1.0.0' }));
        const r = await runCli(CLI_ENTRY, ['prune'], { cwd: empty, env: baseEnv, timeoutMs: 30_000 });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /nothing installed/);
    });
});
