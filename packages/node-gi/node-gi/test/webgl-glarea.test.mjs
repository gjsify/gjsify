// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.GLArea gets a LIVE, CURRENT GL context on node-gi.
//
// The WebGL-on-node gate: `@gjsify/webgl`'s `WebGLBridge` is a `Gtk.GLArea`
// subclass whose whole contract is "the GLArea realizes and hands JS a current
// GL context to drive through the gwebgl Vala bridge". This e2e proves that
// contract holds UNCHANGED under the node-gi reverse bridge on a headless
// software-GL display:
//
//   gjsify build fixtures/webgl-glarea-app.ts --app gjs  → gjs -m …  (native gi://)
//   gjsify build fixtures/webgl-glarea-app.ts --app node → node  …   (@gjsify/node-gi)
//
// The ONE shared source ([../fixtures/webgl-glarea-app.ts](../fixtures/webgl-glarea-app.ts))
// presents a `Gtk.ApplicationWindow` holding a `Gtk.GLArea` configured exactly
// like `WebGLBridge` (ES 3.2 + depth + stencil), asserts on realize/render that
// `Gdk.GLContext.get_current()` is non-null (THE current-context proof), drives
// the gwebgl native class (`getString`, a `getParameterx` GVariant round-trip)
// and performs a real WebGL draw — `clearColor(1,0,0,1)` + `clear` +
// `readPixels` → the fixed pixel `255,0,0,255` in the committed GOLDEN. The GL
// stack is pure software (llvmpipe via LIBGL_ALWAYS_SOFTWARE=1) so the golden is
// display-independent; the host's GL version/renderer strings go to stderr as
// diagnostics only. A LOCAL/dev gate additionally re-proves the golden IS gjs's
// own byte-output by building + running `--app gjs` (skippable via
// NODE_GI_WEBGL_SKIP_GJS, mirroring canvas2d-bridge's NODE_GI_C2D_SKIP_GJS).
//
// SELF-SKIPS when there is no display (the fast headless `npm test` leg), when
// the `gjsify` CLI is absent, or when the committed Gwebgl prebuild
// (packages/framework/webgl-linux-<arch>/prebuilds/) is missing for this arch.
// The dedicated `webgl-glarea` CI job sets all three up (workspace-built CLI +
// xvfb + dbus + the GTK/mesa stack) and runs it for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// The fixtures live OUTSIDE test/ on purpose: node --test's default glob
// (**/test/**/*.{mjs,ts,…}) would otherwise pick them up and try to run the
// unbundled gi:// source directly, which fails to resolve.
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..', '..');
const fixture = join(pkgRoot, 'fixtures', 'webgl-glarea-app.ts');
const bridgeFixture = join(pkgRoot, 'fixtures', 'webgl-bridge-app.ts');

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// The committed gwebgl Vala prebuild (typelib + .so) @gjsify/webgl ships —
// puts Gwebgl-0.1 on GI_TYPELIB_PATH/LD_LIBRARY_PATH for BOTH runtimes.
// Since ADR 0017 it lives in the per-target package `@gjsify/webgl-<target>`, a
// SIBLING of the bridge, so a consumer downloads only their own architecture.
const gwebglDir = join(
    repoRoot,
    'packages',
    'framework',
    `webgl-linux-${process.arch}`,
    'prebuilds',
    `linux-${process.arch}`,
);
const haveGwebgl = existsSync(join(gwebglDir, 'Gwebgl-0.1.typelib'));

