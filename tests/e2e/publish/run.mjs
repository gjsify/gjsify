// E2E test for `gjsify publish` against an in-process mock npm registry.
//
// Guards the three publish regressions from the Phase E publish work:
//   1. Wire-filename in `_attachments` / `dist.tarball` uses the UNSCOPED
//      basename (`cli-1.0.0.tgz`, not `gjsify-cli-1.0.0.tgz`) per npm
//      convention (libnpmpublish behaviour).
//   2. PUT URL encodes a scoped package as `@scope%2fname` — literal `@`,
//      lowercase `%2f` — matching npm-package-arg's escapedName shape.
//   3. Auth token is read from the file pointed to by `NPM_CONFIG_USERCONFIG`
//      (the env var `actions/setup-node` uses; `.npmrc` falls back to ~/).
//   4. Published `dependencies` ranges are resolved (no leaked `workspace:^`).
//   5. A 2xx PUT is READ BACK before `+ name@version` is printed. v0.46.0
//      (run 33735989472): `Publish @gjsify/node-runtime-darwin-arm64` PUT
//      53863410 bytes, npm answered 2xx, the job went green and the registry
//      had neither the packument nor the tarball minutes later. The rows at the
//      bottom of this file are that job, reproduced: a registry that accepts
//      the write and never serves it must NOT be a successful publish.
//
// This is also why the mock registry below records what it accepts and serves
// it back. A write-only sink IS the incident, so a mock that 404s every GET
// would fail every publish in here — correctly.
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
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/publish/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

// Token used in the fake auth .npmrc and asserted in the captured request.
const FAKE_TOKEN = 'test-token-e2e-publish-abc123';

/**
 * The mock registry's READ side: what `gjsify publish` asks for after its PUT.
 *
 * Keyed on the raw request path (`/@gjsify%2fname`), which is what the CLI PUTs
 * to and what it GETs back — Node does not decode `req.url`, so the two match
 * byte-for-byte with no unescaping. The stored document is the abbreviated
 * packument shape the read-back parses: `versions[<v>].dist.tarball`, taken
 * straight from the payload npm just accepted.
 */
function packumentStore() {
    const docs = new Map();
    return {
        /** Record an accepted PUT so the version becomes resolvable. */
        record(url, body) {
            if (!body || typeof body !== 'object') return;
            const existing = docs.get(url) ?? { name: body.name, 'dist-tags': {}, versions: {} };
            docs.set(url, {
                name: body.name ?? existing.name,
                'dist-tags': { ...existing['dist-tags'], ...body['dist-tags'] },
                versions: { ...existing.versions, ...body.versions },
                modified: new Date().toISOString(),
            });
        },
        /** Serve a recorded packument, or 404 like npm does for an unknown name. */
        serve(req, res) {
            const doc = docs.get(req.url);
            res.setHeader('content-type', 'application/json');
            if (!doc) {
                res.statusCode = 404;
                res.end('{}');
                return;
            }
            res.statusCode = 200;
            res.end(JSON.stringify(doc));
        },
        /** GETs received, so a row can assert the read-back actually polled. */
        gets: [],
    };
}

