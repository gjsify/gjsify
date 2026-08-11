// E2E test for `gjsify self-update`, guarding the prefix-detection logic behind the
// production bug where it crashed with "no @gjsify/cli install found" when run from a path
// outside the gjsify global layout prefix.
//
// NETWORK MOCK. `fetchPackument` calls `globalThis.fetch` and `self-update` has no
// registry-URL override, so a Node `--import` preload written to a temp file patches
// `globalThis.fetch` before any CLI module loads and reroutes to an in-process HTTP server
// (URL passed in via `GJSIFY_E2E_REGISTRY_URL`). That server logs every requested path to a
// shared JSON file and returns 406 for anything that is not the `@gjsify/cli` packument —
// real npm's behaviour for an unpublished scoped package, and what makes a stray transitive
// fetch fail loudly rather than silently.
//
// LIMITATION: the full upgrade path (`installPackages` + `linkGlobalBins`) is not exercised
// — it needs a real tarball server. Every case here rides the same-version or `--check`
// path, where `installPackages` is never reached.

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

const PACKAGE_NAME = '@gjsify/cli';

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

/** Run `gjsify self-update` under Node with a patched `globalThis.fetch`. */
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

describe('gjsify self-update E2E', { timeout: 60_000 }, () => {
    let tmpRoot;
    let registryServer;
    let registryUrl;
    let preloadPath;

    /** As declared in the workspace CLI package.json. */
    let currentVersion;
    /** A fake prefix laid out like a real install: `<prefix>/node_modules/@gjsify/cli/`. */
    let prefixWithCli;
    /** An empty prefix — a non-standard or first-time install path. */
    let prefixEmpty;
    /** Where the mock registry logs every requested packument path. */
    let requestLogPath;

    before(async () => {
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(
                `self-update e2e requires a built CLI: ${CLI_ENTRY}\n` +
                    `Run \`gjsify workspace @gjsify/cli build\` first (or build:infra).`,
            );
        }

        // Read the workspace CLI version so the packuments below can be crafted relative
        // to it.
        const cliPkgJson = JSON.parse(
            (await import('node:fs')).readFileSync(
                join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'package.json'),
                'utf-8',
            ),
        );
        currentVersion = cliPkgJson.version;

        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-self-update-'));

        requestLogPath = join(tmpRoot, 'registry-requests.json');
        writeFileSync(requestLogPath, '[]');

        // A prefix that looks like a HEALTHY install: @gjsify/cli AND the GJS bundler engine
        // @gjsify/rolldown-native. The engine must be present or the version-match cases do
        // not short-circuit — self-update treats version-matched-but-engine-missing as
        // needing a REPAIR (covered by tests/e2e/global-install-engine).
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
        // THIS line is what makes the prefix healthy, not the manifest field above:
        // `detectNativePackages()` — which `hasBundlerEngineInstalled()` asks, and which the
        // repair branch keys on — requires the arch-specific directory to physically exist,
        // and skips a package declaring `gjsify.prebuilds` with nothing on disk. Measured
        // against this fixture: without the directory it answers `[]`, with it
        // `["@gjsify/rolldown-native"]`, and the version-match cases below repair instead of
        // short-circuiting.
        mkdirSync(join(enginePkgDir, 'prebuilds', `${process.platform}-${process.arch}`), {
            recursive: true,
        });

        prefixEmpty = join(tmpRoot, 'global-empty');
        mkdirSync(prefixEmpty, { recursive: true });

        registryServer = createServer((req, res) => {
            try {
                // Logged synchronously so the entry is always flushed before the CLI exits.
                const existing = JSON.parse(readFileSync(requestLogPath, 'utf-8'));
                existing.push(req.url);
                writeFileSync(requestLogPath, JSON.stringify(existing));

                const latestOverride = req.headers['x-mock-latest'];
                const latest = latestOverride ?? currentVersion;

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

        // In a temp file so it can be passed via `--import`. Reads the registry URL from
        // GJSIFY_E2E_REGISTRY_URL and the "latest" version to advertise from
        // GJSIFY_E2E_LATEST_VERSION.
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

    function clearRequestLog() {
        writeFileSync(requestLogPath, '[]');
    }

    function readRequestLog() {
        return JSON.parse(readFileSync(requestLogPath, 'utf-8'));
    }

    it('proceeds without prefix warning when @gjsify/cli IS installed at prefix', async () => {
        // Same version, so it short-circuits at "Already up to date" rather than attempting
        // a real install.
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

        assert.ok(
            !combined.includes('no @gjsify/cli install found'),
            `Unexpected prefix-warning when prefix is populated:\n${combined}`,
        );
        assert.equal(result.status, 0, `Expected exit 0, got ${result.status}:\n${combined}`);
    });

    it('warns "no @gjsify/cli install found" when prefix is empty', async () => {
        // Same version again, so it short-circuits after the warning instead of installing.
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

        // The warning is the production-bug regression guard; warning must not mean crash.
        assert.ok(
            combined.includes('no @gjsify/cli install found'),
            `Expected prefix-not-found warning, got:\n${combined}`,
        );
        assert.equal(result.status, 0, `Expected exit 0 after warning, got ${result.status}:\n${combined}`);
    });

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

    it('--check exits 1 and prints "Update available" when newer version exists', async () => {
        // +999 on the patch segment guarantees strictly newer whatever the current version is.
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

        assert.equal(result.status, 1, `Expected exit 1 for --check with newer version:\n${combined}`);
        assert.match(combined, /Update available/, `Expected "Update available" in output:\n${combined}`);
        assert.match(
            combined,
            new RegExp(newerVersion.replace(/\./g, '\\.')),
            `Expected the newer version (${newerVersion}) in output:\n${combined}`,
        );
    });

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

    it('reports "(unknown)" current version gracefully when version discovery fails', async () => {
        // `readCurrentVersion()` returns null — and the CLI then prints "(unknown)" instead
        // of crashing — when it finds no `@gjsify/cli` package.json. Driven through the
        // GJSIFY_CLI_PACKAGE_JSON escape hatch, pointed at a manifest whose `name` is not
        // '@gjsify/cli', because a named export on a frozen ESM namespace cannot be
        // reassigned (`realFs.readFileSync = …` throws TypeError).
        const fakeCliPkgJson = join(tmpRoot, 'fake-cli-package.json');
        writeFileSync(fakeCliPkgJson, JSON.stringify({ name: '@not-gjsify/cli', version: '0.0.0' }) + '\n');

        // `--check` so that an unknown-vs-target mismatch exits 1 without calling
        // `installPackages`, which would need a real tarball server.
        const result = await runSelfUpdate(['--check'], {
            preloadPath,
            env: {
                GJSIFY_GLOBAL_PREFIX: prefixWithCli,
                GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin-unknown'),
                GJSIFY_E2E_REGISTRY_URL: registryUrl,
                GJSIFY_E2E_LATEST_VERSION: currentVersion,
                GJSIFY_CLI_PACKAGE_JSON: fakeCliPkgJson,
            },
        });

        const combined = result.stdout + result.stderr;

        assert.match(combined, /\(unknown\)/, `Expected "(unknown)" when version discovery fails:\n${combined}`);
        // With an unknown current version `--check` prints "Install required", not "Update
        // available", and exits 1.
        assert.equal(result.status, 1, `Expected exit 1 (--check with unknown version):\n${combined}`);
    });

    // Regression guard: the native install backend used to walk @gjsify/cli's whole
    // transitive dep graph and fetch a packument for @gjsify/v8 back when that was not on
    // the public registry, taking a 406 Not Acceptable that crashed the command. Self-update
    // now resolves the production tree by DEFAULT (only `--skip-deps` keeps the bundle-only
    // fast path), which is safe because every `@gjsify/*` package is published — but the
    // same-version path short-circuits before `installPackages`, so on THIS path the single
    // `fetchPackument('@gjsify/cli')` must be the only registry call.
    it('only requests @gjsify/cli packument — no stray @gjsify/v8 or transitive fetches', async () => {
        clearRequestLog();

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

        // `@gjsify/v8` was the original 406 offender, so its path segment gets its own check.
        const v8Requests = requestedPaths.filter(
            (p) => p.includes('/v8') || p.includes('%2Fv8') || p.includes('%2fv8'),
        );
        assert.equal(
            v8Requests.length,
            0,
            `Stray @gjsify/v8 packument request(s) detected — skipDeps regression:\n` +
                `  Requests: ${JSON.stringify(requestedPaths, null, 2)}`,
        );

        // Both `%40gjsify/cli` and `@gjsify%2Fcli` URL encodings count as the CLI.
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

    // Regression guard for the bundle behaviour where an unhandled install-backend error
    // made yargs re-parse with empty argv and print usage, plus a bare `{}` from yargs
    // serialising the rejected Error. self-update now catches and exits 1 cleanly, and this
    // path never reaches `installPackages` at all — belt and braces.
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

        // "Usage:" is the canonical first line of yargs help output.
        assert.ok(!result.stdout.includes('Usage:'), `Stray --help/usage dump on stdout:\n${result.stdout}`);
        assert.ok(
            !result.stdout.includes('\n{}\n') && !result.stdout.endsWith('\n{}'),
            `Stray bare {} on stdout (serialized Error regression):\n${result.stdout}`,
        );
        assert.ok(
            !result.stdout.match(/\bCommands:\s*\n/),
            `Stray "Commands:" section in stdout (yargs help bleed-through):\n${result.stdout}`,
        );
    });

    // The second run must short-circuit as cleanly as the first: no crash on partial state
    // the first run left, no re-install because a lockfile went stale.
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

    // Wiring guard only: the version matches so nothing installs, but a removed or renamed
    // option would make yargs reject the flag as "Unknown argument" and exit non-zero.
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

    // With the cli version matched but @gjsify/rolldown-native absent, self-update normally
    // REPAIRS. `--skip-deps` means "do not touch on-disk deps", so it must instead
    // short-circuit and merely NOTE the missing engine — which needs no tarball server.
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