// Locate the workspace `gjsify` CLI: an explicit override, else the nearest
// node_modules/.bin/gjsify walking up from here, else `gjsify` on PATH.
function findGjsify() {
    if (process.env.GJSIFY_BIN && existsSync(process.env.GJSIFY_BIN)) return process.env.GJSIFY_BIN;
    let dir = here;
    for (let i = 0; i < 8; i++) {
        const cand = join(dir, 'node_modules', '.bin', 'gjsify');
        if (existsSync(cand)) return cand;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    try {
        execFileSync('gjsify', ['--version'], { stdio: 'ignore' });
        return 'gjsify';
    } catch {
        return null;
    }
}

const gjsify = haveDisplay ? findGjsify() : null;

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : !haveGwebgl
      ? `Gwebgl prebuild missing (${gwebglDir})`
      : !gjsify
        ? 'gjsify CLI not found (workspace not installed)'
        : false;

// The gjs gold-standard leg re-proves the committed GOLDEN below IS exactly
// gjs's own byte-output. Skippable via NODE_GI_WEBGL_SKIP_GJS=1 (the
// canvas2d-bridge NODE_GI_C2D_SKIP_GJS pattern) for hosts where building
// `--app gjs` or running gjs is not set up; the node-gi assertion vs the
// committed golden stays the authoritative check either way. It ALSO needs the
// workspace register libs BUILT: `--app gjs` force-INLINES `<pkg>/register`
// subpaths (the AGENTS.md invariant — GJS's loader cannot resolve them bare),
// so an unbuilt workspace (fresh clone/worktree, no lib/esm) cannot produce a
// loadable gjs bundle — probe one register lib the entry wrapper always pulls.
// NB the NODE leg has no such requirement: the fixture imports only gi://.
const workspaceBuilt = existsSync(join(repoRoot, 'packages', 'node', 'buffer', 'lib', 'esm', 'register.js'));
const haveGjs =
    !process.env.NODE_GI_WEBGL_SKIP_GJS &&
    workspaceBuilt &&
    spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// The fixed sequence of lines both runtimes must print, in order — the committed
// golden. It IS gjs's own output (asserted by the local gjs leg below). The
// pixel line is the WebGL draw proof: clear-color red read back off the GL
// framebuffer via glReadPixels — software GL, so byte-stable across hosts.
const GOLDEN = [
    'webgl-glarea: start',
    'activated',
    'realize: error none',
    'realize: context non-null es=true version>=3.2 true',
    'realize: current yes', // THE headline: Gdk.GLContext.get_current() non-null
    'render: current yes',
    'gl-strings: ok',
    'gl-param: max-texture-size positive',
    'pixel(0,0): 255,0,0,255', // clearColor(1,0,0,1) + clear + readPixels
    'render: fired',
    'quit',
    'done',
].join('\n');

// Only the apps' own deterministic lines are asserted — a headless GTK/dbus
// session prints assorted portal / a11y / gvfs warnings that vary by host.
// Covers BOTH fixtures (glarea + bridge).
const GOLDEN_PREFIXES = [
    'webgl-glarea:',
    'webgl-bridge:',
    'activated',
    'realize:',
    'render:',
    'ready:',
    'gl-strings:',
    'gl-param:',
    'pixel(',
    'bridge-pixel(',
    'quit',
    'done',
    'activate-error:',
];

// Software-only GL/GTK env for the run children. DISPLAY comes from the
// surrounding xvfb-run / real session; LIBGL_ALWAYS_SOFTWARE forces mesa
// llvmpipe so the GL stack needs no GPU, GSK_RENDERER=cairo keeps GTK's own
// compositor off GL (the GLArea still creates its OWN GL context — the exact
// headless recipe the golden is pinned to), GDK_BACKEND=x11 matches Xvfb.
// The gwebgl prebuild dir is APPENDED to any inherited typelib/library path.
// Merged over the inherited env so DISPLAY / NODE_GI_NATIVE are preserved.
const RUN_ENV = {
    GSK_RENDERER: 'cairo',
    GDK_BACKEND: 'x11',
    LIBGL_ALWAYS_SOFTWARE: '1',
    GTK_A11Y: 'none',
    NODE_GI_NATIVE: 'build', // run the just-built addon, not a stale staged prebuild
    ...process.env,
    GI_TYPELIB_PATH: [gwebglDir, process.env.GI_TYPELIB_PATH].filter(Boolean).join(delimiter),
    LD_LIBRARY_PATH: [gwebglDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter),
};

function exec(cmd, args, timeoutMs, env) {
    try {
        return execFileSync(cmd, args, {
            cwd: here,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: timeoutMs,
            encoding: 'utf-8',
            env: env ?? process.env,
        });
    } catch (err) {
        const out = (err.stdout || '').toString();
        const e = (err.stderr || '').toString();
        throw new Error(
            `${cmd} ${args.join(' ')} failed (code ${err.status ?? err.code})\n--- stdout ---\n${out}\n--- stderr ---\n${e}`,
        );
    }
}

// Invoke the resolved gjsify CLI. A workspace CLI entry (…/infra/cli/lib/index.js)
// is a plain .js — run it via `node` so it works regardless of the +x bit; a shell
// shim (the workspace `.bin/gjsify`) is exec'd directly. CI points GJSIFY_BIN at
// the WORKSPACE-built CLI (current source), not the published @gjsify/cli.
function gjsifyExec(args, timeoutMs) {
    return /\.[mc]?js$/.test(gjsify)
        ? exec(process.execPath, [gjsify, ...args], timeoutMs)
        : exec(gjsify, args, timeoutMs);
}

function build(entry, app, outfile) {
    gjsifyExec(['build', entry, '--app', app, '--outfile', outfile], 180 * 1000);
    assert.ok(existsSync(outfile), `${outfile} was not produced`);
    return outfile;
}

// Keep ONLY the golden lifecycle lines (each carries a known prefix).
function run(cmd, args) {
    const raw = exec(cmd, args, 90 * 1000, RUN_ENV);
    return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => GOLDEN_PREFIXES.some((p) => l === p || l.startsWith(p)))
        .join('\n');
}

