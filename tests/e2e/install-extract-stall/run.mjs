// E2E test for `gjsify install`'s per-extract stall guard.
//
// `extractTarball` takes no AbortSignal and no timeout of its own. Under GJS a
// dropped Gio stream close-event wedges the decompress/write forever — a
// never-settling await that the overall-install abort cannot break (it only
// aborts in-flight registry FETCHES). Historically this hung the whole install
// at 0% CPU indefinitely until the user killed it.
//
// `extractWithStallGuard` (install-backend-native.ts) now races each extract
// against a stall timer (default 120s, overridable via GJSIFY_EXTRACT_STALL_MS)
// and the overall abort signal. This test drives the real install command
// against an in-process registry that serves a genuine packument + tarball —
// so resolution + fetch succeed and we reach the extract phase — with the
// documented GJSIFY_TEST_HANG_EXTRACT=1 seam making that extract never settle.
// The stall timer must then fire and the install must exit non-zero with a
// clear "stalled" message, fast, leaving node_modules unpopulated.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

// The registry is deliberately WELL-BEHAVED here: the stall under test lives in
// the extract phase, reached only once resolution and fetch have both succeeded.
const PACKAGES = {
    'leaf-dep': { '1.0.0': { dependencies: {} } },
};

describe('gjsify install — per-extract stall guard', { timeout: 60_000 }, () => {
    let registry, cliEntry;

    before(async () => {
        registry = await startMockRegistry(PACKAGES);
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
    });

    after(async () => {
        await registry?.close();
    });

    it('exits non-zero with a "stalled" message when an extract never settles', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-extract-stall-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    {
                        name: 'stall-test',
                        version: '0.1.0',
                        type: 'module',
                        private: true,
                        dependencies: { 'leaf-dep': '^1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(dir, '.npmrc'), `registry=${registry.url}\n`);

            const t0 = Date.now();
            const r = await runCli(cliEntry, ['install'], {
                cwd: dir,
                env: {
                    ...process.env,
                    GJSIFY_INSTALL_BACKEND: 'native',
                    npm_config_registry: registry.url,
                    // The extract that follows a successful fetch never settles...
                    GJSIFY_TEST_HANG_EXTRACT: '1',
                    // ...and the stall timer pulls the plug in ~1s (not the 120s default).
                    GJSIFY_EXTRACT_STALL_MS: '1000',
                    GJSIFY_NO_VERSION_SKEW_WARNING: '1',
                },
                timeoutMs: 30_000,
            });
            const elapsed = Date.now() - t0;

            assert.notEqual(r.status, 0, `expected non-zero exit; stdout=${r.stdout} stderr=${r.stderr}`);
            assert.match(r.stdout + r.stderr, /stalled/i, `expected a "stalled" message, got: ${r.stdout}${r.stderr}`);
            // Must not have hung: stall fires ~1s, generous 15s ceiling catches a
            // regression back to the old unbounded 0%-CPU hang.
            assert.ok(elapsed < 15_000, `install took ${elapsed}ms — extract stall guard did not fire`);
            assert.ok(
                !existsSync(join(dir, 'node_modules', 'leaf-dep', 'package.json')),
                'a stalled extract must not leave a populated package',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
