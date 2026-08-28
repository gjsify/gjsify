// E2E test for `gjsify onboard` against an in-process mock npm registry.
//
// `gjsify onboard` ensures every publishable @gjsify/* workspace is both
// PUBLISHED and TRUSTED, doing the minimum work. This suite stands up a tiny
// stateful mock registry (modelled on tests/e2e/publish/run.mjs) that simulates:
//   - a not-yet-published package (trust GET → 404),
//   - a published-but-untrusted package (trust GET → 200 []),
//   - a published + trusted package (trust GET → 200 [github-entry]),
//   - an OTP challenge (401 + www-authenticate: OTP) on every publish PUT /
//     trust POST that lacks a valid `npm-otp` header, accepting ONE code,
//   - a dead-token → login path (/-/whoami → {} for a dead token, PUT
//     /-/user/... → {token}).
//
// Asserts:
//   * onboard publishes + trusts ONLY the missing packages, skips the done one;
//   * it reuses ONE OTP across N package operations (the child is driven
//     expect-style: we count how many times it prints the OTP prompt — must be
//     exactly 1, never once-per-package);
//   * re-running is idempotent (no new publishes/trusts, exit 0);
//   * the login flow is GATED on whoami (live token → no login; dead → login).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/onboard/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

const LIVE_TOKEN = 'live-token-onboard-e2e';
const DEAD_TOKEN = 'dead-token-onboard-e2e';
const OTP_CODE = '246810';
const USERNAME = 'onboarder';
const PASSWORD = 's3cr3t-pw';

/** The github trust entry a "trusted" package reports (must match repo+workflow). */
const TRUST_ENTRY = {
    id: 'trust-1',
    type: 'github',
    claims: { repository: 'test/repo', workflow_ref: { file: 'release.yml' } },
    permissions: ['createPackage'],
};

function decodeName(escaped) {
    return escaped.replace(/%2f/gi, '/');
}

