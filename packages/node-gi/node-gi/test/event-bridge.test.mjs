// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the LIVE @gjsify/event-bridge dispatches DOM events on node-gi.
//
// The GTK→DOM event bridge (`@gjsify/event-bridge`) attaches GTK4
// `EventControllerMotion`/`GestureClick`/`EventControllerScroll`/
// `EventControllerKey`/`EventControllerFocus` to a widget and dispatches W3C DOM
// events (Mouse/Pointer/Keyboard/Wheel/FocusEvent) on the associated element. Its
// GJS spec (`packages/framework/event-bridge/src/event-bridge.spec.ts`) drives the
// LIVE controllers via `emit(signal, …)` and asserts the DOM event fields. This
// e2e proves the SAME path runs UNCHANGED on node-gi:
//
//   gjsify build fixtures/event-bridge-app.ts --app gjs  → gjs  -m …  (native gi://)
//   gjsify build fixtures/event-bridge-app.ts --app node → node   …   (@gjsify/node-gi)
//
// The ONE shared source ([../fixtures/event-bridge-app.ts](../fixtures/event-bridge-app.ts))
// puts a `Gtk.DrawingArea` in an `ApplicationWindow`, `present()`s it (so it
// realizes + allocates), `attachEventControllers`, then drives a synthesized
// event through each live `Gtk.EventController*` and asserts the resulting DOM
// event's type / coords / `getModifierState` / key / code — the `Gdk.ModifierType`
// flags + `Gdk.keyval_*` marshalling must match GJS. It quits from a `GLib.timeout`.
// The AUTHORITATIVE assertion (always on): the node-gi `--app node` bundle runs +
// exits 0 and prints the fixed committed GOLDEN. Every line is deterministic +
// display-independent (coords clamped to the fixed 400x300 allocation; key/code/
// modifiers computed from Gdk marshalling), so the golden is stable — the same
// committed-golden conformance pattern node-gi uses elsewhere. A gjs gold-standard
// gate additionally re-proves the golden IS gjs's own byte-output by building +
// running `--app gjs` (default on; set NODE_GI_EB_SKIP_GJS=1 for a node-only run —
// see the haveGjs note); the same gold-standard parity the `canvas2d-bridge` e2e uses.
//
// The fixture retrieves controllers by ADD ORDER off `observe_controllers()` (identity
// is preserved + `emit()` resolves by the live GType) rather than by the spec's
// `ctrl instanceof Gtk.EventControllerMotion` filter. `instanceof` across the GObject
// hierarchy IS wired now (see test/instanceof.test.mjs + conformance/programs/
// instanceof-hierarchy.conf.mjs), so this is a stylistic choice, not a routed-around
// gap. The BEHAVIOR under test — the bridge dispatching correct DOM events — is the same.
//
// This is a LOCAL/dev verification, NOT wired into CI. Running the LIVE bridge needs
// the full gjsify workspace built with a CURRENT-source `@gjsify/cli` (the
// register-inline for --app gjs the published CLI predates) + a display + the node-gi
// addon — a heavyweight from-scratch rebuild too fragile to gate a minimal CI
// container on. The node-gi event-bridge behaviour is already proven by the
// byte-parity below (run locally), captured in the committed GOLDEN. It SELF-SKIPS in
// the default `npm test` (no display), when `gjsify` is absent, or when
// `@gjsify/event-bridge` is not resolvable, so it is harmless in every CI leg that
// discovers it.
//
// RUN LOCALLY (from a built workspace, under a display):
//   gjsify workspace @gjsify/event-bridge build:gjsify --with-dependencies
//   NODE_GI_NATIVE=build node --test packages/node-gi/node-gi/test/event-bridge.test.mjs
// Under Xvfb: prefix with `xvfb-run -a dbus-run-session -- env GSK_RENDERER=cairo
// GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none`. Point GJSIFY_BIN at a
// current-source CLI (`…/packages/infra/cli/lib/index.js`) if `gjsify` on PATH is
// older. GTK needs the software-render env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haveDisplay } from './display-gate.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
// The fixture lives OUTSIDE test/ on purpose: node --test's default glob
// (**/test/**/*.{mjs,ts,…}) would otherwise pick it up and try to run the
// unbundled gi:// source directly, which fails to resolve.
const pkgRoot = join(here, '..');
const fixture = join(pkgRoot, 'fixtures', 'event-bridge-app.ts');

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

