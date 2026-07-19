// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the LIVE Canvas2DBridge realizes + draws + blits on node-gi.
//
// The next bridge step after the cairo foreign-struct seam (cairo-drawfunc /
// cairo-canvas2d): `@gjsify/canvas2d`'s `Canvas2DBridge` wraps a real
// `Gtk.DrawingArea` and translates the GTK draw/lifecycle ↔ an `HTMLCanvasElement`
// 2D context backed by Cairo. This e2e proves it runs UNCHANGED on node-gi:
//
//   gjsify build fixtures/canvas2d-bridge-app.ts --app gjs  → gjs  -m …  (native gi://)
//   gjsify build fixtures/canvas2d-bridge-app.ts --app node → node   …   (@gjsify/node-gi)
//
// The ONE shared source ([../fixtures/canvas2d-bridge-app.ts](../fixtures/canvas2d-bridge-app.ts))
// puts the bridge in an `ApplicationWindow`, `present()`s it, draws through the
// standard 2D API in `bridge.onReady`, drives realize → draw_func → blit, ticks
// the rAF (`add_tick_callback`) path, reads pixels BACK off the canvas, and quits
// from a `GLib.timeout`. The AUTHORITATIVE assertion (always on): the node-gi
// `--app node` bundle runs + exits 0 and prints the fixed committed GOLDEN — the
// pixels are read off the canvas via Cairo (display-independent), so the golden is
// stable, the same committed-golden conformance pattern node-gi uses elsewhere. A
// LOCAL/dev gate additionally re-proves the golden IS gjs's own byte-output by
// building + running `--app gjs` (skipped in CI via NODE_GI_C2D_SKIP_GJS — see the
// haveGjs note); this is the `cairo-canvas2d.test.mjs` / `example-gtk` gold-standard
// parity, kept local because building --app gjs needs the register-inline bundler.
//
// SELF-SKIPS when there is no display (the fast headless `npm test` leg), when the
// `gjsify` CLI is absent, or when `@gjsify/canvas2d` is not resolvable (a bare
// node-gi tree with no built workspace). The dedicated `canvas2d-bridge` CI job
// sets all three up (workspace built under Node + xvfb + dbus + the GTK/Cairo
// stack) and runs it for real. GTK needs the software-render env under Xvfb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// The fixture lives OUTSIDE test/ on purpose: node --test's default glob
// (**/test/**/*.{mjs,ts,…}) would otherwise pick it up and try to run the
// unbundled gi:// source directly, which fails to resolve.
const pkgRoot = join(here, '..');
const fixture = join(pkgRoot, 'fixtures', 'canvas2d-bridge-app.ts');

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

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

// Is `@gjsify/canvas2d` (with a built lib/) resolvable from the fixture? On a bare
// node-gi tree (no workspace install/build) it is not — skip cleanly there.
function canvas2dResolvable() {
    try {
        createRequire(fixture).resolve('@gjsify/canvas2d');
        return true;
    } catch {
        return false;
    }
}

const gjsify = haveDisplay ? findGjsify() : null;

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : !gjsify
        ? 'gjsify CLI not found (workspace not installed)'
        : !canvas2dResolvable()
            ? '@gjsify/canvas2d not resolvable (workspace not built)'
            : false;

// The gjs gold-standard leg re-proves the committed GOLDEN below IS exactly gjs's
// own byte-output — but it is a LOCAL/dev gate. In CI (the `canvas2d-bridge` job)
// it is switched OFF via NODE_GI_C2D_SKIP_GJS=1: the node-gi assertion vs the
// committed golden is the authoritative check (the pixels are read off the canvas
// via Cairo → display-independent, so the golden is stable and needs no in-CI
// `gjs -m` rebuild). Building --app gjs correctly requires the register-subpath-
// inline bundler (AGENTS.md: `@gjsify/<pkg>/register` MUST NOT be externalized for
// --app gjs — GJS's ESM loader can't resolve it); the published @gjsify/cli the CI
// workspace setup repoints to predates that carve-out, so keeping the gjs leg local
// sidesteps a CLI-config seam that has nothing to do with node-gi behaviour.
const haveGjs = !process.env.NODE_GI_C2D_SKIP_GJS
    && spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// The fixed sequence of lines both runtimes must print, in order — the committed
