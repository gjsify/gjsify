// E2E test for `gjsify self-update`.
//
// Guards the binary-path / prefix-detection logic that caused the production
// bug where `self-update` crashed with "no @gjsify/cli install found" when
// run from a path not under the gjsify global layout prefix.
//
// Key behaviors under test
// ─────────────────────────
//  1. PREFIX DETECTION — the `installedAtPrefix` guard (does
//     `$GJSIFY_GLOBAL_PREFIX/node_modules/@gjsify/cli/package.json` exist?):
//       a. prefix HAS @gjsify/cli → proceeds without warning → reaches network
//          (the "accepted" path, i.e. the legitimately installed binary)
//       b. prefix is EMPTY → prints the "no @gjsify/cli install found" warning
//          then still proceeds to the network step
//
//  2. ALREADY UP TO DATE — when the resolved dist-tag version matches the
//     current CLI version, the command prints "Already up to date" and exits 0
//     without touching the install tree.
//
//  3. --check WITH NEWER VERSION AVAILABLE — exits 1 and prints
//     "Update available: v<current> → v<target>" when a newer dist-tag is
//     served.
//
//  4. VERSION DISCOVERY FALLBACK — when the CLI is invoked from a path
//     that contains no recognisable `@gjsify/cli` package.json above it
//     (simulated by shadowing the CLI entry with a wrapper that clears the
//     module's view of its own package.json), the current version reports as
//     "(unknown)" — confirming the graceful fallback rather than a hard crash.
//
// Network mock strategy
// ─────────────────────
// `fetchPackument` from @gjsify/npm-registry calls `globalThis.fetch` (no
// registry URL override exists in `gjsify self-update`). We inject a custom
// `fetch` implementation via a Node --import preload written to a temp file;
// the preload patches `globalThis.fetch` before any CLI module loads, routing
// calls to the in-process HTTP mock server. The preload URL is passed to the
// child via `GJSIFY_E2E_MOCK_FETCH_URL`, and the mock registry URL is passed
// via `GJSIFY_E2E_REGISTRY_URL`.
//
// Limitation: the full upgrade path (installPackages + linkGlobalBins) is NOT
// exercised here because `installPackages` reaches into the native install
// backend which requires a real network or a complete mock registry tarball
// server — both are out of scope for a unit-level e2e. The test focuses on
// everything BEFORE `installPackages` is called (the production-bug surface),
// plus the `--check` exit-code path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    writeFileSync,
    existsSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

// ── constants mirrored from self-update.ts ──────────────────────────────────
const PACKAGE_NAME = '@gjsify/cli';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Minimal packument served to the CLI when it calls fetchPackument('@gjsify/cli'). */
function makePackument(name, versions, latest) {
    const versionMap = {};
    for (const v of versions) {
        versionMap[v] = {
            name,
            version: v,
            dist: {
                tarball: `http://127.0.0.1:0/${name}/-/${name}-${v}.tgz`,
                shasum: 'deadbeef00000000000000000000000000000000',
            },
        };
    }
    return { name, 'dist-tags': { latest }, versions: versionMap };
}

/** Run the CLI self-update command under Node with a patched globalThis.fetch. */
function runSelfUpdate(args, { env = {}, preloadPath, timeoutMs = 20_000 } = {}) {
    const nodeArgs = [];
    if (preloadPath) {
        nodeArgs.push('--import', preloadPath);
    }
    nodeArgs.push(CLI_ENTRY, 'self-update', ...args);

    return execFileAsync(process.execPath, nodeArgs, {
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        encoding: 'utf8',
    }).then(
        ({ stdout, stderr }) => ({ status: 0, stdout, stderr }),
        (err) => ({
            status: err.code ?? 1,
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? '',
        }),
    );
}

// ── test suite ───────────────────────────────────────────────────────────────