describe('gjsify onboard E2E — mock npm registry', { timeout: 3 * 60 * 1000 }, () => {
    let server;
    let registryUrl;
    let host; // 127.0.0.1:PORT

    // Mutable, reset per test.
    let pkgState; // name -> { published, trusted }
    let publishPuts; // [{ name, otp }]
    let packumentGets; // names whose EXISTENCE was read from the packument
    let trustPosts; // [{ name, otp }]
    let loginHits; // count of PUT /-/user/...

    before(async () => {
        server = createServer((req, res) => {
            const auth = req.headers['authorization'] ?? '';
            const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
            const otp = req.headers['npm-otp'] ?? null;
            const url = req.url ?? '';
            const method = req.method ?? 'GET';

            const sendJson = (code, body) => {
                res.statusCode = code;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body));
            };
            const otpChallenge = () => {
                res.statusCode = 401;
                res.setHeader('www-authenticate', 'OTP');
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'OTP required' }));
            };
            const drain = (cb) => {
                req.resume();
                req.on('end', cb);
            };

            // whoami — dead token yields {}.
            if (method === 'GET' && url === '/-/whoami') {
                sendJson(200, token === LIVE_TOKEN ? { username: USERNAME } : {});
                return;
            }
            // login (legacy CouchDB) — always mints the live token.
            if (method === 'PUT' && url.startsWith('/-/user/')) {
                drain(() => {
                    loginHits++;
                    sendJson(200, { ok: true, id: 'org.couchdb.user:onboarder', token: LIVE_TOKEN });
                });
                return;
            }
            // trust config endpoint.
            const trustMatch = url.match(/^\/-\/package\/(.+)\/trust$/);
            if (trustMatch) {
                const name = decodeName(trustMatch[1]);
                if (method === 'GET') {
                    const st = pkgState[name];
                    // A 401 with NO `www-authenticate: OTP` — not an answerable
                    // challenge, so the state stays unreadable after the retry.
                    // This is what an unauthenticated sweep sees for EVERY
                    // package, and the shape that used to exit 0.
                    if (st?.unreadable) {
                        res.statusCode = 401;
                        res.setHeader('content-type', 'application/json');
                        res.end(JSON.stringify({ error: 'Unauthorized' }));
                        return;
                    }
                    // `emptyWhenAbsent` is what REAL npm does for a name nobody
                    // published: `200` with an empty trust list, indistinguishable
                    // from a published package that has no trusted publisher. The
                    // plain `404` below is the easy shape this suite used to model
                    // exclusively — and under it `onboard` never had a decision to
                    // get wrong, so the defect could not appear here.
                    if (!st || !st.published) {
                        if (st?.emptyWhenAbsent) {
                            sendJson(200, []);
                            return;
                        }
                        sendJson(404, { error: 'package not found' });
                        return;
                    }
                    sendJson(200, st.trusted ? [TRUST_ENTRY] : []);
                    return;
                }
                if (method === 'POST') {
                    drain(() => {
                        if (otp !== OTP_CODE) {
                            otpChallenge();
                            return;
                        }
                        trustPosts.push({ name, otp });
                        if (pkgState[name]) pkgState[name].trusted = true;
                        sendJson(201, { ok: true });
                    });
                    return;
                }
            }
            // PACKUMENT — the endpoint `onboard` reads to decide whether a name
            // EXISTS. The trust endpoint cannot answer that: real npm serves
            // `200 []` both for a published package with no trusted publisher and
            // for a name nobody ever published. Modelled here because a stub that
            // omits an endpoint the tool calls does not report "unimplemented" —
            // it reports `404`, which reads as "this package does not exist", for
            // every package at once.
            if (method === 'GET' && !url.startsWith('/-/')) {
                const name = decodeName(url.slice(1));
                const st = pkgState[name];
                if (!st || !st.published) {
                    sendJson(404, { error: 'Not found' });
                    return;
                }
                packumentGets.push(name);
                sendJson(200, { name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name } } });
                return;
            }
            // publish PUT (any /<escaped-name> that is not an /-/ route).
            if (method === 'PUT' && !url.startsWith('/-/')) {
                const name = decodeName(url.slice(1));
                drain(() => {
                    if (otp !== OTP_CODE) {
                        otpChallenge();
                        return;
                    }
                    publishPuts.push({ name, otp });
                    pkgState[name] = { ...(pkgState[name] ?? { trusted: false }), published: true };
                    sendJson(200, { ok: true });
                });
                return;
            }
            sendJson(404, { error: 'not found' });
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        host = `127.0.0.1:${addr.port}`;
        registryUrl = `http://${host}`;
    });

    after(() => server?.close());

    beforeEach(() => {
        publishPuts = [];
        packumentGets = [];
        trustPosts = [];
        loginHits = 0;
    });

    /**
     * Scaffold a mini-monorepo whose packages onboard will sweep. Returns
     * { root, npmrcPath }. `token` seeds the initial npmrc auth token.
     */
    function scaffoldMonorepo(token) {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-onboard-'));
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ name: 'onb-root', version: '0.0.0', private: true, workspaces: ['packages/*'] }, null, 2) +
                '\n',
        );
        const pkg = (name) => {
            const dir = join(root, 'packages', name.replace('@onb/', ''));
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    { name, version: '1.0.0', type: 'module', main: 'index.js', files: ['index.js'] },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(dir, 'index.js'), 'export const ok = true;\n');
        };
        pkg('@onb/published-trusted');
        pkg('@onb/published-untrusted');
        pkg('@onb/unpublished-a');
        pkg('@onb/unpublished-b');
        pkg('@onb/never-published-2xx');
        // A private package that must be EXCLUDED from the sweep.
        const privDir = join(root, 'packages', 'private-one');
        mkdirSync(privDir, { recursive: true });
        writeFileSync(
            join(privDir, 'package.json'),
            JSON.stringify({ name: '@onb/private-one', version: '1.0.0', private: true }, null, 2) + '\n',
        );

        const npmrcPath = join(root, 'auth.npmrc');
        writeFileSync(npmrcPath, `//${host}/:_authToken=${token}\n`);
        return { root, npmrcPath };
    }

    /**
     * Scaffold a monorepo that is NOT an npm/yarn workspace: package directories
     * at the top level and NO root package.json at all. This is `gjsify/types`
     * in miniature — 704 `@girs/*` directories under a root whose only tracked
     * file is `.gitignore` — and it is the shape onboard could not see before
     * `--packages`: workspace discovery threw on the missing root manifest, so
     * the sweep never got as far as producing an empty list.
     */
    function scaffoldFlatRepo(token) {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-onboard-flat-'));
        const pkg = (name, dir, extra = {}) => {
            const d = join(root, dir);
            mkdirSync(d, { recursive: true });
            writeFileSync(
                join(d, 'package.json'),
                JSON.stringify({ name, version: '4.2.0', type: 'module', ...extra }, null, 2) + '\n',
            );
        };
        pkg('@onb/flat-gtk', 'gtk-4.0');
        pkg('@onb/flat-adw', 'adw-1');
        pkg('@onb/flat-gio', 'gio-2.0');
        pkg('@onb/flat-private', 'private-ns', { private: true });
        // A directory that is not a package — the glob must skip it silently.
        mkdirSync(join(root, 'docs'), { recursive: true });

        const npmrcPath = join(root, 'auth.npmrc');
        writeFileSync(npmrcPath, `//${host}/:_authToken=${token}\n`);
        return { root, npmrcPath };
    }

    /** Fresh package state for a run. */
    function freshState() {
        return {
            '@onb/published-trusted': { published: true, trusted: true },
            '@onb/published-untrusted': { published: true, trusted: false },
            '@onb/unpublished-a': { published: false, trusted: false },
            '@onb/unpublished-b': { published: false, trusted: false },
            // The shape real npm produces and this suite never had: absent,
            // but the trust read answers `200 []` instead of `404`.
            '@onb/never-published-2xx': { published: false, trusted: false, emptyWhenAbsent: true },
        };
    }

    /**
     * Run `gjsify onboard`, driving stdin expect-style: send the OTP code each
     * time it prints the OTP prompt, and username/password on the login prompts.
     * Returns { code, stdout, stderr, otpPrompts }.
     */
    function runOnboard(root, npmrcPath, extraArgs = [], creds = {}) {
        return new Promise((resolve) => {
            const child = spawn(
                'node',
                [CLI_ENTRY, 'onboard', '--repository', 'test/repo', '--registry', registryUrl, ...extraArgs],
                {
                    cwd: root,
                    env: {
                        ...process.env,
                        NPM_CONFIG_USERCONFIG: npmrcPath,
                        npm_config_registry: registryUrl,
                        ACTIONS_ID_TOKEN_REQUEST_URL: '',
                        ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
                        NODE_AUTH_TOKEN: '',
                    },
                    stdio: ['pipe', 'pipe', 'pipe'],
                },
            );
            let stdout = '';
            let stderr = '';
            let otpPrompts = 0;
            let sentUser = false;
            let sentPass = false;
            const respond = () => {
                const otpSeen = (stdout.match(/Enter OTP:/g) ?? []).length;
                while (otpPrompts < otpSeen) {
                    otpPrompts++;
                    child.stdin.write(`${OTP_CODE}\n`);
                }
                if (creds.username && !sentUser && /Username:/.test(stdout)) {
                    sentUser = true;
                    child.stdin.write(`${creds.username}\n`);
                }
                if (creds.password && !sentPass && /Password:/.test(stdout)) {
                    sentPass = true;
                    child.stdin.write(`${creds.password}\n`);
                }
            };
            child.stdout.on('data', (d) => {
                stdout += d.toString();
                respond();
            });
            child.stderr.on('data', (d) => {
                stderr += d.toString();
            });
            child.on('close', (code) => resolve({ code, stdout, stderr, otpPrompts }));
        });
    }

    it('publishes + trusts only the missing packages, reusing ONE OTP; skips the done one', async () => {
        pkgState = freshState();
        const { root, npmrcPath } = scaffoldMonorepo(LIVE_TOKEN);
        try {
            const { code, stdout, otpPrompts } = await runOnboard(root, npmrcPath);

            assert.equal(code, 0, `onboard should exit 0; stdout:\n${stdout}`);

            // ONE OTP prompt for the whole sweep (never once-per-package).
            assert.equal(otpPrompts, 1, `expected exactly 1 OTP prompt for the whole sweep; got ${otpPrompts}`);

            // Only the two unpublished packages were published.
            const publishedNames = publishPuts.map((p) => p.name).sort();
            // `never-published-2xx` is the regression gate. Its trust read is
            // `200 []` — the answer a published-but-untrusted package gives —
            // so deriving existence from that endpoint alone lands it in
            // `trust`, and onboard reports success having published nothing.
            assert.deepEqual(publishedNames, ['@onb/never-published-2xx', '@onb/unpublished-a', '@onb/unpublished-b']);
            // Every publish carried the shared OTP.
            assert.ok(
                publishPuts.every((p) => p.otp === OTP_CODE),
                'every publish PUT must carry the shared OTP',
            );

            // Trust was configured for the two new ones + the untrusted one, NOT the done one.
            const trustedNames = trustPosts.map((p) => p.name).sort();
            assert.deepEqual(trustedNames, [
                '@onb/never-published-2xx',
                '@onb/published-untrusted',
                '@onb/unpublished-a',
                '@onb/unpublished-b',
            ]);
            // And the CONTROL in the row: `published-untrusted` has the SAME
            // trust answer and must NOT be published. Without it this test
            // would pass just as well if onboard published everything.
            assert.ok(
                !publishPuts.some((p) => p.name === '@onb/published-untrusted'),
                'a published package must be trusted, never re-published',
            );
            assert.ok(
                !trustPosts.some((p) => p.name === '@onb/published-trusted'),
                'the already-published+trusted package must be skipped',
            );
            // The private package is never touched.
            assert.ok(!publishPuts.some((p) => p.name === '@onb/private-one'));
            assert.ok(!trustPosts.some((p) => p.name === '@onb/private-one'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('is idempotent — a second run does nothing and exits 0', async () => {
        pkgState = freshState();
        const { root, npmrcPath } = scaffoldMonorepo(LIVE_TOKEN);
        try {
            const first = await runOnboard(root, npmrcPath);
            assert.equal(first.code, 0);
            // Everything is now published + trusted; reset counters and re-run.
            publishPuts = [];
            packumentGets = [];
            trustPosts = [];
            const second = await runOnboard(root, npmrcPath);
            assert.equal(second.code, 0, `re-run should exit 0; stdout:\n${second.stdout}`);
            assert.equal(publishPuts.length, 0, 'a fully-onboarded workspace must publish nothing on re-run');
            assert.equal(trustPosts.length, 0, 'a fully-onboarded workspace must trust nothing on re-run');
            assert.equal(second.otpPrompts, 0, 'no OTP is needed when there is nothing to do');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('--dry-run reports the plan and changes nothing', async () => {
        pkgState = freshState();
        const { root, npmrcPath } = scaffoldMonorepo(LIVE_TOKEN);
        try {
            const { code, stdout } = await runOnboard(root, npmrcPath, ['--dry-run']);
            assert.equal(code, 0);
            assert.equal(publishPuts.length, 0, '--dry-run must not publish');
            assert.equal(trustPosts.length, 0, '--dry-run must not configure trust');
            assert.match(stdout, /dry-run/i);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('gates login on whoami — a LIVE token does not trigger login', async () => {
        // All packages already done → no OTP, no publishing; just the auth gate.
        pkgState = {
            '@onb/published-trusted': { published: true, trusted: true },
            '@onb/published-untrusted': { published: true, trusted: true },
            '@onb/unpublished-a': { published: true, trusted: true },
            '@onb/unpublished-b': { published: true, trusted: true },
            '@onb/never-published-2xx': { published: true, trusted: true },
        };
        const { root, npmrcPath } = scaffoldMonorepo(LIVE_TOKEN);
        try {
            const { code } = await runOnboard(root, npmrcPath);
            assert.equal(code, 0);
            assert.equal(loginHits, 0, 'a live token must NOT trigger the login flow');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('gates login on whoami — a DEAD token triggers the login flow, then proceeds', async () => {
        pkgState = {
            '@onb/published-trusted': { published: true, trusted: true },
            '@onb/published-untrusted': { published: true, trusted: true },
            '@onb/unpublished-a': { published: true, trusted: true },
            '@onb/unpublished-b': { published: true, trusted: true },
            '@onb/never-published-2xx': { published: true, trusted: true },
        };
        const { root, npmrcPath } = scaffoldMonorepo(DEAD_TOKEN);
        try {
            const { code, stdout } = await runOnboard(root, npmrcPath, [], {
                username: USERNAME,
                password: PASSWORD,
            });
            assert.equal(code, 0, `onboard should recover via login and exit 0; stdout:\n${stdout}`);
            assert.equal(loginHits, 1, 'a dead token must trigger exactly one login');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('sweeps a monorepo with NO root package.json via --packages', async () => {
        // The generalization gate. Without `--packages` there is no package set
        // here at all, and the failure is not "0 packages" — `discoverWorkspaces`
        // throws before it enumerates, so the sweep cannot even report its gap.
        pkgState = {};
        const { root, npmrcPath } = scaffoldFlatRepo(LIVE_TOKEN);
        try {
            const { code, stdout } = await runOnboard(root, npmrcPath, ['--packages', '*']);
            assert.equal(code, 0, `onboard should exit 0; stdout:\n${stdout}`);

            const publishedNames = publishPuts.map((p) => p.name).sort();
            assert.deepEqual(publishedNames, ['@onb/flat-adw', '@onb/flat-gio', '@onb/flat-gtk']);
            const trustedNames = trustPosts.map((p) => p.name).sort();
            assert.deepEqual(trustedNames, ['@onb/flat-adw', '@onb/flat-gio', '@onb/flat-gtk']);
            // `--no-private` still holds, and a non-package directory is skipped.
            assert.ok(!publishPuts.some((p) => p.name === '@onb/flat-private'));
            // The sweep says WHERE its package set came from — a total alone
            // cannot distinguish the right tree from a plausible wrong one.
            // Discovery reports what it FOUND (4, the private one included);
            // the selection line reports what survived `--no-private`. Both
            // numbers, because "3 packages" alone cannot tell a correct filter
            // from a glob that silently missed a directory.
            assert.match(stdout, /packages\(\*\)=4/);
            assert.match(stdout, /3 of 4 package\(s\) selected/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('--packages matching nothing is a HARD ERROR, not an empty sweep', async () => {
        // A filter that selects nothing is a typo or a shell-quoting bug. Silently
        // succeeding on it is the worst outcome available: a bootstrap command
        // reporting its own gap as closed.
        pkgState = {};
        const { root, npmrcPath } = scaffoldFlatRepo(LIVE_TOKEN);
        try {
            const { code, stdout, stderr } = await runOnboard(root, npmrcPath, ['--packages', 'packages/*']);
            assert.notEqual(code, 0, 'a --packages glob that matches nothing must fail');
            assert.equal(publishPuts.length, 0, 'nothing may be published on a failed discovery');
            assert.equal(trustPosts.length, 0, 'nothing may be trusted on a failed discovery');
            // Name the pattern: "0 packages" sends people hunting in the registry
            // instead of in their own quoting.
            assert.match(stderr + stdout, /"packages\/\*"/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('--exclude filters by package name (the @girs/* hardcode is now a flag)', async () => {
        pkgState = {};
        const { root, npmrcPath } = scaffoldFlatRepo(LIVE_TOKEN);
        try {
            const { code } = await runOnboard(root, npmrcPath, ['--packages', '*', '--exclude', '@onb/flat-gio']);
            assert.equal(code, 0);
            assert.deepEqual(publishPuts.map((p) => p.name).sort(), ['@onb/flat-adw', '@onb/flat-gtk']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('--dry-run that could not READ a state exits non-zero', async () => {
        // The plan is the entire product of a dry-run. Reporting `0 to publish,
        // 0 to trust` for packages whose state was never read, under exit 0, is
        // a plan that was never computed wearing the shape of one that found
        // nothing to do. Measured on `gjsify/types` before this: 703 packages,
        // 703 unreadable, exit 0.
        pkgState = {
            '@onb/published-trusted': { published: true, trusted: true },
            '@onb/published-untrusted': { published: true, trusted: true },
            '@onb/unpublished-a': { published: true, trusted: true },
            '@onb/unpublished-b': { published: true, trusted: true },
            // Published (so the packument oracle cannot reclassify it) but its
            // trust state is unreadable.
            '@onb/never-published-2xx': { published: true, trusted: true, unreadable: true },
        };
        const { root, npmrcPath } = scaffoldMonorepo(LIVE_TOKEN);
        try {
            const { code, stdout } = await runOnboard(root, npmrcPath, ['--dry-run']);
            assert.notEqual(code, 0, '--dry-run must not exit 0 when a state could not be read');
            assert.match(stdout, /INCOMPLETE/);
            assert.equal(publishPuts.length, 0, '--dry-run still changes nothing');
            assert.equal(trustPosts.length, 0, '--dry-run still changes nothing');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('--yes fails clearly when a dead token would need an interactive login', async () => {
        pkgState = freshState();
        const { root, npmrcPath } = scaffoldMonorepo(DEAD_TOKEN);
        try {
            const { code, stderr, stdout } = await runOnboard(root, npmrcPath, ['--yes']);
            assert.notEqual(code, 0, 'onboard --yes must fail when login is required');
            assert.match(stderr + stdout, /login/i, 'the failure should point at login');
            assert.equal(loginHits, 0, '--yes must not attempt an interactive login');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