// golden. It IS gjs's own output (asserted by the local gjs leg below).
const GOLDEN = [
    'canvas2d-bridge: start',
    'activated',
    'ready: sized',
    'pixel(10,10): 255,0,0,255', // inside the red fillRect — canvas render read back
    'pixel(2,2): 0,0,0,255', // opaque-black background
    'draw: fired', // the Gtk.DrawingArea draw_func fired → realize + blit path ran
    'raf: ticked', // bridge.requestAnimationFrame → add_tick_callback ticked
    'quit',
    'done',
].join('\n');

// Only the app's own deterministic lines are asserted — a headless GTK/dbus session
// prints assorted portal / a11y / gvfs warnings that vary by host.
const GOLDEN_PREFIXES = [
    'canvas2d-bridge:',
    'activated',
    'ready:',
    'pixel(',
    'draw:',
    'raf:',
    'quit',
    'done',
    'activate-error:',
];

// Software-only GTK render env for the run children. DISPLAY comes from the
// surrounding xvfb-run / real session; these keep GTK off any GPU/Vulkan path a
// headless Xvfb cannot provide and off the a11y bus. Merged over the inherited env
// so a value already present (DISPLAY, NODE_GI_NATIVE) is preserved.
const RUN_ENV = {
    GSK_RENDERER: 'cairo',
    GDK_BACKEND: 'x11',
    LIBGL_ALWAYS_SOFTWARE: '1',
    GTK_A11Y: 'none',
    NODE_GI_NATIVE: 'build', // run the just-built addon, not a stale staged prebuild
    ...process.env,
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

function build(app, outfile) {
    exec(gjsify, ['build', fixture, '--app', app, '--outfile', outfile], 180 * 1000);
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

test(
    'Canvas2DBridge realizes + draws + blits on node-gi (byte-identical to the golden)',
    { skip },
    () => {
        // Build INSIDE the monorepo (not os tmpdir): the --app node bundle keeps
        // `@gjsify/node-gi` external, so it must run from a tree where that package
        // resolves (the root node_modules/@gjsify/node-gi symlink). /tmp has no such
        // node_modules → ERR_MODULE_NOT_FOUND at run time. Kept at the package root
        // (not under test/) so a stray dir never trips node --test's glob.
        const dir = mkdtempSync(join(pkgRoot, '.tmp-c2d-'));
        try {
            // --- node-gi: the real `--app node` bundle (the authoritative check) ---
            const nodeBundle = build('node', join(dir, 'app.node.mjs'));
            // The bridge pulls @gjsify/canvas2d + its whole gi:// graph, so there is
            // NO single-file runtime-twin fallback (unlike example-gtk): the build
            // MUST have rewritten gi:// → requireGi. A CLI predating that rewrite is
            // a hard failure here, not a skip.
            assert.ok(
                readFileSync(nodeBundle, 'utf-8').includes('requireGi'),
                'the --app node bundle did not rewrite gi:// → requireGi (gjsify CLI too old)',
            );
            const nodeOut = run('node', [nodeBundle]);
            assert.equal(nodeOut, GOLDEN, 'node-gi output diverged from the committed golden');

            // --- gjs gold-standard (LOCAL/dev gate): re-prove the golden IS gjs's ---
            // Off in CI (NODE_GI_C2D_SKIP_GJS=1) — see the haveGjs note above.
            if (haveGjs) {
                const gjsBundle = build('gjs', join(dir, 'app.gjs.mjs'));
                const gjsOut = run('gjs', ['-m', gjsBundle]);
                assert.equal(gjsOut, GOLDEN, 'gjs gold-standard diverged from the committed golden');
                assert.equal(gjsOut, nodeOut, 'gjs and node-gi outputs are not byte-identical');
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
