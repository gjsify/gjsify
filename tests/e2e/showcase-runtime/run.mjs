// E2E for the runtime selector `gjsify run --runtime <gjs|node|bun|deno>`
// (the generalization of `gjsify storybook --runtime`).
//
// Exercises the CLI wiring end-to-end WITHOUT a display or the node-gi addon:
// the fixtures are trivial `--app node`-shaped bundles (plain `console.log`, no
// `gi://`), so node/bun/deno run them directly. Covers:
//   - a runtime NOT in the example's `gjsify.example.runtimes` → clean error
//   - a supported runtime → the bundle runs on it (and reports which runtime)
//   - `--runtime` on a non-file target → clean "needs a bundle FILE" error
//   - bun/deno self-skip when not on PATH
//
// Invokes the CLI Node entry (`packages/infra/cli/lib/index.js`) via node, the
// same pattern as `tests/e2e/run-command`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../mock-registry.mjs';

const cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

function onPath(cmd) {
    try {
        return spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 15_000 }).status === 0;
    } catch {
        return false;
    }
}

describe('gjsify run --runtime', { timeout: 120_000 }, () => {
    let dir;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-showcase-runtime-'));
        mkdirSync(join(dir, 'dist'), { recursive: true });
        // A trivial `--app node`-shaped bundle: prints which runtime it ran on.
        writeFileSync(
            join(dir, 'dist', 'app.node.mjs'),
            "const rt = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node';\n" +
                "console.log('ran-on:' + rt);\n",
        );
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function writePkg(runtimes) {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: '@gjsify/example-e2e-runtime', private: true, gjsify: { example: { runtimes } } },
                null,
                2,
            ) + '\n',
        );
    }

    it('rejects a runtime the example does not declare with a clean error', async () => {
        writePkg(['gjs']);
        const r = await runCli(cliEntry, ['run', '--runtime', 'node', './dist/app.node.mjs'], { cwd: dir });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not support --runtime node/);
        assert.match(r.stderr, /Declared runtimes: gjs/);
    });

    it('runs the bundle on node when declared', async () => {
        writePkg(['gjs', 'node', 'bun', 'deno']);
        const r = await runCli(cliEntry, ['run', '--runtime', 'node', './dist/app.node.mjs'], { cwd: dir });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ran-on:node/);
    });

    for (const rt of ['bun', 'deno']) {
        it(`runs the SAME node bundle on ${rt} (or self-skips)`, async (t) => {
            if (!onPath(rt)) {
                t.diagnostic(`${rt} not on PATH — skipped`);
                return;
            }
            writePkg(['gjs', 'node', 'bun', 'deno']);
            const r = await runCli(cliEntry, ['run', '--runtime', rt, './dist/app.node.mjs'], { cwd: dir });
            assert.equal(r.status, 0, r.stderr);
            assert.match(r.stdout, new RegExp(`ran-on:${rt}`));
        });
    }

    it('errors when --runtime is given a non-file target', async () => {
        writePkg(['gjs', 'node']);
        const r = await runCli(cliEntry, ['run', '--runtime', 'node', 'somescriptname'], { cwd: dir });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /needs a bundle FILE/);
    });

    it('permits any runtime when the example declares none', async () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'no-decl', private: true }, null, 2) + '\n');
        const r = await runCli(cliEntry, ['run', '--runtime', 'node', './dist/app.node.mjs'], { cwd: dir });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ran-on:node/);
    });
});