describe('gjsify self-update E2E', { timeout: 60_000 }, () => {
    let tmpRoot;
    let registryServer;
    let registryUrl;
    let preloadPath;

    // Current version as declared in the workspace CLI package.json
    // (used for "already up to date" assertions).
    let currentVersion;

    // A fake global prefix that has @gjsify/cli installed (mirrors the
    // real production layout: `<prefix>/node_modules/@gjsify/cli/package.json`).
    let prefixWithCli;

    // A fake global prefix that is completely empty (simulates a
    // non-standard or first-time install path).
    let prefixEmpty;

    before(async () => {
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(
                `self-update e2e requires a built CLI: ${CLI_ENTRY}\n` +
                    `Run \`gjsify workspace @gjsify/cli build\` first (or build:infra).`,
            );
        }

        // Read the workspace CLI version so we can craft "same version" and
        // "newer version" packuments relative to it.
        const cliPkgJson = JSON.parse(
            (await import('node:fs')).readFileSync(
                join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'package.json'),
                'utf-8',
            ),
        );
        currentVersion = cliPkgJson.version;

        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-self-update-'));

        // Build a global prefix that looks like a real install (has @gjsify/cli).
        prefixWithCli = join(tmpRoot, 'global-with-cli');
        const cliPkgDir = join(prefixWithCli, 'node_modules', PACKAGE_NAME);
        mkdirSync(cliPkgDir, { recursive: true });
        writeFileSync(
            join(cliPkgDir, 'package.json'),
            JSON.stringify({ name: PACKAGE_NAME, version: currentVersion }) + '\n',
        );

        // Empty prefix (no @gjsify/cli).
        prefixEmpty = join(tmpRoot, 'global-empty');
        mkdirSync(prefixEmpty, { recursive: true });

        // ── mock npm registry ─────────────────────────────────────────────
        // Serves two packument variants (keyed by the `x-mock-latest` header
        // that the preload injects based on GJSIFY_E2E_LATEST_VERSION env var).
        registryServer = createServer((req, res) => {
            try {
                const latestOverride = req.headers['x-mock-latest'];
                const latest = latestOverride ?? currentVersion;
                const p = makePackument(PACKAGE_NAME, [currentVersion, latest], latest);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(p));
            } catch (e) {
                res.writeHead(500).end(String(e));
            }
        });
        await new Promise((resolve) => registryServer.listen(0, '127.0.0.1', resolve));
        const { port } = registryServer.address();
        registryUrl = `http://127.0.0.1:${port}`;

        // ── globalThis.fetch preload ──────────────────────────────────────
        // Written to a temp file so it can be passed via --import. The preload
        // reads the registry URL from GJSIFY_E2E_REGISTRY_URL and the
        // "latest" version to advertise from GJSIFY_E2E_LATEST_VERSION, then
        // replaces globalThis.fetch with a shim that forwards requests to the
        // mock server instead of the real npm registry.
        preloadPath = join(tmpRoot, 'mock-fetch.mjs');
        writeFileSync(
            preloadPath,
            `
// Fetch shim injected by self-update e2e test.
// Intercepts calls to registry.npmjs.org and reroutes them to the in-process
// mock server (GJSIFY_E2E_REGISTRY_URL). All other URLs are forwarded normally.
const MOCK_REGISTRY = process.env.GJSIFY_E2E_REGISTRY_URL ?? '';
const LATEST = process.env.GJSIFY_E2E_LATEST_VERSION ?? '';
const _realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  if (MOCK_REGISTRY && url.includes('registry.npmjs.org')) {
    const mockUrl = url.replace(/https:\\/\\/registry\\.npmjs\\.org/, MOCK_REGISTRY);
    const headers = { ...(init.headers ?? {}), 'x-mock-latest': LATEST };
    return _realFetch(mockUrl, { ...init, headers });
  }
  return _realFetch(input, init);
};
`,
        );
    });

    after(() => {
        registryServer?.close();
        if (!process.env.GJSIFY_E2E_KEEP_TEMP && tmpRoot) {
            rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    // ── 1a. PREFIX DETECTION — accepted path ─────────────────────────────

    it('proceeds without prefix warning when @gjsify/cli IS installed at prefix', async () => {
        // Same version → will short-circuit at "Already up to date"
        // so we don't accidentally trigger a real install attempt.
        const result = await runSelfUpdate([], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;

        // The "no @gjsify/cli install found" warning must NOT appear.
        assert.ok(
            !combined.includes('no @gjsify/cli install found'),
            `Unexpected prefix-warning when prefix is populated:\n${combined}`,
        );

        // Command should succeed (exit 0) — it reaches "Already up to date".
        assert.equal(result.status, 0, `Expected exit 0, got ${result.status}:\n${combined}`);
    });

    // ── 1b. PREFIX DETECTION — rejected/warning path ──────────────────────

    it('warns "no @gjsify/cli install found" when prefix is empty', async () => {
        // Use same version so after the warning it short-circuits at "up to date"
        // rather than attempting a real install.
        const result = await runSelfUpdate([], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixEmpty,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-empty'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;

        // The warning must appear — this is the production-bug regression guard.
        assert.ok(
            combined.includes('no @gjsify/cli install found'),
            `Expected prefix-not-found warning, got:\n${combined}`,
        );

        // Despite the warning, the command must not crash (exit 0 because
        // same version → "Already up to date").
        assert.equal(result.status, 0, `Expected exit 0 after warning, got ${result.status}:\n${combined}`);
    });

    // ── 2. ALREADY UP TO DATE ─────────────────────────────────────────────

    it('exits 0 and prints "Already up to date" when versions match', async () => {
        const result = await runSelfUpdate([], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-uptodate'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;
        assert.equal(result.status, 0, `Expected exit 0:\n${combined}`);
        assert.match(
            combined,
            /Already up to date/,
            `Expected "Already up to date" in output:\n${combined}`,
        );
    });

    // ── 3. --check WITH NEWER VERSION AVAILABLE ───────────────────────────

    it('--check exits 1 and prints "Update available" when newer version exists', async () => {
        // Fabricate a version that is strictly newer than the current one.
        // Bump the patch segment by 999 to guarantee it's always "newer".
        const parts = currentVersion.split('.');
        const newerVersion = [parts[0], parts[1], String(Number(parts[2] ?? '0') + 999)].join('.');

        const result = await runSelfUpdate(['--check'], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-check'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: newerVersion,
            },
        });

        const combined = result.stdout + result.stderr;

        // `--check` exits 1 when an update is available (per self-update.ts).
        assert.equal(result.status, 1, `Expected exit 1 for --check with newer version:\n${combined}`);
        assert.match(
            combined,
            /Update available/,
            `Expected "Update available" in output:\n${combined}`,
        );
        assert.match(
            combined,
            new RegExp(newerVersion.replace(/\./g, '\\.')),
            `Expected the newer version (${newerVersion}) in output:\n${combined}`,
        );
    });

    // ── 4. --check WITH SAME VERSION → exits 0 ───────────────────────────

    it('--check exits 0 and does not print "Update available" when already current', async () => {
        const result = await runSelfUpdate(['--check'], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-check-current'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;
        assert.equal(result.status, 0, `Expected exit 0 when already up to date:\n${combined}`);
        assert.ok(
            !combined.includes('Update available'),
            `Did not expect "Update available" when version matches:\n${combined}`,
        );
    });

    // ── 5. VERSION DISCOVERY FALLBACK ─────────────────────────────────────
    // When readCurrentVersion() walks import.meta.url and finds no @gjsify/cli
    // package.json, it returns null → the CLI prints "(unknown)" for the
    // current version. We simulate this by pointing GJSIFY_GLOBAL_PREFIX at an
    // empty dir AND running with the same version as current — so even with
    // "(unknown)" the command must complete without a hard crash.

    it('reports "(unknown)" current version gracefully when version discovery fails', async () => {
        // Structural simulation — no ESM-namespace monkey-patching.
        //
        // readCurrentVersion() in self-update.ts honours the
        // GJSIFY_CLI_PACKAGE_JSON env escape hatch: when set, it reads from
        // that path instead of doing the upward import.meta.url walk.  Pointing
        // it at a synthetic package.json whose `name` is NOT '@gjsify/cli'
        // causes the function to return null → CLI prints "(unknown)".
        //
        // (We cannot reassign a named export on a frozen ESM module namespace,
        // so `import * as realFs from 'node:fs'; realFs.readFileSync = …`
        // throws TypeError.  The env-var approach is the canonical escape
        // hatch used by GJSIFY_GLOBAL_PREFIX / GJSIFY_GLOBAL_BIN_DIR.)
        const fakeCliPkgJson = join(tmpRoot, 'fake-cli-package.json');
        writeFileSync(
            fakeCliPkgJson,
            JSON.stringify({ name: '@not-gjsify/cli', version: '0.0.0' }) + '\n',
        );

        // Use --check so that when currentVersion=(unknown) != target, the
        // command exits 1 without calling installPackages (which needs a real
        // npm tarball server).
        const result = await runSelfUpdate(['--check'], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-unknown'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
                // Override the package.json path used by readCurrentVersion().
                // The name does not match '@gjsify/cli' → returns null → "(unknown)".
                GJSIFY_CLI_PACKAGE_JSON: fakeCliPkgJson,
            },
        });

        const combined = result.stdout + result.stderr;

        // The CLI must report "(unknown)" for the current version.
        assert.match(
            combined,
            /\(unknown\)/,
            `Expected "(unknown)" when version discovery fails:\n${combined}`,
        );

        // With unknown version, --check prints "Install required" (not "Update
        // available") and exits 1.
        assert.equal(result.status, 1, `Expected exit 1 (--check with unknown version):\n${combined}`);
    });
});