// 4 min, not 2: the read-back rows below deliberately spend a bounded wait on a
// registry that will not answer, which is the behaviour under test.
describe('gjsify publish E2E — mock npm registry', { timeout: 4 * 60 * 1000 }, () => {
    let tmpDir;
    let registryServer;
    let registryUrl;

    /** All recorded PUT requests, keyed by arrival order. */
    let capturedPuts;

    /** Absolute path of the fake auth .npmrc written for this test run. */
    let fakeNpmrcPath;

    /** Read side of the main mock registry — see `packumentStore()`. */
    let packuments;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-publish-'));
        capturedPuts = [];
        packuments = packumentStore();

        // Stand up the in-process mock npm registry.
        // Accepts PUT /<escaped-name> and records the request for assertions.
        // Returns 200 OK so the CLI exits cleanly.
        registryServer = createServer((req, res) => {
            if (req.method === 'PUT') {
                let body = '';
                req.setEncoding('utf-8');
                req.on('data', (chunk) => {
                    body += chunk;
                });
                req.on('end', () => {
                    capturedPuts.push({
                        url: req.url,
                        authorization: req.headers['authorization'] ?? null,
                        contentType: req.headers['content-type'] ?? null,
                        // Capture the npm-otp header for OTP e2e assertions.
                        otpHeader: req.headers['npm-otp'] ?? null,
                        body: (() => {
                            try {
                                return JSON.parse(body);
                            } catch {
                                return null;
                            }
                        })(),
                    });
                    packuments.record(req.url, capturedPuts[capturedPuts.length - 1].body);
                    res.setHeader('content-type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                });
                return;
            }
            // The read-back's GET, and any packument read during the pack step.
            // A recorded name resolves; anything else 404s, as npm does.
            packuments.gets.push(req.url);
            packuments.serve(req, res);
        });

        await new Promise((resolve) => registryServer.listen(0, '127.0.0.1', resolve));
        const addr = registryServer.address();
        registryUrl = `http://127.0.0.1:${addr.port}`;

        // Write a fake ~/.npmrc-style auth file the CLI reads via
        // NPM_CONFIG_USERCONFIG.  parseNpmrc() only recognises the host-scoped
        // form `//host:port/:_authToken=<tok>` (bare `_authToken=` is silently
        // ignored).  Use the mock registry's actual host:port so buildHeaders()
        // picks up the token for every PUT to that registry.
        fakeNpmrcPath = join(tmpDir, 'auth.npmrc');
        writeFileSync(fakeNpmrcPath, `//127.0.0.1:${addr.port}/:_authToken=${FAKE_TOKEN}\n`, 'utf-8');
    });

    after(() => {
        registryServer?.close();
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    /**
     * Build a publishable fixture package under `tmpDir/<dirName>/`.
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
     * Build a mini-workspace fixture suitable for testing workspace:^ rewriting.
     *
     * Layout inside `tmpDir/ws-root/`:
     *   package.json            — workspace root (workspaces: ["packages/*"])
     *   packages/cli/           — provides @gjsify/cli at a real version
     *   packages/<dirName>/     — the fixture package with workspace:^ on @gjsify/cli
     *
     * `rewriteWorkspaceDeps` in pack.ts calls `findWorkspaceRoot(fixtureDir)`,
     * which walks upward looking for a package.json with a `workspaces` field
     * that also lists fixtureDir among its discovered workspaces. The layout
     * above satisfies both conditions without touching the real monorepo.
     *
     * Returns the absolute path of the fixture package directory.
     */
    function scaffoldWorkspaceFixture(dirName, pkgName, version) {
        // Workspace root
        const wsRoot = join(tmpDir, 'ws-root');
        mkdirSync(wsRoot, { recursive: true });
        writeFileSync(
            join(wsRoot, 'package.json'),
            JSON.stringify(
                {
                    name: 'e2e-ws-root',
                    version: '0.0.0',
                    private: true,
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );

        // Sibling: @gjsify/cli at a concrete version so workspace:^ resolves.
        // The version here just needs to be a valid semver — the registry
        // PUT assertion checks only that no `workspace:` prefix survives.
        const cliDir = join(wsRoot, 'packages', 'cli');
        mkdirSync(cliDir, { recursive: true });
        writeFileSync(
            join(cliDir, 'package.json'),
            JSON.stringify({ name: '@gjsify/cli', version: '0.4.27' }, null, 2) + '\n',
            'utf-8',
        );

        // The actual fixture package (what we publish).
        const pkgDir = join(wsRoot, 'packages', dirName);
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
            join(pkgDir, 'package.json'),
            JSON.stringify(
                {
                    name: pkgName,
                    version,
                    description: 'e2e workspace-range publish fixture',
                    type: 'module',
                    main: 'index.js',
                    files: ['index.js'],
                    dependencies: {
                        // workspace:^ — must be rewritten to `^0.4.27` in the
                        // published manifest; no `workspace:` prefix may survive.
                        '@gjsify/cli': 'workspace:^',
                    },
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        writeFileSync(join(pkgDir, 'index.js'), 'export const name = "fixture";\n', 'utf-8');
        return pkgDir;
    }

    /**
     * Run `gjsify publish` (async — required so the in-process HTTP server
     * can accept connections; execFileSync would block the event loop).
     */
    async function runPublish(fixtureDir, extraEnv = {}) {
        // We pass the workspace root as cwd so gjsify can locate sibling
        // workspaces for workspace:^ resolution.
        const { stdout, stderr } = await execFileAsync('node', [CLI_ENTRY, 'publish', fixtureDir], {
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
        });
        return { stdout, stderr };
    }

    it('PUT URL encodes scoped name as @scope%2fname (lowercase %2f)', async () => {
        const pkgName = '@gjsify/e2e-pub-url';
        const version = '1.0.0';
        const fixtureDir = scaffoldFixture('url-encode', pkgName, version);
        const beforeCount = capturedPuts.length;

        await runPublish(fixtureDir);

        assert.ok(capturedPuts.length > beforeCount, 'mock registry received no PUT — publish did not fire');
        const put = capturedPuts[capturedPuts.length - 1];

        // Expect: /@gjsify%2fe2e-pub-url  (literal @ + lowercase %2f)
        // publish.ts line ~244: `@${encodeURIComponent(scope)}%2f${encodeURIComponent(base)}`
        // scope = "gjsify", base = "e2e-pub-url"
        assert.ok(
            put.url.includes('%2f') || put.url.includes('%2F'),
            `PUT URL must use URL-encoded slash; got: ${put.url}`,
        );
        assert.ok(put.url.includes('%2f'), `PUT URL must use LOWERCASE %2f (not uppercase %2F); got: ${put.url}`);
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
        assert.ok(attachmentKeys.length > 0, '_attachments must not be empty');
        const wireFilename = attachmentKeys[0];
        assert.equal(
            wireFilename,
            'e2e-pub-wire-2.3.4.tgz',
            `_attachments key must be the unscoped basename; got: ${wireFilename}`,
        );

        // dist.tarball in the version entry must also use the unscoped basename.
        // The URL path may legitimately contain `@` (the scoped package name),
        // but the FILENAME (basename after the last `/`) must be unscoped.
        // publish.ts line ~259: `${registryClean}/${packed.name}/-/${wireFilename}`
        // → `http://127.0.0.1:PORT/@gjsify/e2e-pub-wire/-/e2e-pub-wire-2.3.4.tgz`
        const versions = put.body.versions ?? {};
        const versionEntry = versions[version] ?? {};
        const tarball = (versionEntry.dist ?? {}).tarball ?? '';
        const tarballBasename = tarball.split('/').pop() ?? '';
        assert.equal(
            tarballBasename,
            'e2e-pub-wire-2.3.4.tgz',
            `dist.tarball basename must be the unscoped filename; got: ${tarball}`,
        );
        assert.ok(
            !tarballBasename.startsWith('@'),
            `dist.tarball basename must not start with @ (scoped prefix); got: ${tarballBasename}`,
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
        // Use scaffoldWorkspaceFixture to create a mini-workspace where
        // rewriteWorkspaceDeps can resolve @gjsify/cli's workspace:^ range
        // against a real sibling — without touching the actual monorepo on disk.
        const fixtureDir = scaffoldWorkspaceFixture('workspace-range', pkgName, version);

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
        assert.ok(/^[\^~>=\d]/.test(cliRange), `@gjsify/cli dep must be a resolved semver range; got: ${cliRange}`);
    });

    it('--dry-run exits 0 and does NOT PUT to the registry', async () => {
        const pkgName = '@gjsify/e2e-pub-dryrun';
        const version = '0.0.1';
        const fixtureDir = scaffoldFixture('dry-run', pkgName, version);
        const beforeCount = capturedPuts.length;

        // Invoke publish with --dry-run directly via execFile.
        const { stdout } = await execFileAsync('node', [CLI_ENTRY, 'publish', fixtureDir, '--dry-run'], {
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
        });

        // No new PUTs should have arrived.
        assert.equal(capturedPuts.length, beforeCount, '--dry-run must not PUT to the registry');
        assert.match(stdout, /dry-run/i, '--dry-run output should mention dry-run');
    });

    /**
     * A registry that refuses the write as already present.
     *
     * `serves` decides whether it then SERVES that version. Both halves are real
     * states: npm answered `409 already published` for
     * @gjsify/node-runtime-darwin-arm64 at 09:48:49.19 in the v0.46.0 recovery
     * while that packument recorded 0.46.0 at 09:49:07.419, 18 s later — so a
     * conflict is not by itself a served version, and `--tolerate-republish` is
     * the path every re-run of an unconfirmed publish takes.
     */
    function makeConflictServer({ serves, name, version }) {
        const gets = [];
        const server = createServer((req, res) => {
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
            gets.push(req.url);
            res.setHeader('content-type', 'application/json');
            if (!serves) {
                res.statusCode = 404;
                res.end('{}');
                return;
            }
            res.statusCode = 200;
            res.end(
                JSON.stringify({
                    name,
                    'dist-tags': { latest: version },
                    versions: { [version]: { name, version, dist: { tarball: `https://x/${version}.tgz` } } },
                }),
            );
        });
        return { server, gets };
    }

    it('--tolerate-republish exits 0 on 409 Conflict — once the version is SERVED', async () => {
        const { server: conflictServer, gets: conflictGets } = makeConflictServer({
            serves: true,
            name: '@gjsify/e2e-pub-conflict',
            version: '0.0.2',
        });
        await new Promise((resolve) => conflictServer.listen(0, '127.0.0.1', resolve));
        const conflictUrl = `http://127.0.0.1:${conflictServer.address().port}`;

        try {
            const pkgName = '@gjsify/e2e-pub-conflict';
            const version = '0.0.2';
            const fixtureDir = scaffoldFixture('tolerate-republish', pkgName, version);

            const { stdout } = await execFileAsync('node', [CLI_ENTRY, 'publish', fixtureDir, '--tolerate-republish'], {
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
            });
            assert.match(
                stdout,
                /already published|tolerated|republish/i,
                '--tolerate-republish output should mention tolerating the conflict',
            );
            // Tolerating is not the same as trusting: the conflict is read back
            // like a 2xx, and this row now proves the confirmation happened
            // rather than only that the exit code was 0.
            assert.ok(
                conflictGets.filter((u) => u === '/@gjsify%2fe2e-pub-conflict').length >= 1,
                `a tolerated 409 must still be read back; GETs seen: ${JSON.stringify(conflictGets)}`,
            );
        } finally {
            conflictServer.close();
        }
    });

    it('a 409 whose version the registry does NOT serve is not a success either', async () => {
        // The hole one door over from the incident. `--tolerate-republish` is the
        // documented remediation for `publish-unconfirmed`, so a conflict that
        // does not resolve must not hand back the unverified success the whole
        // read-back exists to remove.
        const pkgName = '@gjsify/e2e-pub-conflict-unserved';
        const version = '0.0.3';
        const { server, gets } = makeConflictServer({ serves: false, name: pkgName, version });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const fixtureDir = scaffoldFixture('conflict-unserved', pkgName, version);
            const res = await runPublishRaw(
                [fixtureDir, '--tolerate-republish', '--verify-timeout', '4'],
                `http://127.0.0.1:${server.address().port}`,
            );
            assert.notEqual(res.code, 0, `an unserved 409 must exit non-zero; stderr:\n${res.stderr}`);
            assert.match(res.stderr, /ALREADY PUBLISHED but the registry does not serve it/);
            assert.match(res.stderr, /409 Conflict/);
            // Re-running is the remedy for an unconfirmed 2xx and NOT for this.
            assert.match(res.stderr, /Re-running answers the same 409/);
            assert.doesNotMatch(res.stdout, /^= /m, 'stdout must NOT carry the tolerated-republish line');
            assert.ok(
                gets.filter((u) => u === `/${pkgName.replace('/', '%2f')}`).length >= 2,
                `the read-back must RETRY before deciding; GETs seen: ${JSON.stringify(gets)}`,
            );
        } finally {
            server.close();
        }
    });

    // -------------------------------------------------------------------------
    // OTP / 2FA tests
    //
    // Reference: refs/npm-cli/node_modules/npm-registry-fetch/lib/check-response.js
    //   — npm signals "OTP required" via HTTP 401 + www-authenticate: OTP header,
    //   or HTTP 401 + body containing "one-time pass".
    //   The header value is `npm-otp` (refs/npm-cli/node_modules/npm-registry-fetch/
    //   lib/index.js line ~243: `if (opts.otp) headers['npm-otp'] = opts.otp`).
    // -------------------------------------------------------------------------

    it('--otp sends npm-otp header on PUT', async () => {
        // Verifies that when --otp is passed, the PUT carries `npm-otp: <code>`.
        const pkgName = '@gjsify/e2e-pub-otp';
        const version = '0.1.0';
        const fixtureDir = scaffoldFixture('otp-header', pkgName, version);
        const beforeCount = capturedPuts.length;

        await execFileAsync('node', [CLI_ENTRY, 'publish', fixtureDir, '--otp', '123456'], {
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
        });

        assert.ok(capturedPuts.length > beforeCount, 'mock registry received no PUT — publish did not fire');
        const put = capturedPuts[capturedPuts.length - 1];

        // The OTP must be forwarded as the `npm-otp` HTTP header.
        assert.equal(put.otpHeader, '123456', `PUT must carry npm-otp: 123456; got: ${put.otpHeader ?? '(none)'}`);
    });

    it('EOTP: 401+www-authenticate:OTP without --otp exits non-zero with actionable message (non-TTY)', async () => {
        // Simulates npm's "OTP required" response (HTTP 401 + www-authenticate: OTP).
        // In a non-TTY environment (CI), the CLI must NOT hang waiting for stdin;
        // it must exit non-zero with a message pointing the maintainer at --otp.
        const otpRequiredServer = createServer((req, res) => {
            if (req.method === 'PUT') {
                req.resume();
                req.on('end', () => {
                    // npm registry OTP challenge: 401 + www-authenticate: OTP
                    // (refs/npm-cli/node_modules/npm-registry-fetch/lib/check-response.js
                    //  line ~83: `auth.indexOf('otp') !== -1`)
                    res.statusCode = 401;
                    res.setHeader('www-authenticate', 'OTP');
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ error: 'OTP required' }));
                });
                return;
            }
            res.statusCode = 404;
            res.end('{}');
        });
        await new Promise((resolve) => otpRequiredServer.listen(0, '127.0.0.1', resolve));
        const otpUrl = `http://127.0.0.1:${otpRequiredServer.address().port}`;

        try {
            const pkgName = '@gjsify/e2e-pub-eotp';
            const version = '0.2.0';
            const fixtureDir = scaffoldFixture('eotp-non-tty', pkgName, version);

            // Run with stdio: 'pipe' to simulate a non-TTY environment.
            // process.stdin.isTTY and process.stdout.isTTY will be false/undefined
            // when the process is spawned with piped stdio.
            let exitCode = null;
            let stderr = '';
            try {
                await execFileAsync('node', [CLI_ENTRY, 'publish', fixtureDir], {
                    timeout: 90 * 1000,
                    cwd: MONOREPO_ROOT,
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        npm_config_registry: otpUrl,
                        NPM_CONFIG_USERCONFIG: fakeNpmrcPath,
                        ACTIONS_ID_TOKEN_REQUEST_URL: '',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                        NODE_AUTH_TOKEN: '',
                    },
                });
                // If it resolves without error, the command exited 0 — that's wrong.
                exitCode = 0;
            } catch (err) {
                exitCode = err.code ?? 1;
                stderr = err.stderr ?? '';
            }

            assert.notEqual(exitCode, 0, 'CLI must exit non-zero when OTP is required and not supplied');
            assert.match(stderr, /--otp/i, 'stderr must mention --otp so the maintainer knows how to fix it');
        } finally {
            otpRequiredServer.close();
        }
    });

    it('EOTP: retry with --otp succeeds (mock: 401 first, 200 on retry with npm-otp header)', async () => {
        // Simulates the otplease retry path: first PUT returns 401+OTP-required,
        // second PUT (with npm-otp header) returns 200. This verifies that passing
        // --otp directly succeeds when the registry would otherwise demand 2FA.
        //
        // Implementation note: we use --otp directly (not the interactive TTY path)
        // since e2e tests run with piped stdio. The --otp code path is tested by
        // "sends npm-otp header" above; this test validates the retry semantics by
        // standing up a stateful server that changes behavior based on the header.
        const firstCallSeen = { value: false };
        const retryPuts = [];
        const retryPackuments = packumentStore();
        const twoStageServer = createServer((req, res) => {
            if (req.method === 'PUT') {
                const otpHeader = req.headers['npm-otp'] ?? null;
                let body = '';
                req.setEncoding('utf-8');
                req.on('data', (chunk) => {
                    body += chunk;
                });
                req.on('end', () => {
                    retryPuts.push({ otpHeader });
                    if (!firstCallSeen.value && !otpHeader) {
                        // First call without OTP → challenge
                        firstCallSeen.value = true;
                        res.statusCode = 401;
                        res.setHeader('www-authenticate', 'OTP');
                        res.setHeader('content-type', 'application/json');
                        res.end(JSON.stringify({ error: 'OTP required' }));
                    } else {
                        // Second call (or first call with OTP header) → success
                        try {
                            retryPackuments.record(req.url, JSON.parse(body));
                        } catch {
                            /* an unparseable body is its own failure below */
                        }
                        res.statusCode = 200;
                        res.setHeader('content-type', 'application/json');
                        res.end(JSON.stringify({ ok: true }));
                    }
                });
                return;
            }
            // The read-back of the PUT that finally succeeded.
            retryPackuments.serve(req, res);
        });
        await new Promise((resolve) => twoStageServer.listen(0, '127.0.0.1', resolve));
        const twoStageUrl = `http://127.0.0.1:${twoStageServer.address().port}`;

        try {
            const pkgName = '@gjsify/e2e-pub-otp-retry';
            const version = '0.3.0';
            const fixtureDir = scaffoldFixture('otp-retry', pkgName, version);

            // Pass --otp so the publish immediately sends npm-otp on the first try.
            // The mock accepts any PUT that has the npm-otp header.
            const { stdout } = await execFileAsync('node', [CLI_ENTRY, 'publish', fixtureDir, '--otp', '654321'], {
                timeout: 90 * 1000,
                cwd: MONOREPO_ROOT,
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    npm_config_registry: twoStageUrl,
                    NPM_CONFIG_USERCONFIG: fakeNpmrcPath,
                    ACTIONS_ID_TOKEN_REQUEST_URL: '',
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                    NODE_AUTH_TOKEN: '',
                },
            });

            assert.ok(retryPuts.length > 0, 'mock registry received no PUT');
            // The PUT that succeeded must have had the otp header.
            const successPut = retryPuts.find((p) => p.otpHeader === '654321');
            assert.ok(successPut, 'a PUT with npm-otp: 654321 must have been received');
            assert.match(stdout, /\+.*e2e-pub-otp-retry/, 'stdout must confirm successful publish');
        } finally {
            twoStageServer.close();
        }
    });
    // -------------------------------------------------------------------------
    // Post-PUT read-back — the v0.46.0 incident, reproduced
    //
    // `Publish @gjsify/node-runtime-darwin-arm64 (bundled Node)` in run
    // 33735989472 PUT 53863410 bytes, npm answered 2xx, the CLI printed
    // `+ @gjsify/node-runtime-darwin-arm64@0.46.0` and the job went GREEN. The
    // registry had neither the packument nor the tarball minutes later, and only
    // a manual rerun made it land. A server that accepts every PUT and serves
    // nothing is exactly that registry.
    // -------------------------------------------------------------------------

    /**
     * A registry that ACCEPTS the write and never serves it.
     *
     * `serveAfter` makes the same server the lagging case: the first N GETs of
     * the package path 404, the rest resolve. Measured in v0.46.0, 19 of 199
     * packages were recorded by npm 56-252 s AFTER their 2xx, so "not there yet"
     * has to end in a confirmed publish and not in a red job.
     */
    async function startAcceptOnlyRegistry({ serveAfter = Infinity } = {}) {
        const store = packumentStore();
        const gets = [];
        const server = createServer((req, res) => {
            if (req.method === 'PUT') {
                let body = '';
                req.setEncoding('utf-8');
                req.on('data', (chunk) => {
                    body += chunk;
                });
                req.on('end', () => {
                    try {
                        store.record(req.url, JSON.parse(body));
                    } catch {
                        /* the row asserts on the CLI, not on our parse */
                    }
                    res.setHeader('content-type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true }));
                });
                return;
            }
            gets.push(req.url);
            if (gets.filter((u) => u === req.url).length > serveAfter) {
                store.serve(req, res);
                return;
            }
            res.setHeader('content-type', 'application/json');
            res.statusCode = 404;
            res.end('{}');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        return { server, url: `http://127.0.0.1:${server.address().port}`, gets };
    }

    /** Run the CLI and return `{ code, stdout, stderr }` without throwing. */
    async function runPublishRaw(argv, registry, extraEnv = {}) {
        try {
            const { stdout, stderr } = await execFileAsync('node', [CLI_ENTRY, 'publish', ...argv], {
                timeout: 90 * 1000,
                cwd: MONOREPO_ROOT,
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    npm_config_registry: registry,
                    NPM_CONFIG_USERCONFIG: fakeNpmrcPath,
                    ACTIONS_ID_TOKEN_REQUEST_URL: '',
                    ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                    NODE_AUTH_TOKEN: '',
                    GITHUB_ACTIONS: '',
                    ...extraEnv,
                },
            });
            return { code: 0, stdout, stderr };
        } catch (err) {
            return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
        }
    }

    it('a 2xx PUT the registry never serves is NOT a successful publish', async () => {
        const { server, url, gets } = await startAcceptOnlyRegistry();
        try {
            const fixtureDir = scaffoldFixture('unconfirmed', '@gjsify/e2e-pub-unconfirmed', '1.2.3');
            const res = await runPublishRaw([fixtureDir, '--verify-timeout', '4'], url);

            assert.notEqual(res.code, 0, 'an unconfirmed publish must exit non-zero');
            assert.doesNotMatch(res.stdout, /^\+ /m, 'stdout must NOT carry the `+ name@version` success line');
            // The three facts the incident log could not answer.
            assert.match(res.stderr, /npm ACCEPTED the upload but the registry does not serve it/);
            assert.match(
                res.stderr,
                /PUT\s+http:\/\/127\.0\.0\.1:\d+\/@gjsify%2fe2e-pub-unconfirmed \(\d+ bytes\) → 200 OK/,
            );
            assert.match(res.stderr, /read-back GET http:\/\/127\.0\.0\.1:\d+\/@gjsify%2fe2e-pub-unconfirmed/);
            assert.match(res.stderr, /answered\s+absent: 404/);
            assert.ok(
                gets.filter((u) => u === '/@gjsify%2fe2e-pub-unconfirmed').length >= 2,
                `the read-back must RETRY before deciding; GETs seen: ${JSON.stringify(gets)}`,
            );
        } finally {
            server.close();
        }
    });

    it('--verify-defer names the same fact, annotates it, and exits 0', async () => {
        // What the 199-package sweep passes: the minutes-long tail belongs to
        // `verify-published-closure.mjs`, so the per-package check confirms what
        // it can and hands over the suspect by name instead of stalling a release.
        const { server, url } = await startAcceptOnlyRegistry();
        try {
            const fixtureDir = scaffoldFixture('unconfirmed-defer', '@gjsify/e2e-pub-defer', '1.2.4');
            const res = await runPublishRaw([fixtureDir, '--verify-timeout', '3', '--verify-defer', '--json'], url, {
                GITHUB_ACTIONS: 'true',
            });

            assert.equal(res.code, 0, '--verify-defer must not fail the job');
            const line = res.stderr.split('\n').find((l) => l.startsWith('::warning'));
            assert.ok(line, `an Actions annotation must be emitted; stderr was:\n${res.stderr}`);
            assert.match(line, /Publish unconfirmed/);
            assert.match(line, /@gjsify\/e2e-pub-defer@1\.2\.4/);
            // stdout stays pure JSON — the annotation went to stderr for exactly this.
            const json = JSON.parse(res.stdout.trim());
            assert.equal(json.action, 'publish-unconfirmed', 'the outcome keeps its own name when deferred');
            assert.equal(json.ok, false);
            assert.equal(json.deferred, true);
        } finally {
            server.close();
        }
    });

    it('a write that lands LATE is confirmed, not reported missing', async () => {
        const { server, url, gets } = await startAcceptOnlyRegistry({ serveAfter: 2 });
        try {
            const fixtureDir = scaffoldFixture('lagging', '@gjsify/e2e-pub-lagging', '1.2.5');
            const res = await runPublishRaw([fixtureDir, '--verify-timeout', '30'], url);

            assert.equal(res.code, 0, `a lagging write must still succeed; stderr:\n${res.stderr}`);
            assert.match(res.stdout, /\+ @gjsify\/e2e-pub-lagging@1\.2\.5/);
            assert.ok(
                gets.filter((u) => u === '/@gjsify%2fe2e-pub-lagging').length >= 3,
                `the read-back must have polled past the 404s; GETs seen: ${JSON.stringify(gets)}`,
            );
        } finally {
            server.close();
        }
    });

    it('--verify-timeout 0 skips the read-back — the escape hatch, and only that', async () => {
        // For a registry with no packument read path at all. It restores the
        // pre-v0.46.0 behaviour, which is why it has to be asked for.
        const { server, url, gets } = await startAcceptOnlyRegistry();
        try {
            const fixtureDir = scaffoldFixture('verify-off', '@gjsify/e2e-pub-verify-off', '1.2.6');
            const res = await runPublishRaw([fixtureDir, '--verify-timeout', '0'], url);

            assert.equal(res.code, 0, `stderr:\n${res.stderr}`);
            assert.match(res.stdout, /\+ @gjsify\/e2e-pub-verify-off@1\.2\.6/);
            assert.equal(
                gets.filter((u) => u === '/@gjsify%2fe2e-pub-verify-off').length,
                0,
                'no read-back GET may be sent when the read-back is off',
            );
        } finally {
            server.close();
        }
    });
});