// The `gjsify showcase --runtime` half. Offline + display-free: the workspace
// showcases resolve locally (`resolveShowcaseDir` is local-first, so no `dlx`
// download), and a GJS-only showcase is rejected by its declaration BEFORE any
// bundle is touched — so nothing launches a GUI.
describe('gjsify showcase --runtime', { timeout: 120_000 }, () => {
    // The CLI pre-flights system deps (gjs, gtk4) before the runtime check; a
    // host without them can't reach the assertion, so self-skip there rather
    // than reporting an unrelated failure.
    function skipIfMissingSystemDeps(t, r) {
        if (/Missing system dependencies/.test(r.stderr)) {
            t.diagnostic('system deps (gjs/gtk4) missing — skipped');
            return true;
        }
        return false;
    }

    it('rejects --runtime node for a showcase declaring only gjs', async (t) => {
        const r = await runCli(cliEntry, ['showcase', 'webrtc-loopback', '--runtime', 'node']);
        if (skipIfMissingSystemDeps(t, r)) return;
        assert.equal(r.status, 1, r.stderr);
        // The ACTIONABLE message ("this showcase is GJS-only"), not the
        // file-missing one ("declared node entry not found"), which reads like
        // a broken package.
        assert.match(r.stderr, /does not support --runtime node/);
        assert.match(r.stderr, /Declared runtimes: gjs/);
        assert.doesNotMatch(r.stderr, /node entry not found/);
        assert.doesNotMatch(r.stderr, /has no `--app node` bundle/);
    });

    it('rejects --runtime bun for a showcase declaring only gjs', async (t) => {
        const r = await runCli(cliEntry, ['showcase', 'minimalist-browser', '--runtime', 'bun']);
        if (skipIfMissingSystemDeps(t, r)) return;
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /does not support --runtime bun/);
        assert.match(r.stderr, /--runtime gjs/);
    });

    // A dlx tree is the package plus its own `dependencies`. `@gjsify/node-gi`
    // — what the `--app node` bundle's `gi://` imports resolve through — is a
    // devDependency of every showcase, so it was never in that tree and the
    // launch died with "add @gjsify/node-gi as a dependency": advice pointing
    // at a directory the user does not own. The launcher knows the runtime, so
    // it adds the bridge to the install (`extraSpecs`).
    //
    // The property that has to hold for that to be safe is the CACHE KEY: the
    // gjs tree (no bridge) and the node tree (bridge) must never share a cache
    // entry, or whichever ran first decides what the other one gets.
    it('keys the dlx cache on the extra specs, so gjs and node trees never collide', async () => {
        const { createCacheKey } = await import(
            new URL('../../../packages/infra/cli/lib/utils/dlx-cache.js', import.meta.url).href
        );
        const showcase = '@gjsify/example-dom-canvas2d-fireworks@9.9.9';
        const gjsKey = createCacheKey({ packages: [showcase] });
        const nodeKey = createCacheKey({ packages: [showcase, '@gjsify/node-gi@9.9.9'] });
        assert.notEqual(gjsKey, nodeKey);
        // …and stays stable for the same input, or every launch re-installs.
        assert.equal(nodeKey, createCacheKey({ packages: [showcase, '@gjsify/node-gi@9.9.9'] }));

        // The batteries-included GTK runtime is a THIRD spec the launcher adds,
        // on the platforms where a system GTK is not a given (win32/darwin). It
        // has to key separately for the same reason the bridge does: a tree that
        // carries the bundle and one that does not are different trees, and a
        // later "the bundle is implied by the platform, leave it out of the key"
        // would quietly hand one of them to the other.
        const bundleKey = createCacheKey({
            packages: [showcase, '@gjsify/node-gi@9.9.9', '@gjsify/gtk-runtime-win32-x64@9.9.9'],
        });
        assert.notEqual(bundleKey, nodeKey);
        assert.notEqual(bundleKey, gjsKey);
    });

    // The system-dependency gate is a question ABOUT the runtime, so it must be
    // asked AFTER the runtime is resolved. It used to run three statements
    // BEFORE, and `runMinimalChecks()` marks `gjs` `required` — so `showcase
    // <name> --runtime node` aborted with "Missing system dependencies: ✗ GJS"
    // on every host without a gjs binary (Windows, plain Node/bun/deno),
    // without ever reaching the `runtime !== 'gjs'` branch that never touches
    // gjs. The default path was hit too: `defaultExampleRuntime()` falls back
    // to the host runtime on exactly those hosts.
    //
    // The probe is a gjs-ONLY showcase asked for under `--runtime node`, with
    // PATH emptied so the host's own gjs cannot mask the regression. WHICH
    // error comes back names which check ran first, and that ordering IS the
    // property under test:
    //   ordered right → "does not support --runtime node" (declaration check)
    //   ordered wrong → "Missing system dependencies: ✗ GJS"
    // It stays hermetic — the showcase dir resolves through the workspace
    // symlink (local-first, no dlx, no network) and nothing is ever launched.
    // An INVALID `--runtime` would be the more direct probe but never reaches
    // the handler: yargs rejects it against the option's `choices` first.
    it('resolves --runtime before gating on the gjs system deps', async () => {
        const emptyBin = mkdtempSync(join(tmpdir(), 'gjsify-e2e-nogjs-'));
        try {
            // No `cwd`: the showcase dir resolves through `createRequire`
            // relative to the CLI's own lib, never through the caller's cwd.
            const r = await runCli(cliEntry, ['showcase', 'webrtc-loopback', '--runtime', 'node'], {
                env: { ...process.env, PATH: emptyBin },
            });
            assert.doesNotMatch(r.stderr, /Missing system dependencies/);
            assert.match(r.stderr, /does not support --runtime node/);
        } finally {
            rmSync(emptyBin, { recursive: true, force: true });
        }
    });
});
