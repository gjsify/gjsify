// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.Template `<signal>` handler + CssName gjs↔node-gi PARITY test.
//
// The GTK analog of the conformance golden-diff harness: ONE unchanged GJS/gi://
// program (test/programs/gtk-template-*.program.mjs) is run on BOTH the reference
// `gjs -m` AND the node-gi twin (each `gi://Ns?version=V` rewritten to
// `requireGi('Ns','V')`, the ambient-globals shim + gi.js prepended — the exact shape
// `gjsify build --app node` emits, minus the bundler). node-gi's observable output
// must equal both the golden expected values AND gjs's output byte-for-byte.
//
// What this locks down (Phase 3.5):
//   • a composite-template `<signal name="clicked" handler="on_click"/>` dispatches to
//     the registered instance's `on_click` method, `this` === the template widget, the
//     handler receives the emitter (arg 0), a bound child is reachable via `this`, and
//     the connection persists across emits;
//   • `CssName` is installed (gtk_widget_class_set_css_name → get_css_name());
//   • `swapped="true"` is rejected identically to gjs (non-fatal Gtk-CRITICAL,
//     construction succeeds, handler NOT connected) — neither runtime supports it.
//
// EXIT-CLEAN: the node-gi twin is a standalone `node <twin>.mjs` that requires + builds
// a template widget, runs the GTK loop to quit, prints, and MUST exit 0 (asserted) —
// the "require + instantiate a template widget + exit must not hang" guard.
//
// SELF-SKIPPING: needs a display (DISPLAY / WAYLAND_DISPLAY) + the Gtk-4.0 typelib, so
// the fast headless legs skip cleanly; the dedicated `gtk-smoke` CI job (Xvfb + the GTK
// stack, gjs installed) runs it. The gjs-parity leg is skipped if gjs is not on PATH,
// but the node-gi golden-value assertions always run.
//
// Reference: refs/gjs/modules/core/overrides/Gtk.js (TemplateBuilderScope), and the
// sibling scripts/conformance.mjs (writeRuntimeTwin). Copyright (c) GNOME contributors
// (gjs) MIT/LGPLv2+; @gjsify contributors MIT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haveDisplay } from './display-gate.mjs';

// gjs is the reference. Probe it once; a missing gjs skips ONLY the parity leg (the
// node-gi golden-value assertions still run).
function gjsAvailable() {
    const res = spawnSync('gjs', ['--version'], { stdio: 'ignore', timeout: 15000 });
    return res.status === 0;
}
const haveGjs = haveDisplay && gjsAvailable();

const skip = !haveDisplay ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)' : false;

// The gjs/gi:// parity programs live OUTSIDE test/ (in ../test-programs/) so node's
// default test-runner glob (`**/test/**/*.mjs`) does not pick them up as test files —
// they are GJS-native (gi:// + ambient print), not node:test modules. Mirrors how the
// conformance harness keeps its programs under conformance/programs/, not test/.
const programsDir = fileURLToPath(new URL('../test-programs/', import.meta.url));
const giUrl = new URL('../gi.js', import.meta.url).href;
const globalsUrl = new URL('../globals.js', import.meta.url).href;

const childEnv = { ...process.env, NODE_GI_NATIVE: process.env.NODE_GI_NATIVE || 'build' };

