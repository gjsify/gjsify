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
//  5. STRAY PACKUMENT FETCH REGRESSION — the mock registry records every
//     packument path that the CLI requests. Only `@gjsify/cli` must be
//     fetched; any request for `@gjsify/v8` or other non-`@gjsify/cli`
//     packuments indicates a regression (the old bug where the native install
//     backend walked transitive deps of `@gjsify/cli` and tried to resolve
//     workspace-internal packages that don't exist on the public registry,
//     causing a 406 Not Acceptable crash).
//
//  6. NO STRAY STDOUT NOISE — self-update must not emit `--help` usage text
//     or a bare `{}` to stdout (regression guard for the old bundle behavior
//     where an unhandled promise rejection from the install backend caused
//     yargs to print usage before crashing).
//
//  7. IDEMPOTENCY — running self-update twice in a row must both succeed
//     (exit 0 with "Already up to date" on the second run).
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
// The mock registry:
//   - Records every GET request path in a shared JSON file so the parent
//     process can assert which packuments were fetched.
//   - Serves the `@gjsify/cli` packument correctly (200).
//   - Returns 406 for any other packument path — the failure mode the old
//     code guarded against. `@gjsify/v8` was the canonical offender back when
//     it (briefly) wasn't on the public registry; this guard surfaces any
//     regression that fetches a transitive packument on the short-circuit path.
//
// Default-behavior note: `self-update` now resolves the production
// `dependencies` tree by DEFAULT (only `--skip-deps` keeps the bundle-only
// fast path). That is safe because every `@gjsify/*` package — including
// `@gjsify/v8` — is now published to the public registry. These tests exercise
// the same-version / `--check` paths, where `installPackages` is never reached,
// so no transitive packuments/tarballs are requested regardless.
//
// Limitation: the full upgrade path (installPackages + linkGlobalBins) is NOT
// exercised here because `installPackages` with a real tarball server is out
// of scope for a unit-level e2e. The test focuses on the packument-fetch
// surface (the production-bug regression) plus the `--check` exit-code path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

    // Path to the JSON file where the mock registry logs every requested
    // packument path. Written by the in-process server; read by the parent
    // after each test run.
    let requestLogPath;

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

        // Path for the mock registry request log (written by in-process server,
        // read by tests to assert which packument paths were requested).
        requestLogPath = join(tmpRoot, 'registry-requests.json');
        writeFileSync(requestLogPath, '[]');

        // Build a global prefix that looks like a HEALTHY real install: it has
        // @gjsify/cli AND the GJS bundler engine @gjsify/rolldown-native. The
        // engine must be present so the version-match tests short-circuit at
        // "Already up to date" — self-update now treats a version-matched-but-
        // engine-missing prefix as needing a REPAIR (covered separately in
        // tests/e2e/global-install-engine), not as up-to-date.
        prefixWithCli = join(tmpRoot, 'global-with-cli');
        const cliPkgDir = join(prefixWithCli, 'node_modules', PACKAGE_NAME);
        mkdirSync(cliPkgDir, { recursive: true });
        writeFileSync(
            join(cliPkgDir, 'package.json'),
            JSON.stringify({ name: PACKAGE_NAME, version: currentVersion }) + '\n',
        );
        const enginePkgDir = join(prefixWithCli, 'node_modules', '@gjsify', 'rolldown-native');
        mkdirSync(enginePkgDir, { recursive: true });
        writeFileSync(
            join(enginePkgDir, 'package.json'),
            JSON.stringify({
                name: '@gjsify/rolldown-native',
                version: currentVersion,
                gjsify: { prebuilds: 'prebuilds' },
            }) + '\n',
        );
        // The manifest field alone does NOT make the engine detected, and this
        // line is what actually makes the prefix HEALTHY. `detectNativePackages()`
        // — which `hasBundlerEngineInstalled()` asks, and which the repair branch
        // keys on — requires the arch-specific directory to physically exist; a
        // package declaring `gjsify.prebuilds` with nothing on disk is skipped.
        // Measured against this fixture: without the directory it answers `[]`,
        // with it `["@gjsify/rolldown-native"]`.
        //
        // Without it the three version-match rows below read as engine-missing,
        // self-update repairs instead of short-circuiting, and they fail
        // asserting "Already up to date" — which is exactly how they failed on
        // `main`. `tests/e2e/global-install-engine/run.mjs` builds its fixture
        // the same way and documents the same `prebuilds/<os>-<arch>` convention.
        mkdirSync(join(enginePkgDir, 'prebuilds', `${process.platform}-${process.arch}`), {
            recursive: true,
        });

        // Empty prefix (no @gjsify/cli).
        prefixEmpty = join(tmpRoot, 'global-empty');
        mkdirSync(prefixEmpty, { recursive: true });

        // ── mock npm registry ─────────────────────────────────────────────
        // Serves the @gjsify/cli packument and records every request path.
        // Returns 406 for any path that isn't the @gjsify/cli packument —
        // matching real npm behavior for workspace-internal packages that are
        // not published to the registry. This makes the stray-fetch regression
        // immediately visible: any request for @gjsify/v8 (or similar) will
        // both be logged AND return 406, causing the CLI to fail if skipDeps
        // is not set.
        registryServer = createServer((req, res) => {
            try {
                // Append the request path to the shared log file.  We do this
                // synchronously so it's always flushed before the CLI exits.
                const existing = JSON.parse(readFileSync(requestLogPath, 'utf-8'));
                existing.push(req.url);
                writeFileSync(requestLogPath, JSON.stringify(existing));

                const latestOverride = req.headers['x-mock-latest'];
                const latest = latestOverride ?? currentVersion;

                // Only serve the @gjsify/cli packument — everything else gets
                // a 406 (Not Acceptable), matching real npm registry behavior
                // for scoped packages that don't exist.
                const cliPath406Guard = ['/%40gjsify/cli', '/@gjsify%2Fcli', '/@gjsify/cli'];
                const isCli = cliPath406Guard.some((p) => req.url === p || req.url?.startsWith(p + '?'));
                if (!isCli) {
                    res.writeHead(406, { 'content-type': 'text/plain' });
                    res.end('Not Acceptable');
                    return;
                }

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

    // Helper: reset the request log before each test that cares about it.
    function clearRequestLog() {
        writeFileSync(requestLogPath, '[]');
    }

    function readRequestLog() {
        return JSON.parse(readFileSync(requestLogPath, 'utf-8'));
    }

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
        assert.match(combined, /Already up to date/, `Expected "Already up to date" in output:\n${combined}`);
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
        assert.match(combined, /Update available/, `Expected "Update available" in output:\n${combined}`);
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
        writeFileSync(fakeCliPkgJson, JSON.stringify({ name: '@not-gjsify/cli', version: '0.0.0' }) + '\n');

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
        assert.match(combined, /\(unknown\)/, `Expected "(unknown)" when version discovery fails:\n${combined}`);

        // With unknown version, --check prints "Install required" (not "Update
        // available") and exits 1.
        assert.equal(result.status, 1, `Expected exit 1 (--check with unknown version):\n${combined}`);
    });

    // ── 6. STRAY PACKUMENT FETCH REGRESSION ───────────────────────────────
    // Regression guard for the historical bug where the native install backend
    // walked the full transitive dep graph of @gjsify/cli and fetched a
    // packument for @gjsify/v8 back when it wasn't on the public registry,
    // getting a 406 Not Acceptable that crashed the command.
    //
    // The structural guarantee here is the short-circuit: this test runs the
    // same-version path → "Already up to date" returns before installPackages is
    // ever called, so the ONLY registry call is the single
    // fetchPackument('@gjsify/cli'). Any stray transitive packument request
    // (e.g. @gjsify/v8) on this path is a regression. (On a real upgrade the
    // backend now does resolve the production tree by default — safe because all
    // @gjsify/* packages are published — but that path is not exercised here.)
    //
    // This test verifies the guard by:
    //   a. Asserting the mock registry never receives a request for any
    //      non-@gjsify/cli packument (i.e., no @gjsify/v8, @gjsify/node-polyfills, etc.)
    //   b. Asserting the mock registry never receives a request whose path
    //      contains "/v8" (the specific package that caused the original crash)
    //   c. The mock server returns 406 for non-@gjsify/cli packuments, so any
    //      regression that re-introduces transitive fetches will also fail the
    //      exit-code assertions in the "already up to date" test.

    it('only requests @gjsify/cli packument — no stray @gjsify/v8 or transitive fetches', async () => {
        clearRequestLog();

        // Run with same version → exits early at "Already up to date", so the
        // only registry call is the single fetchPackument('@gjsify/cli') call.
        const result = await runSelfUpdate([], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-stray-check'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;
        assert.equal(result.status, 0, `Expected exit 0:\n${combined}`);

        const requestedPaths = readRequestLog();

        // No path may contain "v8" as a package segment — the @gjsify/v8
        // packument request was the root cause of the 406 crash.
        const v8Requests = requestedPaths.filter(
            (p) => p.includes('/v8') || p.includes('%2Fv8') || p.includes('%2fv8'),
        );
        assert.equal(
            v8Requests.length,
            0,
            `Stray @gjsify/v8 packument request(s) detected — skipDeps regression:\n` +
                `  Requests: ${JSON.stringify(requestedPaths, null, 2)}`,
        );

        // Every request path must be for @gjsify/cli only. Accept both
        // %40gjsify/cli and @gjsify%2Fcli URL encodings.
        const nonCliRequests = requestedPaths.filter((p) => {
            return (
                !p.includes('%40gjsify/cli') &&
                !p.includes('%40gjsify%2Fcli') &&
                !p.includes('@gjsify/cli') &&
                !p.includes('@gjsify%2Fcli')
            );
        });
        assert.equal(
            nonCliRequests.length,
            0,
            `Unexpected non-@gjsify/cli packument request(s) — transitive dep resolution leak:\n` +
                `  Non-CLI paths: ${JSON.stringify(nonCliRequests)}\n` +
                `  All paths: ${JSON.stringify(requestedPaths)}`,
        );
    });

    // ── 7. NO STRAY STDOUT NOISE ──────────────────────────────────────────
    // Regression guard for the old bundle behavior where an unhandled error
    // from the install backend caused yargs to print usage/help text (because
    // the command was re-parsed with empty argv after the crash) and a bare
    // `{}` (yargs serializing the rejected Error object as JSON.stringify(err)).
    //
    // On current main: self-update wraps installPackages in try/catch and calls
    // process.exit(1) cleanly on failure, so yargs never prints usage. The
    // "Already up to date" short-circuit path means installPackages is never
    // called here — this test is a belt-and-suspenders guard.

    it('emits no --help usage dump or bare {} on stdout', async () => {
        const result = await runSelfUpdate([], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-noise-check'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        // The stdout must not contain yargs usage patterns or bare `{}`.
        // "Usage:" is the canonical first line of yargs help output.
        assert.ok(!result.stdout.includes('Usage:'), `Stray --help/usage dump on stdout:\n${result.stdout}`);
        assert.ok(
            !result.stdout.includes('\n{}\n') && !result.stdout.endsWith('\n{}'),
            `Stray bare {} on stdout (serialized Error regression):\n${result.stdout}`,
        );
        // Commands list from yargs help would include "self-update" — must not appear
        // mid-output as noise (it's fine in the version line or log messages).
        assert.ok(
            !result.stdout.match(/\bCommands:\s*\n/),
            `Stray "Commands:" section in stdout (yargs help bleed-through):\n${result.stdout}`,
        );
    });

    // ── 8. IDEMPOTENCY ────────────────────────────────────────────────────
    // Running self-update twice must both succeed. The first run short-circuits
    // at "Already up to date" (versions match). The second run must also
    // short-circuit cleanly — not crash because the first run left partial
    // state, not re-install because a lockfile is stale, etc.

    it('is idempotent — running twice both succeed with exit 0', async () => {
        const env = {
            GJSIFY_GLOBAL_PREFIX: prefixWithCli,
            GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-idempotent'),
            GJSIFY_E2E_REGISTRY_URL: registryUrl,
            GJSIFY_E2E_LATEST_VERSION: currentVersion,
        };

        const first = await runSelfUpdate([], { preloadPath, env });
        const combined1 = first.stdout + first.stderr;
        assert.equal(first.status, 0, `Expected exit 0 on first run:\n${combined1}`);
        assert.match(combined1, /Already up to date/, `Expected "Already up to date" on first run:\n${combined1}`);

        const second = await runSelfUpdate([], { preloadPath, env });
        const combined2 = second.stdout + second.stderr;
        assert.equal(second.status, 0, `Expected exit 0 on second run (idempotency):\n${combined2}`);
        assert.match(
            combined2,
            /Already up to date/,
            `Expected "Already up to date" on second run (idempotency):\n${combined2}`,
        );
    });

    // ── 9. --skip-deps FLAG IS RECOGNISED ─────────────────────────────────
    // Wiring guard for the new `--skip-deps` option. With a matching version
    // the command short-circuits at "Already up to date" before any install,
    // but the flag must still parse cleanly — a removed/renamed option would
    // make yargs reject it as "Unknown argument" and exit non-zero.

    it('accepts the --skip-deps flag without a yargs "Unknown argument" error', async () => {
        const result = await runSelfUpdate(['--skip-deps'], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-skip-deps'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;
        assert.equal(result.status, 0, `Expected exit 0 with --skip-deps (same version):\n${combined}`);
        assert.ok(
            !/Unknown argument/i.test(combined),
            `--skip-deps was rejected as an unknown argument — option wiring regression:\n${combined}`,
        );
    });

    // ── 10. --skip-deps HONOURS its contract when the engine is missing ───────
    // When the cli version matches but @gjsify/rolldown-native is absent,
    // self-update normally REPAIRS (installs the engine). But `--skip-deps`
    // means "don't touch on-disk deps", so it must NOT trigger the repair — it
    // short-circuits at "Already up to date" and just NOTES the missing engine.
    // Uses prefixEmptyEngine: has @gjsify/cli but no engine. install
    // short-circuits before any network, so no tarball server is needed.

    it('--skip-deps does not repair a missing engine — only notes it', async () => {
        const prefixEmptyEngine = join(tmpRoot, 'global-cli-no-engine');
        const ceDir = join(prefixEmptyEngine, 'node_modules', PACKAGE_NAME);
        mkdirSync(ceDir, { recursive: true });
        writeFileSync(
            join(ceDir, 'package.json'),
            JSON.stringify({ name: PACKAGE_NAME, version: currentVersion }) + '\n',
        );

        const result = await runSelfUpdate(['--skip-deps'], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixEmptyEngine,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-skip-deps-noengine'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
            },
        });

        const combined = result.stdout + result.stderr;
        assert.equal(result.status, 0, `Expected exit 0 (--skip-deps, version match):\n${combined}`);
        assert.match(combined, /Already up to date/, `--skip-deps must short-circuit, not repair:\n${combined}`);
        assert.match(
            combined,
            /@gjsify\/rolldown-native is not installed/,
            `--skip-deps should NOTE the missing engine:\n${combined}`,
        );
        // It must NOT have attempted the repair install.
        assert.ok(
            !/repairing|Installing @gjsify\/cli/.test(combined),
            `--skip-deps must not trigger an install:\n${combined}`,
        );
    });
});
