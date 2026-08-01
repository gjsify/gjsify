// E2E test for `scripts/clear-committed-platform-exemptions.mjs`.
//
// `gjsify.platformsUncommitted` is the honest-deferral hatch: "declared, CI
// builds it, no artifact in this repo yet". The conformance rule turns it into
// a FAILURE the moment `prebuilds/<target>/` appears, so a deferral cannot
// outlive its cause.
//
// That makes `commit-prebuilds` — the job that ENDS the cause by pushing the
// artifact — the one place the marker must also end. Without this script the
// first run that lands a new target commits a self-contradictory manifest and
// `main` goes red until someone sends a follow-up PR; the mechanism would buy
// its honesty with a broken default branch per new platform.
//
// The asymmetry is the part worth pinning: an entry whose artifact ARRIVED is
// cleared, an entry whose artifact did NOT is left alone, because that one
// still describes reality (a skipped package, a leg that did not run).
// Fixtures are synthetic package trees in a temp dir — the real manifests must
// not be mutated by a test the e2e suite runs four-at-a-time.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/platform-exemption-clearing/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'clear-committed-platform-exemptions.mjs');

const { clearSatisfiedExemptions } = await import(`file://${SCRIPT}`);

/**
 * A synthetic workspace root holding one package.
 *
 * `realpathSync` is not needed here — nothing compares paths against a
 * resolver's output — but `mkdtemp` still goes under `tmpdir()`, which on macOS
 * is a symlinked `/var/folders/…`; the script only ever joins onto the root it
 * is handed, so both spellings work.
 */
function fixture({ platforms, uncommitted, presentDirs = [] }) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-exemptions-'));
    const pkgDir = join(root, 'packages', 'node', 'thing');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        `${JSON.stringify(
            {
                name: '@gjsify/thing',
                gjsify: { prebuilds: 'prebuilds', platforms, platformsUncommitted: uncommitted },
            },
            null,
            4,
        )}\n`,
    );
    for (const target of presentDirs) mkdirSync(join(pkgDir, 'prebuilds', target), { recursive: true });
    return {
        root,
        manifest: join(pkgDir, 'package.json'),
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

const readGjsify = (manifest) => JSON.parse(readFileSync(manifest, 'utf8')).gjsify;

describe('clear-committed-platform-exemptions', () => {
    it('clears an entry whose prebuild directory has arrived', () => {
        const f = fixture({
            platforms: ['linux-x64', 'darwin-x64'],
            uncommitted: { 'darwin-x64': 'CI builds it; not committed here yet' },
            presentDirs: ['linux-x64', 'darwin-x64'],
        });
        try {
            const { cleared, manifests } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, ['@gjsify/thing darwin-x64']);
            assert.deepEqual(manifests, ['packages/node/thing/package.json']);
            const g = readGjsify(f.manifest);
            // The object goes away with its last entry — an empty
            // `platformsUncommitted` would be a declaration promising nothing.
            assert.equal(g.platformsUncommitted, undefined);
            // The PROMISE stays: only the deferral was resolved.
            assert.deepEqual(g.platforms, ['linux-x64', 'darwin-x64']);
        } finally {
            f.cleanup();
        }
    });

    it('leaves an entry alone while its artifact is still absent', () => {
        // The load-bearing half: a skipped package or a leg that did not run
        // must keep its exemption, because it still describes reality.
        const f = fixture({
            platforms: ['linux-x64', 'darwin-x64'],
            uncommitted: { 'darwin-x64': 'CI builds it; not committed here yet' },
            presentDirs: ['linux-x64'],
        });
        try {
            const { cleared, manifests } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, []);
            assert.deepEqual(manifests, []);
            assert.deepEqual(readGjsify(f.manifest).platformsUncommitted, {
                'darwin-x64': 'CI builds it; not committed here yet',
            });
        } finally {
            f.cleanup();
        }
    });

    it('clears only the satisfied entries of a multi-target exemption', () => {
        const f = fixture({
            platforms: ['darwin-x64', 'win32-x64'],
            uncommitted: { 'darwin-x64': 'arrived', 'win32-x64': 'still blocked' },
            presentDirs: ['darwin-x64'],
        });
        try {
            const { cleared } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, ['@gjsify/thing darwin-x64']);
            assert.deepEqual(readGjsify(f.manifest).platformsUncommitted, { 'win32-x64': 'still blocked' });
        } finally {
            f.cleanup();
        }
    });

    it('does not write in dry-run mode', () => {
        const f = fixture({
            platforms: ['darwin-x64'],
            uncommitted: { 'darwin-x64': 'arrived' },
            presentDirs: ['darwin-x64'],
        });
        try {
            const before = readFileSync(f.manifest, 'utf8');
            const { cleared } = clearSatisfiedExemptions(f.root, { dryRun: true });
            assert.deepEqual(cleared, ['@gjsify/thing darwin-x64']);
            assert.equal(readFileSync(f.manifest, 'utf8'), before);
        } finally {
            f.cleanup();
        }
    });

    it('ignores a package that declares no exemptions', () => {
        const f = fixture({ platforms: ['linux-x64'], uncommitted: undefined, presentDirs: ['linux-x64'] });
        try {
            assert.deepEqual(clearSatisfiedExemptions(f.root).cleared, []);
        } finally {
            f.cleanup();
        }
    });

    it('is a no-op on the real repo today', () => {
        // Every exemption currently in the tree is genuinely unsatisfied; if
        // this ever fires, an artifact landed without its marker being cleared.
        assert.deepEqual(clearSatisfiedExemptions(MONOREPO_ROOT, { dryRun: true }).cleared, []);
    });
});