// Rewrite a gjs/gi:// program into its node-gi twin (mirrors conformance.mjs
// writeRuntimeTwin), using ABSOLUTE file:// imports so the twin is location-independent.
function writeTwin(programName) {
    const src = readFileSync(join(programsDir, programName), 'utf8');
    const rewritten = src.replace(
        /import\s+(\w+)\s+from\s+['"]gi:\/\/(\w+)\?version=([\d.]+)['"];?/g,
        (_m, ident, ns, ver) => `const ${ident} = requireGi('${ns}', '${ver}');`,
    );
    const body = `import ${JSON.stringify(globalsUrl)};\nimport { requireGi } from ${JSON.stringify(giUrl)};\n${rewritten}`;
    const dir = mkdtempSync(join(tmpdir(), 'node-gi-tmpl-'));
    const out = join(dir, programName.replace('.program.mjs', '.twin.mjs'));
    writeFileSync(out, body);
    return out;
}

function runGjs(programName) {
    const res = spawnSync('gjs', ['-m', join(programsDir, programName)], {
        encoding: 'utf8',
        env: childEnv,
        timeout: 60 * 1000,
    });
    return { status: res.status, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() };
}

function runNodeGi(programName) {
    const twin = writeTwin(programName);
    const res = spawnSync('node', [twin], {
        encoding: 'utf8',
        env: childEnv,
        timeout: 60 * 1000,
    });
    return { status: res.status, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() };
}

test('Gtk.Template <signal> handler + CssName: node-gi golden values', { skip }, () => {
    const node = runNodeGi('gtk-template-signals.program.mjs');
    // EXIT-CLEAN: the standalone twin must exit 0, not hang (guarded by the 60s timeout).
    assert.equal(node.status, 0, `node-gi twin should exit 0 (exit-clean); stderr:\n${node.stderr}`);

    const parsed = JSON.parse(node.stdout);
    // The template <signal> dispatched to on_click — twice, connection persists.
    assert.equal(parsed.clickCount, 2, 'on_click ran once per clicked emit (connection persists)');
    // `this` in the handler IS the template widget instance.
    assert.equal(parsed.thisIsWidget, true, '`this` in the handler is the template widget');
    // GJS signal convention: the handler receives the emitter (GtkButton) as arg 0.
    assert.equal(parsed.argCount, 1, 'handler receives the emitter as its first (only) arg');
    // A bound child is reachable via `this.<name>` from inside the handler.
    assert.equal(parsed.titleLabel, 'Hello from a template', '`this` reaches the bound child');
    // CssName installed via gtk_widget_class_set_css_name → get_css_name().
    assert.equal(parsed.cssName, 'nodegisignalsbox', 'CssName installed and read back via get_css_name()');
});

test(
    'Gtk.Template <signal> handler + CssName: gjs byte-parity',
    { skip: skip || (!haveGjs && 'gjs not on PATH') },
    () => {
        const node = runNodeGi('gtk-template-signals.program.mjs');
        const gjs = runGjs('gtk-template-signals.program.mjs');
        assert.equal(gjs.status, 0, `gjs should exit 0; stderr:\n${gjs.stderr}`);
        assert.equal(node.status, 0, `node-gi twin should exit 0; stderr:\n${node.stderr}`);
        // Byte-for-byte identical observable output — node-gi mirrors the gjs gold standard.
        assert.equal(node.stdout, gjs.stdout, 'node-gi template-signal output equals the gjs reference byte-for-byte');
    },
);

test('Gtk.Template swapped="true" rejected like gjs (non-fatal): golden values', { skip }, () => {
    const node = runNodeGi('gtk-template-swapped.program.mjs');
    assert.equal(node.status, 0, `node-gi twin should exit 0 (swapped is non-fatal); stderr:\n${node.stderr}`);
    const parsed = JSON.parse(node.stdout);
    // Construction succeeds: swapped-rejection is a non-fatal Gtk-CRITICAL, exactly as in
    // gjs (neither runtime supports the swapped flag — the closure is just not created).
    assert.equal(parsed.threw, false, 'swapped rejection is non-fatal — construction succeeds (matches gjs)');
});

test('Gtk.Template swapped="true": gjs byte-parity', { skip: skip || (!haveGjs && 'gjs not on PATH') }, () => {
    const node = runNodeGi('gtk-template-swapped.program.mjs');
    const gjs = runGjs('gtk-template-swapped.program.mjs');
    assert.equal(gjs.status, 0, `gjs should exit 0 (swapped is non-fatal there too); stderr:\n${gjs.stderr}`);
    assert.equal(node.status, 0, `node-gi twin should exit 0; stderr:\n${node.stderr}`);
    assert.equal(node.stdout, gjs.stdout, 'node-gi swapped-rejection output equals the gjs reference byte-for-byte');
});