// Is `@gjsify/event-bridge` (with a built lib/) resolvable from the fixture? On a
// bare node-gi tree (no workspace install/build) it is not — skip cleanly there.
function eventBridgeResolvable() {
    try {
        createRequire(fixture).resolve('@gjsify/event-bridge');
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
      : !eventBridgeResolvable()
        ? '@gjsify/event-bridge not resolvable (workspace not built)'
        : false;

// The gjs gold-standard leg re-proves the committed GOLDEN below IS exactly gjs's
// own byte-output. It is ON by default (a local run); set NODE_GI_EB_SKIP_GJS=1 for a
// node-gi-only run (the node-gi assertion vs the committed golden stays the
// authoritative check — deterministic + display-independent, so the golden is stable
// without a `gjs -m` rebuild). Building --app gjs correctly requires the
// register-subpath-inline bundler (AGENTS.md: `@gjsify/<pkg>/register` MUST NOT be
// externalized for --app gjs — GJS's ESM loader can't resolve it), so run it with a
// current-source `gjsify` (see the header).
const haveGjs = !process.env.NODE_GI_EB_SKIP_GJS && spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// The fixed sequence of lines both runtimes must print, in order — the committed
// golden. It IS gjs's own output (asserted by the local gjs leg below).
const GOLDEN = [
    'event-bridge: start',
    'activated',
    'motion: 12,8', // pointermove clientX,clientY — coords pass through the clamp
    'move: 8,10', // movementX,movementY across successive motions
    'clamp: 0,0', // motion(-3,-7) → clamped to the allocation lower bound
    'wheel: 0,3', // scroll(0,1) → WheelEvent deltaX,deltaY (a WHEEL notch is three DOM_DELTA_LINE lines)
    'keydown: a KeyA shift=true ctrl=false', // Gdk.KEY_a + Gdk.ModifierType.SHIFT_MASK
    'modstate: Shift=true Control=false', // KeyboardEvent.getModifierState()
    'keydown: ArrowLeft ArrowLeft shift=false ctrl=true', // Gdk.KEY_Left + CONTROL_MASK (special-key marshalling)
    'keyup: a', // key-released → keyup
    'focus: focus,focusin', // EventControllerFocus enter → focus + focusin
    'blur: blur,focusout', // EventControllerFocus leave → blur + focusout
    'quit',
    'done',
].join('\n');

// Only the app's own deterministic lines are asserted — a headless GTK/dbus session
// prints assorted portal / a11y / gvfs warnings that vary by host.
const GOLDEN_PREFIXES = [
    'event-bridge:',
    'activated',
    'motion:',
    'move:',
    'clamp:',
    'wheel:',
    'keydown:',
    'modstate:',
    'keyup:',
    'focus:',
    'blur:',
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

// Invoke the resolved gjsify CLI. A workspace CLI entry (…/infra/cli/lib/index.js)
// is a plain .js — run it via `node` so it works regardless of the +x bit; a shell
// shim (the workspace `.bin/gjsify`) is exec'd directly. Point GJSIFY_BIN at the
// WORKSPACE-built CLI (current source: it carries the register-inline for --app gjs
// that the published @gjsify/cli predates).
function gjsifyExec(args, timeoutMs) {
    return /\.[mc]?js$/.test(gjsify)
        ? exec(process.execPath, [gjsify, ...args], timeoutMs)
        : exec(gjsify, args, timeoutMs);
}

function build(app, outfile) {
    gjsifyExec(['build', fixture, '--app', app, '--outfile', outfile], 180 * 1000);
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

test('event-bridge dispatches DOM events on node-gi (byte-identical to the golden)', { skip }, () => {
    // Build INSIDE the monorepo (not os tmpdir): the --app node bundle keeps
    // `@gjsify/node-gi` external, so it must run from a tree where that package
    // resolves (the root node_modules/@gjsify/node-gi symlink). /tmp has no such
    // node_modules → ERR_MODULE_NOT_FOUND at run time. Kept at the package root
    // (not under test/) so a stray dir never trips node --test's glob.
    const dir = mkdtempSync(join(pkgRoot, '.tmp-eb-'));
    try {
        // --- node-gi: the real `--app node` bundle (the authoritative check) ---
        const nodeBundle = build('node', join(dir, 'app.node.mjs'));
        // The bridge pulls @gjsify/event-bridge + its gi:// graph, so the build
        // MUST have rewritten gi:// → requireGi. A CLI predating that rewrite is
        // a hard failure here, not a skip.
        assert.ok(
            readFileSync(nodeBundle, 'utf-8').includes('requireGi'),
            'the --app node bundle did not rewrite gi:// → requireGi (gjsify CLI too old)',
        );
        const nodeOut = run('node', [nodeBundle]);
        assert.equal(nodeOut, GOLDEN, 'node-gi output diverged from the committed golden');

        // --- gjs gold-standard (LOCAL/dev gate): re-prove the golden IS gjs's ---
        // Off with NODE_GI_EB_SKIP_GJS=1 — see the haveGjs note above.
        if (haveGjs) {
            const gjsBundle = build('gjs', join(dir, 'app.gjs.mjs'));
            const gjsOut = run('gjs', ['-m', gjsBundle]);
            assert.equal(gjsOut, GOLDEN, 'gjs gold-standard diverged from the committed golden');
            assert.equal(gjsOut, nodeOut, 'gjs and node-gi outputs are not byte-identical');
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
