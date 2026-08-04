// E2E for `scripts/verify-published-closure.mjs` — the post-release assertion
// that what npm now serves is internally consistent.
//
// The guard's whole reason for existing is that a partial publish sweep can be
// WORSE than no publish: pack time rewrites `workspace:*` to the exact released
// version, and npm skips an unresolvable `optionalDependency` in silence, so a
// bridge published before its platform children installs cleanly with no binary
// behind it. This suite drives the script against a LOCAL fake registry so both
// halves are exercised for real: the finding, and — the part that matters more —
// the refusal to report success when the check examined nothing.
//
// The fake registry is a plain http server serving abbreviated packuments
// (`{name, versions}`), which is exactly what the script asks npm for. Its
// contents are a mutable per-case map, so "published" and "never published" are
// the same code path with different data.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../scripts/verify-published-closure.mjs', import.meta.url));
const VERSION = '1.2.3';

function runScript(args, { timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => {
            stdout += c;
        });
        child.stderr.on('data', (c) => {
            stderr += c;
        });
        const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr, out: stdout + stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

/**
 * Write a fixture monorepo.
 *
 * @param root Directory to write into.
 * @param pkgs `{ name, version?, private?, deps?, optionalDeps? }[]`
 */
function writeTree(root, pkgs) {
    writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'closure-fixture', version: VERSION, private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
    );
    for (const p of pkgs) {
        const dir = join(root, 'packages', p.name.replace(/^@[^/]+\//, ''));
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            `${JSON.stringify(
                {
                    name: p.name,
                    version: p.version ?? VERSION,
                    ...(p.private ? { private: true } : {}),
                    ...(p.deps ? { dependencies: p.deps } : {}),
                    ...(p.optionalDeps ? { optionalDependencies: p.optionalDeps } : {}),
                },
                null,
                2,
            )}\n`,
        );
    }
}

describe('verify-published-closure (post-release registry assertion)', { timeout: 120_000 }, () => {
    let server, registryUrl, tmp;
    /** name → string[] of published versions. Missing name = 404. */
    let published = new Map();
    /** name → number of packument requests served (for the retry case). */
    let hits = new Map();
    /** Names the registry answers 5xx for — "we do not know", not "absent". */
    let broken = new Set();
    /**
     * name → the request number from which the version becomes visible. Models
     * CDN propagation by REQUEST COUNT rather than by a timer: a wall-clock
     * fixture would race child-process startup on a loaded runner and flake in
     * both directions (revealing too early → no retry to assert; too late →
     * attempts exhausted).
     */
    let revealAfter = new Map();

    before(async () => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-e2e-closure-'));
        server = createServer((req, res) => {
            const name = decodeURIComponent((req.url ?? '/').replace(/^\//, '').split('?')[0]);
            hits.set(name, (hits.get(name) ?? 0) + 1);
            if (broken.has(name)) {
                res.writeHead(503, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Service Unavailable' }));
                return;
            }
            const hidden = revealAfter.has(name) && hits.get(name) < revealAfter.get(name);
            const versions = hidden ? undefined : published.get(name);
            if (!versions) {
                res.writeHead(404, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({ name, versions: Object.fromEntries(versions.map((v) => [v, { name, version: v }])) }),
            );
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) await new Promise((r) => server.close(r));
        if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    const fixture = (label, pkgs) => {
        const root = join(tmp, label);
        mkdirSync(root, { recursive: true });
        writeTree(root, pkgs);
        return root;
    };

    // A bridge + two platform children (`workspace:*`, i.e. exact-pinned at pack
    // time) + an ordinary library dep — the shape of every split native bridge.
    const splitBridge = [
        { name: '@fix/util' },
        {
            name: '@fix/bridge',
            deps: { '@fix/util': 'workspace:^' },
            optionalDeps: { '@fix/bridge-linux-x64': 'workspace:*', '@fix/bridge-darwin-arm64': 'workspace:*' },
        },
        { name: '@fix/bridge-linux-x64' },
        { name: '@fix/bridge-darwin-arm64' },
    ];

    it('a COMPLETE release passes and reports positive counts', async () => {
        const root = fixture('complete', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.equal(r.status, 0, `expected a clean pass:\n${r.out}`);
        assert.match(r.stdout, /live on the registry at 1\.2\.3:\s+4/);
        // 2 optionalDependencies + 1 dependencies = 3 pinned edges examined.
        assert.match(
            r.stdout,
            /release-pinned intra-repo edges examined:\s+3 \(2 optionalDependencies, 1 dependencies\)/,
        );
        assert.match(r.stdout, /Every one of 3 release-pinned dependency edge\(s\)/);
    });

    it('a bridge published WITHOUT one platform child FAILS and names it', async () => {
        // The measured hazard: parent live, exact-pinned optional child absent.
        // npm would install this in silence.
        const root = fixture('missing-child', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `a dangling optionalDependency must fail:\n${r.out}`);
        assert.match(
            r.out,
            /UNRESOLVABLE: @fix\/bridge@1\.2\.3 → optionalDependencies\.@fix\/bridge-darwin-arm64@1\.2\.3/,
        );
        assert.match(r.out, /skips an unresolvable optionalDependency in SILENCE/);
        assert.match(r.out, /--tolerate-republish/);
        // The intact sibling must NOT be reported — a guard that names everything
        // names nothing.
        assert.doesNotMatch(r.out, /UNRESOLVABLE: .*bridge-linux-x64/);
    });

    it('a missing package with NO published dependent is not a violation', async () => {
        // Prevention's promise: any PREFIX of a dependency-ordered sweep is
        // resolvable. Children landed, the bridge did not — nothing on npm points
        // at anything absent, so this must stay green or the guard would red-line
        // every legitimately aborted sweep.
        const root = fixture('prefix', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.equal(r.status, 0, `an aborted-but-ordered sweep must stay green:\n${r.out}`);
        assert.match(r.stdout, /absent at 1\.2\.3 \(1\): @fix\/bridge/);
        // …and it must not READ as a verified closure: nothing was examined.
        assert.match(r.stdout, /NO edge was examined/);
        assert.doesNotMatch(r.stdout, /Every one of/);
    });

    it('a release that published NOTHING fails instead of passing empty', async () => {
        // The whole lesson: zero verified packages is zero evidence. An exit 0
        // here would read as "the closure is fine".
        const root = fixture('nothing', splitBridge);
        published = new Map([['@fix/util', ['0.0.1']]]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `an empty result must not exit 0:\n${r.out}`);
        assert.match(r.out, /this release published\s+NOTHING/);
        assert.match(r.out, /must not report success/);
    });

    it('a tree that declares NO pinned edge fails, however green the registry', async () => {
        // The edge enumeration is the load-bearing half, and its emptiness is a
        // property of the MANIFESTS — so it stays a failure even when every
        // package published perfectly. If a refactor ever stops the enumeration
        // seeing the platform-sibling edges, every future release would otherwise
        // pass on an empty set and look checked.
        const root = fixture('no-edges', [{ name: '@fix/alone' }, { name: '@fix/lonely' }]);
        published = new Map([
            ['@fix/alone', [VERSION]],
            ['@fix/lonely', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `no subject matter must not exit 0:\n${r.out}`);
        assert.match(r.out, /declares NO release-pinned intra-repo dependency at all/);
    });

    it('an UNANSWERED probe is "unknown", never reported as missing', async () => {
        // A 5xx/timeout on one platform package must not be laundered into a
        // fabricated "never published" verdict on a release that is intact. The
        // three probe states are distinct: live, confirmed-absent (404), unknown.
        // The job still fails — no evidence is not a pass — but for the right
        // reason, and without naming a package that may be perfectly fine.
        const root = fixture('probe-error', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        broken = new Set(['@fix/bridge-darwin-arm64']);
        try {
            const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
            assert.notEqual(r.status, 0, `an unanswered probe is not evidence of a pass:\n${r.out}`);
            assert.match(r.out, /probe failed: @fix\/bridge-darwin-arm64 — Error: 503/);
            assert.match(r.out, /never produced an answer/);
            // The bug this case pins: `!isLive(target)` would have called it a
            // dangling optionalDependency.
            assert.doesNotMatch(r.out, /UNRESOLVABLE/);
            assert.doesNotMatch(r.out, /absent at 1\.2\.3/);
        } finally {
            broken = new Set();
        }
    });

    it('a spec shape it cannot classify FAILS rather than skipping quietly', async () => {
        const root = fixture('unclassified', [
            { name: '@fix/util' },
            { name: '@fix/app', deps: { '@fix/util': '>=0.0.1 <9' } },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/app', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.notEqual(r.status, 0, `an unclassified spec must not be a silent skip:\n${r.out}`);
        assert.match(r.out, /unclassified spec: @fix\/app → dependencies\.@fix\/util = ">=0\.0\.1 <9"/);
    });

    it('a registry that has not propagated yet is retried, not failed', async () => {
        // npm's CDN can answer with a packument minted before the publish. A false
        // red at release time costs a manual re-run of a workflow that did its job,
        // so absence is re-queried before it becomes a verdict.
        const root = fixture('propagation', splitBridge);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/bridge', [VERSION]],
            ['@fix/bridge-linux-x64', [VERSION]],
            ['@fix/bridge-darwin-arm64', [VERSION]],
        ]);
        hits = new Map();
        // Published, but the registry hides it until the SECOND request for that
        // name — so round 1 must 404 and round 2 must find it, deterministically.
        revealAfter = new Map([['@fix/bridge-darwin-arm64', 2]]);
        try {
            const r = await runScript([
                '--root',
                root,
                '--registry',
                registryUrl,
                '--attempts',
                '4',
                '--retry-delay-ms',
                '50',
            ]);
            assert.equal(r.status, 0, `a late-propagating version must pass on a later round:\n${r.out}`);
            assert.match(r.stdout, /round 2\/4 — re-querying 1 unresolved name\(s\)/);
            // Only the ABSENT name is re-queried; a present version never becomes
            // absent, so re-asking for it would be wasted round trips.
            assert.equal(hits.get('@fix/bridge'), 1, 'a package already found live must not be re-queried');
            assert.equal(hits.get('@fix/bridge-darwin-arm64'), 2, 'the absent name must be re-queried exactly once');
        } finally {
            revealAfter = new Map();
        }
    });

    it('private packages are out of scope entirely', async () => {
        const root = fixture('private', [
            { name: '@fix/util' },
            { name: '@fix/secret', private: true, optionalDeps: { '@fix/util': 'workspace:*' } },
            { name: '@fix/app', deps: { '@fix/util': 'workspace:^' } },
        ]);
        published = new Map([
            ['@fix/util', [VERSION]],
            ['@fix/app', [VERSION]],
        ]);
        const r = await runScript(['--root', root, '--registry', registryUrl, '--attempts', '1']);
        assert.equal(r.status, 0, `a private package is never published, so it has no closure:\n${r.out}`);
        assert.match(r.stdout, /candidate packages \(non-private, on the train\): 2/);
    });

    // ── the PREVENTION half, asserted where it can regress ──────────────────
    // Detection is post-hoc: it can only report a window that already opened.
    // The sweep's dependency-ordered publish is what keeps the window shut, and
    // it is one flag in one script — so assert the flag is still there. Without
    // this, dropping it would be invisible until a release aborted in exactly
    // the wrong place.
    it('the npm:publish sweep publishes in dependency order', () => {
        const rootManifest = JSON.parse(
            readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
        );
        const script = rootManifest.scripts['npm:publish'];
        assert.ok(script, 'root package.json must declare npm:publish');
        assert.match(
            script,
            /gjsify foreach[^&]*\s(--topological|-t\b|-[a-zA-Z]*t[a-zA-Z]*\s)/,
            'npm:publish must run its `gjsify foreach` sweep --topological: the graph counts optionalDependencies, ' +
                'so every platform child precedes its bridge and any prefix of an aborted sweep is still a ' +
                'resolvable tree. Unordered, a fail-fast abort can publish a bridge pinning siblings that do not ' +
                `exist. Got: ${script}`,
        );
    });
});
