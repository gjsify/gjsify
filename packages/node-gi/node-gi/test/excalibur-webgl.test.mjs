// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Excalibur.js renders through WebGL on node-gi (capstone).
//
// The Axis-5 GTK-bridge capstone: a REAL WebGL game engine (Excalibur 0.32 —
// the engine behind showcases/dom/excalibur-jelly-jumper and the PixelRPG
// map-editor) boots against `@gjsify/webgl`'s `WebGLBridge`, compiles its real
// shaders, uploads geometry, and renders frames — UNCHANGED — under the
// node-gi reverse bridge on a headless software-GL display:
//
//   gjsify build fixtures/excalibur-webgl-app.ts --app gjs  → gjs -m … (native gi://)
//   gjsify build fixtures/excalibur-webgl-app.ts --app node → node …  (@gjsify/node-gi)
//
// The ONE shared source ([../fixtures/excalibur-webgl-app.ts](../fixtures/excalibur-webgl-app.ts))
// presents a `Gtk.ApplicationWindow` holding a `WebGLBridge`, boots
// `new ex.Engine({ canvasElement })` (DisplayMode.FitContainerAndFill — the
// exact jelly-jumper configuration: the canvas parented to document.body,
// resize via our ResizeObserver polyfill), awaits `engine.start()`, renders 5
// frames through Excalibur's WebGL2 pipeline (shader compile/link, bufferData,
// vertexAttribPointer, drawArrays / drawElements, clearBufferfv at
// blitToScreen), then reads the two proof pixels back off the GL framebuffer:
// the screen-centered blue Actor and the red engine clear color at the corner.
// The GL stack is pure software (llvmpipe) so the GOLDEN is display-independent
// — and it IS gjs's own byte-output (the local gjs leg re-proves that;
// NODE_GI_EXCALIBUR_SKIP_GJS=1 skips it, mirroring NODE_GI_WEBGL_SKIP_GJS).
//
// Globals: the gjs leg builds with `--globals auto,dom` (jelly-jumper's flags);
// the node leg names the SAME surface explicitly (`auto,dom,XMLHttpRequest,…`)
// — the reverse bridge's explicit-extras register injection (an explicit
// `--globals` list on `--app node` bundles the real `@gjsify/*` registers over
// node-gi instead of the plain-Node `@gjsify/empty` stubs).
//
// SELF-SKIPS when there is no display, when the `gjsify` CLI is absent, when
// the committed Gwebgl prebuild is missing for this arch, or when
// excalibur / `@gjsify/webgl` are not resolvable (workspace not built). This is
// a LOCAL/dev verification, not a CI job (the fixture pulls the whole
// `@gjsify/webgl` + dom-elements gi:// graph — a from-scratch workspace rebuild
// is not worth a CI container; the raw seam stays covered by webgl-glarea).
//
// Run recipe (needs a display + built workspace + the WORKSPACE CLI):
//
//   export GJSIFY_BIN="$(git rev-parse --show-toplevel)/packages/infra/cli/lib/index.js"
//   xvfb-run -a dbus-run-session -- \
//     env -u FORCE_COLOR GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
//         GTK_A11Y=none NODE_GI_NATIVE=build GJSIFY_BIN="$GJSIFY_BIN" \
//     node --test test/excalibur-webgl.test.mjs
//   # Drop NODE_GI_EXCALIBUR_SKIP_GJS to additionally re-prove the golden IS
//   # gjs's own output (builds + runs --app gjs; needs the register libs built).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// Fixture lives OUTSIDE test/ (node --test's default glob would try to run the
// unbundled gi:// source directly) — same layout as webgl-glarea.
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..', '..');
const fixture = join(pkgRoot, 'fixtures', 'excalibur-webgl-app.ts');

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// The committed gwebgl Vala prebuild (typelib + .so) @gjsify/webgl ships.
const gwebglDir = join(
    repoRoot,
    'packages',
    'framework',
    'webgl',
    'prebuilds',
    `linux-${process.arch}`,
);
const haveGwebgl = existsSync(join(gwebglDir, 'Gwebgl-0.1.typelib'));