// Shared per-fixture flow: build --app node, assert the gi://→requireGi rewrite
// happened, run on node vs the committed golden; then (haveGjs) build --app gjs,
// run under gjs, and assert golden + byte-identity. Build INSIDE the monorepo
// (not os tmpdir): the --app node bundle keeps `@gjsify/node-gi` external, so it
// must run from a tree where that package resolves (the root
// node_modules/@gjsify/node-gi symlink). /tmp has no such node_modules →
// ERR_MODULE_NOT_FOUND at run time. Kept at the package root (not under test/)
// so a stray dir never trips node --test's glob.
function assertDualRuntimeGolden(entry, golden) {
    const dir = mkdtempSync(join(pkgRoot, '.tmp-webgl-'));
    try {
        // --- node-gi: the real `--app node` bundle (the authoritative check) ---
        const nodeBundle = build(entry, 'node', join(dir, 'app.node.mjs'));
        // The build MUST have rewritten gi:// → requireGi (incl. gi://Gwebgl);
        // a CLI predating that rewrite is a hard failure here, not a skip.
        assert.ok(
            readFileSync(nodeBundle, 'utf-8').includes('requireGi'),
            'the --app node bundle did not rewrite gi:// → requireGi (gjsify CLI too old)',
        );
        const nodeOut = run('node', [nodeBundle]);
        assert.equal(nodeOut, golden, 'node-gi output diverged from the committed golden');

        // --- gjs gold-standard: re-prove the golden IS gjs's own output ---
        // Skippable via NODE_GI_WEBGL_SKIP_GJS=1 — see the haveGjs note above.
        if (haveGjs) {
            const gjsBundle = build(entry, 'gjs', join(dir, 'app.gjs.mjs'));
            const gjsOut = run('gjs', ['-m', gjsBundle]);
            assert.equal(gjsOut, golden, 'gjs gold-standard diverged from the committed golden');
            assert.equal(gjsOut, nodeOut, 'gjs and node-gi outputs are not byte-identical');
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('Gtk.GLArea realizes with a CURRENT GL context + WebGL draw on node-gi', { skip }, () => {
    assertDualRuntimeGolden(fixture, GOLDEN);
});

// ---- the FULL @gjsify/webgl WebGLBridge (TS WebGL stack) on node-gi ---------

// Additionally needs `@gjsify/webgl` BUILT (its lib + workspace deps) — the
// fixture bundles the whole TS WebGL stack. A bare node-gi tree (no workspace
// build) skips cleanly; the raw-seam test above stays independent of it.
function webglResolvable() {
    try {
        createRequire(bridgeFixture).resolve('@gjsify/webgl');
        return true;
    } catch {
        return false;
    }
}

const bridgeSkip = skip || (!webglResolvable() ? '@gjsify/webgl not resolvable (workspace not built)' : false);

// The committed golden for the bridge fixture: the standard browser calls
// clearColor(0,0,1,1)+clear+readPixels through the FULL TS WebGLRenderingContext
// (constants hash, GVariant getParameterx init, WebGL1+2 context construction)
// read the blue clear back off the GL framebuffer.
const BRIDGE_GOLDEN = [
    'webgl-bridge: start',
    'activated',
    'ready: canvas sized',
    'bridge-pixel(0,0): 0,0,255,255',
    'ready: fired',
    'quit',
    'done',
].join('\n');

test('the full @gjsify/webgl WebGLBridge draws + reads back on node-gi', { skip: bridgeSkip }, () => {
    assertDualRuntimeGolden(bridgeFixture, BRIDGE_GOLDEN);
});
