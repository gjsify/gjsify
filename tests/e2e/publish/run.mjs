// E2E test for `gjsify publish` against an in-process mock npm registry.
//
// Guards the three publish regressions documented in STATUS.md (Phase E):
//   1. Wire-filename in `_attachments` / `dist.tarball` uses the UNSCOPED
//      basename (`cli-1.0.0.tgz`, not `gjsify-cli-1.0.0.tgz`) per npm
//      convention (libnpmpublish behaviour).
//   2. PUT URL encodes a scoped package as `@scope%2fname` — literal `@`,
//      lowercase `%2f` — matching npm-package-arg's escapedName shape.
//   3. Auth token is read from the file pointed to by `NPM_CONFIG_USERCONFIG`
//      (the env var `actions/setup-node` uses; `.npmrc` falls back to ~/).
//   4. Published `dependencies` ranges are resolved (no leaked `workspace:^`).
//
// Strategy: stand up a tiny HTTP server in-process (same pattern as
// `tests/e2e/upgrade/run.mjs`), write a publishable fixture package that
// carries a `workspace:^` dependency, set `npm_config_registry` + write a
// fake auth-file + point `NPM_CONFIG_USERCONFIG` at it, run `gjsify publish`
// via ASYNC `execFile` (NOT execFileSync — sync spawn starves the server),
// and assert on the captured PUT request.
//
// Registry override mechanism: `npm_config_registry` env var (honored by
// publish.ts line ~233: `process.env.npm_config_registry ?? registryFor(…)`).
// Auth mechanism: `NPM_CONFIG_USERCONFIG` env var pointing at a temp .npmrc
// file that carries `_authToken=test-token-abc123` (honored by publish.ts's
// `loadNpmrc()`, lines ~455-461).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import { createServer } from 'node:http';
import {
    writeFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/publish/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

// ---------------------------------------------------------------------------
// Minimal ustar tar builder — enough to produce a valid .tgz that gjsify
// publish can pack from a temp fixture dir (the actual pack step runs for
// real; we only need the fixture to exist).
// ---------------------------------------------------------------------------

// Token used in the fake auth .npmrc and asserted in the captured request.
const FAKE_TOKEN = 'test-token-e2e-publish-abc123';

describe('gjsify publish E2E — mock npm registry', { timeout: 2 * 60 * 1000 }, () => {
    let tmpDir;
    let registryServer;
    let registryUrl;

    /** All recorded PUT requests, keyed by arrival order. */
    let capturedPuts;

    /** Absolute path of the fake auth .npmrc written for this test run. */
    let fakeNpmrcPath;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-publish-'));
        capturedPuts = [];

        // Write a fake ~/.npmrc-style auth file the CLI reads via
        // NPM_CONFIG_USERCONFIG.  The file uses the bare `_authToken=<tok>`
        // form (no registry prefix) so it applies to any registry URL, which
        // is the shape actions/setup-node writes for most registries.
        fakeNpmrcPath = join(tmpDir, 'auth.npmrc');
        writeFileSync(fakeNpmrcPath, `_authToken=${FAKE_TOKEN}\n`, 'utf-8');

        // Stand up the in-process mock npm registry.
        // Accepts PUT /<escaped-name> and records the request for assertions.
        // Returns 200 OK so the CLI exits cleanly.
        registryServer = createServer((req, res) => {
            if (req.method === 'PUT') {
                let body = '';
                req.setEncoding('utf-8');
                req.on('data', (chunk) => { body += chunk; });
                req.on('end', () => {
                    capturedPuts.push({
                        url: req.url,
                        authorization: req.headers['authorization'] ?? null,
                        contentType: req.headers['content-type'] ?? null,
                        body: (() => { try { return JSON.parse(body); } catch { return null; } })(),
                    });
                    res.setHeader('content-type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                });
                return;
            }
            // Packument reads (GET) during publish's internal pack step may
            // also hit the registry — just 404 them safely.
            res.statusCode = 404;
            res.end('{}');
        });

        await new Promise((resolve) => registryServer.listen(0, '127.0.0.1', resolve));
        const addr = registryServer.address();
        registryUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(() => {
        registryServer?.close();
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    /**
     * Build a publishable fixture package under `tmpDir/<name>/`.
     * The package has:
     *   - a real `package.json` with the given scoped name
     *   - a `workspace:^` dep on `@gjsify/cli` (to test range resolution)
     *   - a minimal `index.js` so `pack` has something to include
     * Returns the absolute path of the fixture directory.
     */
    function scaffoldFixture(dirName, pkgName, version) {
        const dir = join(tmpDir, dirName);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: pkgName,
                    version,
                    description: 'e2e publish fixture',
                    type: 'module',
                    main: 'index.js',
                    files: ['index.js'],
                    dependencies: {
                        // workspace:^ dep — must be rewritten to a real range
                        // in the published manifest; no leaked `workspace:^`.
                        '@gjsify/cli': 'workspace:^',
                    },
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        writeFileSync(join(dir, 'index.js'), 'export const name = "fixture";\n', 'utf-8');
        return dir;
    }

    /**
     * Run `gjsify publish` (async — required so the in-process HTTP server
     * can accept connections; execFileSync would block the event loop).
     */
    async function runPublish(fixtureDir, extraEnv = {}) {
        // We pass the workspace root as cwd so gjsify can locate sibling
        // workspaces for workspace:^ resolution.
        const { stdout, stderr } = await execFileAsync(
            'node',
            [CLI_ENTRY, 'publish', fixtureDir],
            {
                timeout: 90 * 1000,
                cwd: MONOREPO_ROOT,
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    // Registry override (publish.ts line ~233).
                    npm_config_registry: registryUrl,
                    // Auth file override (publish.ts loadNpmrc, lines ~455-461).
                    NPM_CONFIG_USERCONFIG: fakeNpmrcPath,
                    // Suppress OIDC auto-detect so the test doesn't try GitHub
                    // id-token exchange (which would fail outside CI).
                    // Unset GitHub OIDC env so auto-detect falls back to token.
                    ACTIONS_ID_TOKEN_REQUEST_URL: '',
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                    NODE_AUTH_TOKEN: '',
                    ...extraEnv,
                },
            },
        );
        return { stdout, stderr };
    }

    it('PUT URL encodes scoped name as @scope%2fname (lowercase %2f)', async () => {
        const pkgName = '@gjsify/e2e-pub-url';
        const version = '1.0.0';
        const fixtureDir = scaffoldFixture('url-encode', pkgName, version);
        const beforeCount = capturedPuts.length;

        await runPublish(fixtureDir);

        assert.ok(
            capturedPuts.length > beforeCount,
            'mock registry received no PUT — publish did not fire',
        );
        const put = capturedPuts[capturedPuts.length - 1];

        // Expect: /@gjsify%2fe2e-pub-url  (literal @ + lowercase %2f)
        // publish.ts line ~244: `@${encodeURIComponent(scope)}%2f${encodeURIComponent(base)}`
        // scope = "gjsify", base = "e2e-pub-url"
        assert.ok(
            put.url.includes('%2f') || put.url.includes('%2F'),
            `PUT URL must use URL-encoded slash; got: ${put.url}`,
        );
        assert.ok(
            put.url.includes('%2f'),
            `PUT URL must use LOWERCASE %2f (not uppercase %2F); got: ${put.url}`,
        );
        assert.ok(
            put.url.startsWith('/@gjsify%2fe2e-pub-url'),
            `PUT URL must start with /@gjsify%2fe2e-pub-url; got: ${put.url}`,
        );
    });

    it('_attachments key + dist.tarball use the UNSCOPED basename', async () => {
        const pkgName = '@gjsify/e2e-pub-wire';
        const version = '2.3.4';
        const fixtureDir = scaffoldFixture('wire-filename', pkgName, version);

        await runPublish(fixtureDir);

        const put = capturedPuts[capturedPuts.length - 1];
        assert.ok(put.body, 'mock registry should have received a parseable JSON body');

        // Wire-filename convention (publish.ts lines ~255-258):
        //   unscopedName = "e2e-pub-wire"  (drop @gjsify/ prefix)
        //   wireFilename = "e2e-pub-wire-2.3.4.tgz"
        const attachments = put.body._attachments ?? {};
        const attachmentKeys = Object.keys(attachments);
        assert.ok(
            attachmentKeys.length > 0,
            '_attachments must not be empty',
        );
        const wireFilename = attachmentKeys[0];
        assert.equal(
            wireFilename,
            'e2e-pub-wire-2.3.4.tgz',
            `_attachments key must be the unscoped basename; got: ${wireFilename}`,
        );

        // dist.tarball in the version entry must also use the unscoped basename.
        const versions = put.body.versions ?? {};
        const versionEntry = versions[version] ?? {};
        const tarball = (versionEntry.dist ?? {}).tarball ?? '';
        assert.ok(
            tarball.endsWith('/e2e-pub-wire-2.3.4.tgz'),
            `dist.tarball must end with unscoped basename; got: ${tarball}`,
        );
        assert.ok(
            !tarball.includes('@'),
            `dist.tarball must not contain @ (scoped prefix); got: ${tarball}`,
        );
    });

    it('Authorization header carries the bearer token from NPM_CONFIG_USERCONFIG', async () => {
        const pkgName = '@gjsify/e2e-pub-auth';
        const version = '0.1.0';
        const fixtureDir = scaffoldFixture('auth-token', pkgName, version);

        await runPublish(fixtureDir);

        const put = capturedPuts[capturedPuts.length - 1];
        assert.ok(
            put.authorization,
            'Authorization header must be present — token not read from NPM_CONFIG_USERCONFIG',
        );
        assert.equal(
            put.authorization,
            `Bearer ${FAKE_TOKEN}`,
            `Authorization must be "Bearer ${FAKE_TOKEN}"; got: ${put.authorization}`,
        );
    });

    it('published dependencies have resolved ranges (no leaked workspace:^)', async () => {
        const pkgName = '@gjsify/e2e-pub-ws';
        const version = '0.5.0';
        const fixtureDir = scaffoldFixture('workspace-range', pkgName, version);

        await runPublish(fixtureDir);

        const put = capturedPuts[capturedPuts.length - 1];
        assert.ok(put.body, 'mock registry should have received a parseable JSON body');

        const versions = put.body.versions ?? {};
        const versionEntry = versions[version] ?? {};
        const deps = versionEntry.dependencies ?? {};

        // The fixture has `"@gjsify/cli": "workspace:^"`.  After pack rewrites
        // it, the published manifest must carry a real semver range — never the
        // literal `workspace:^` string.
        const cliRange = deps['@gjsify/cli'];
        assert.ok(
            typeof cliRange === 'string',
            `expected @gjsify/cli dep to be present in published manifest; got: ${JSON.stringify(deps)}`,
        );
        assert.ok(
            !cliRange.startsWith('workspace:'),
            `@gjsify/cli dep must not leak workspace: prefix; got: ${cliRange}`,
        );
        // Must be a semver range (starts with ^ or ~ or a digit).
        assert.ok(
            /^[\^~>=\d]/.test(cliRange),
            `@gjsify/cli dep must be a resolved semver range; got: ${cliRange}`,
        );
    });

    it('--dry-run exits 0 and does NOT PUT to the registry', async () => {
        const pkgName = '@gjsify/e2e-pub-dryrun';
        const version = '0.0.1';
        const fixtureDir = scaffoldFixture('dry-run', pkgName, version);
        const beforeCount = capturedPuts.length;

        // Invoke publish with --dry-run directly via execFile.
        const { stdout } = await execFileAsync(
            'node',
            [CLI_ENTRY, 'publish', fixtureDir, '--dry-run'],
            {
                timeout: 90 * 1000,
                cwd: MONOREPO_ROOT,
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    npm_config_registry: registryUrl,
                    NPM_CONFIG_USERCONFIG: fakeNpmrcPath,
                    ACTIONS_ID_TOKEN_REQUEST_URL: '',
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                    NODE_AUTH_TOKEN: '',
                },
            },
        );

        // No new PUTs should have arrived.
        assert.equal(
            capturedPuts.length,
            beforeCount,
            '--dry-run must not PUT to the registry',
        );
        assert.match(
            stdout,
            /dry-run/i,
            '--dry-run output should mention dry-run',
        );
    });

    it('--tolerate-republish exits 0 on 409 Conflict', async () => {
        // Stand up a one-shot 409 server to test tolerate-republish behavior.
        const conflictServer = createServer((req, res) => {
            if (req.method === 'PUT') {
                // Drain the body so the connection closes cleanly.
                req.resume();
                req.on('end', () => {
                    res.statusCode = 409;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ error: 'conflict' }));
                });
                return;
            }
            res.statusCode = 404;
            res.end('{}');
        });
        await new Promise((resolve) => conflictServer.listen(0, '127.0.0.1', resolve));
        const conflictUrl = `http://127.0.0.1:${conflictServer.address().port}`;

        try {
            const pkgName = '@gjsify/e2e-pub-conflict';
            const version = '0.0.2';
            const fixtureDir = scaffoldFixture('tolerate-republish', pkgName, version);

            const { stdout } = await execFileAsync(
                'node',
                [CLI_ENTRY, 'publish', fixtureDir, '--tolerate-republish'],
                {
                    timeout: 90 * 1000,
                    cwd: MONOREPO_ROOT,
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        npm_config_registry: conflictUrl,
                        NPM_CONFIG_USERCONFIG: fakeNpmrcPath,
                        ACTIONS_ID_TOKEN_REQUEST_URL: '',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                        NODE_AUTH_TOKEN: '',
                    },
                },
            );
            assert.match(
                stdout,
                /already published|tolerated|republish/i,
                '--tolerate-republish output should mention tolerating the conflict',
            );
        } finally {
            conflictServer.close();
        }
    });
});