function findGjsify() {
    if (process.env.GJSIFY_BIN && existsSync(process.env.GJSIFY_BIN)) return process.env.GJSIFY_BIN;
    // Prefer the WORKSPACE-built CLI over `.bin/gjsify`: the latter resolves to
    // the COMMITTED cli.gjs.mjs GJS bundle, which may predate the `--app node`
    // explicit-`--globals` register injection this fixture's node build relies
    // on (a stale bundle builds a bundle with NO dom registers → Excalibur dies
    // with `document is not defined`).
    const workspaceCli = join(repoRoot, 'packages', 'infra', 'cli', 'lib', 'index.js');
    if (existsSync(workspaceCli)) return workspaceCli;
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

// The fixture bundles excalibur + the full @gjsify/webgl TS stack — both must
// resolve from the monorepo (a bare node-gi tree skips cleanly).
function resolvable(spec) {
    try {
        createRequire(fixture).resolve(spec);
        return true;
    } catch {
        return false;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : !haveGwebgl
        ? `Gwebgl prebuild missing (${gwebglDir})`
        : !gjsify
            ? 'gjsify CLI not found (workspace not installed)'
            : !resolvable('excalibur')
                ? 'excalibur not resolvable (workspace not installed)'
                : !resolvable('@gjsify/webgl')
                    ? '@gjsify/webgl not resolvable (workspace not built)'
                    : false;

// gjs gold-standard leg: needs gjs on PATH + the workspace register libs BUILT
// (`--app gjs` force-INLINES `<pkg>/register` subpaths — an unbuilt workspace
// cannot produce a loadable gjs bundle). Same probe as webgl-glarea.
const workspaceBuilt = existsSync(join(repoRoot, 'packages', 'node', 'buffer', 'lib', 'esm', 'register.js'));
const haveGjs = !process.env.NODE_GI_EXCALIBUR_SKIP_GJS
    && workspaceBuilt
    && spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// The committed golden — gjs's own byte-output (re-proven by the gjs leg).
// `pixel-center` is the blue Actor rendered through Excalibur's real quad
// pipeline; `pixel-corner` is the engine's red clear color.
const GOLDEN = [
    'excalibur-webgl: start',
    'activated',
    'ready: canvas sized',
    'engine: started',
    'pixel-center: 0,0,255,255',
    'pixel-corner: 255,0,0,255',
    'frames: ok',
    'quit',
    'done',
].join('\n');

// Only the app's own deterministic lines are asserted — a headless GTK/dbus
// session prints assorted portal / a11y / gvfs noise that varies by host.
const GOLDEN_PREFIXES = [
    'excalibur-webgl:',
    'activated',
    'ready:',
    'engine:',
    'pixel-',
    'frames:',
    'quit',
    'done',
    'boot-error:',
    'activate-error:',
];

// The identifier surface the two legs inject. gjs: `auto,dom` (jelly-jumper's
// exact flags — auto detection covers the rest, incl. the Gst/Manette-backed
// audio/gamepad registers that are native on GJS). node: auto detection cannot
// inject web/dom registers (plain-Node loadability), so the needed identifiers
// are named explicitly — the dom group + XHR (Excalibur's Detector probes it at
// Engine construction). `AudioContext` is deliberately NOT injected on node:
// even ex.DefaultLoader runs `await WebAudio.unlock()`, and without the global
// it no-ops instead of dragging the Gst-backed `@gjsify/webaudio` stack into
// this GL capstone (webaudio-on-node-gi is its own follow-up surface).
const GJS_GLOBALS = 'auto,dom';
const NODE_GLOBALS = 'auto,dom,XMLHttpRequest';

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

function gjsifyExec(args, timeoutMs) {
    return /\.[mc]?js$/.test(gjsify)
        ? exec(process.execPath, [gjsify, ...args], timeoutMs)
        : exec(gjsify, args, timeoutMs);
}

function build(entry, app, outfile, globals) {
    gjsifyExec(['build', entry, '--app', app, '--outfile', outfile, '--globals', globals], 240 * 1000);
    assert.ok(existsSync(outfile), `${outfile} was not produced`);
    return outfile;
}

// Keep ONLY the golden lifecycle lines (each carries a known prefix).
function run(cmd, args) {
    const raw = exec(cmd, args, 120 * 1000, RUN_ENV);
    return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => GOLDEN_PREFIXES.some((p) => l === p || l.startsWith(p)))
        .join('\n');
}

test(
    'Excalibur.js boots + renders through WebGLBridge on node-gi (capstone)',
    { skip },
    () => {
        // Build INSIDE the monorepo (the --app node bundle keeps
        // @gjsify/node-gi external — /tmp has no node_modules to resolve it).
        const dir = mkdtempSync(join(pkgRoot, '.tmp-excalibur-'));
        try {
            // --- node-gi: the real `--app node` bundle (the authoritative check) ---
            const nodeBundle = build(fixture, 'node', join(dir, 'app.node.mjs'), NODE_GLOBALS);
            assert.ok(
                readFileSync(nodeBundle, 'utf-8').includes('requireGi'),
                'the --app node bundle did not rewrite gi:// → requireGi (gjsify CLI too old)',
            );
            const nodeOut = run('node', [nodeBundle]);
            assert.equal(nodeOut, GOLDEN, 'node-gi output diverged from the committed golden');

            // --- gjs gold-standard: re-prove the golden IS gjs's own output ---
            if (haveGjs) {
                const gjsBundle = build(fixture, 'gjs', join(dir, 'app.gjs.mjs'), GJS_GLOBALS);
                const gjsOut = run('gjs', ['-m', gjsBundle]);
                assert.equal(gjsOut, GOLDEN, 'gjs gold-standard diverged from the committed golden');
                assert.equal(gjsOut, nodeOut, 'gjs and node-gi outputs are not byte-identical');
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
