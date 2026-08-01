// SPDX-License-Identifier: MIT
// Zero-arg boxed/struct construction for @gjsify/node-gi — GJS gi/boxed.cpp
// parity: `new <BoxedStruct>()` with NO args yields a ZERO-INITIALIZED instance
// when the struct has no static 'new' constructor (Graphene.Rect / Point,
// Gdk.Rectangle, Gdk.RGBA — most plain-data boxeds). Regression for the
// `no static method 'new' on Graphene.Rect` throw that blocked
// `@gjsify/devtools`' screenshot chain (screenshot.ts: `new Graphene.Rect()`
// + `viewport.init(...)`).
//
// Exercises (each verified against `gjs -m` — the values in the assertions ARE
// the gjs 1.88 output, and the parity test below re-proves it wherever gjs is
// on PATH):
//  * `new Graphene.Rect()` → zero-initialized boxed; init() + getters work
//  * `new Graphene.Point()` → fields read 0 and are writable via init()
//  * `new Gdk.Rectangle()` / `new Gdk.RGBA()` → field set/get on the zero blob
//  * a struct WITH a 'new' constructor still routes to it (`GLib.MainLoop`)
//  * args WITHOUT a 'new' constructor → a clear error (GJS supports no
//    positional field args either)
//  * a union / opaque struct without 'new' keeps throwing (GJS never
//    zero-allocates those)
//  * GC churn: the g_boxed_copy'd zero blobs free via g_boxed_free without
//    corrupting graphene's allocator
//
// SELF-SKIPPING per namespace: Graphene-1.0 / Gdk-4.0 typelibs may be absent on
// a minimal headless box (they ship with gtk4). No display is needed — struct
// construction never inits GTK — so this file is cross-runtime (bun/deno) safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');

let Graphene = null;
let grapheneSkip = false;
try {
    Graphene = requireGi('Graphene', '1.0');
} catch (err) {
    grapheneSkip = `Graphene-1.0 typelib unavailable: ${err.message}`;
}

let Gdk = null;
let gdkSkip = false;
try {
    Gdk = requireGi('Gdk', '4.0');
} catch (err) {
    gdkSkip = `Gdk-4.0 typelib unavailable: ${err.message}`;
}

test('new Graphene.Rect() zero-initializes; init() + getters work', { skip: grapheneSkip }, () => {
    const r = new Graphene.Rect();
    // Zero-initialized before init (GJS: a fresh boxed reads all-zero fields).
    assert.equal(r.get_x(), 0);
    assert.equal(r.get_width(), 0);
    r.init(0, 0, 10, 20);
    assert.equal(r.get_x(), 0);
    assert.equal(r.get_width(), 10);
    assert.equal(r.get_height(), 20);
    // init() returns the rect itself (chainable) — same boxed surface as gjs.
    const r2 = new Graphene.Rect().init(1, 2, 3, 4);
    assert.equal(r2.get_x(), 1);
    assert.equal(r2.get_height(), 4);
});

test('new Graphene.Point() zero-initializes; fields readable/writable', { skip: grapheneSkip }, () => {
    const p = new Graphene.Point();
    assert.equal(p.x, 0);
    assert.equal(p.y, 0);
    p.init(3, 4);
    assert.equal(p.x, 3);
    assert.equal(p.y, 4);
});

test('new Gdk.Rectangle() zero-initializes; field set/get works', { skip: gdkSkip }, () => {
    const rect = new Gdk.Rectangle();
    assert.equal(rect.x, 0);
    assert.equal(rect.y, 0);
    assert.equal(rect.width, 0);
    assert.equal(rect.height, 0);
    rect.x = 5;
    rect.width = 7;
    assert.equal(rect.x, 5);
    assert.equal(rect.width, 7);
    assert.equal(rect.y, 0);
});

test('new Gdk.RGBA() zero-initializes; field set/get works', { skip: gdkSkip }, () => {
    const c = new Gdk.RGBA();
    assert.equal(c.red, 0);
    assert.equal(c.green, 0);
    assert.equal(c.blue, 0);
    assert.equal(c.alpha, 0);
    c.red = 0.5;
    c.alpha = 1;
    assert.equal(c.red, 0.5);
    assert.equal(c.alpha, 1);
    assert.equal(c.green, 0);
    // A method on the zero-allocated boxed works too (gjs prints the same:
    // gdk_rgba_to_string emits the rgb() form when alpha == 1).
    assert.equal(c.to_string(), 'rgb(128,0,0)');
});

test("a struct WITH a 'new' constructor still routes to it (GLib.MainLoop)", () => {
    // The pre-existing behavior — `new` present → invoked with the args.
    const loop = new GLib.MainLoop(null, false);
    assert.equal(loop.is_running(), false);
    // The static form is untouched as well.
    const loop2 = GLib.MainLoop.new(null, false);
    assert.equal(loop2.is_running(), false);
});

test("args WITHOUT a 'new' constructor throw a clear error", { skip: grapheneSkip }, () => {
    // GJS throws too (`Constructor with multiple arguments not supported for
    // Rect`) — positional field args are not a GJS feature either.
    assert.throws(() => new Graphene.Rect(1, 2), /constructor takes no arguments \(boxed struct has no 'new'\)/);
});

test("a union / opaque struct without 'new' keeps throwing", () => {
    // GMutex is a union with no constructor; GJS's union.cpp never
    // zero-allocates a union (it requires a zero-args constructor).
    assert.throws(() => new GLib.Mutex(), /unable to construct/);
});

test('GC churn: zero-allocated boxeds free via g_boxed_free without crashing', { skip: grapheneSkip }, () => {
    // The zero blob is g_boxed_copy'd so the finalizer's g_boxed_free matches
    // graphene's own allocator — a raw g_malloc0 blob handed to g_boxed_free
    // would corrupt it. Churn enough instances to cross GC cycles.
    for (let i = 0; i < 20000; i++) {
        const t = new Graphene.Rect();
        t.init(i, 0, 1, 1);
    }
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const alive = new Graphene.Rect().init(9, 8, 7, 6);
    assert.equal(alive.get_x(), 9);
});

// Gold-standard parity: the SAME probe function runs under `gjs -m` (serialized
// via toString(), the cairo-canvas2d pattern); outputs must be identical — gjs
// is the reference (the conformance README contract).
const haveGjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// One shared probe, no runtime branches: the SAME source runs on node-gi and gjs.
function structProbe(GLibNs, GrapheneNs, GdkNs) {
    const out = [];
    const r = new GrapheneNs.Rect();
    out.push(['rect-zero', r.get_x(), r.get_width()]);
    r.init(0, 0, 10, 20);
    out.push(['rect-init', r.get_x(), r.get_width(), r.get_height()]);
    const p = new GrapheneNs.Point();
    out.push(['point-zero', p.x, p.y]);
    p.init(3, 4);
    out.push(['point-init', p.x, p.y]);
    const rect = new GdkNs.Rectangle();
    rect.x = 5;
    rect.width = 7;
    out.push(['gdkrect', rect.x, rect.width, rect.y, rect.height]);
    const c = new GdkNs.RGBA();
    c.red = 0.5;
    c.alpha = 1;
    out.push(['rgba', c.red, c.alpha, c.green, c.to_string()]);
    const loop = new GLibNs.MainLoop(null, false);
    out.push(['mainloop', loop.is_running()]);
    try {
        new GrapheneNs.Rect(1, 2);
        out.push(['args', 'no-throw']);
    } catch (e) {
        out.push(['args', 'throws']);
    }
    return out;
}

test(
    'parity with gjs (identical probe values)',
    {
        skip: !haveGjs ? 'gjs not on PATH' : grapheneSkip || gdkSkip,
    },
    () => {
        const dir = mkdtempSync(join(tmpdir(), 'nodegi-struct-construct-'));
        try {
            const gjsScript = join(dir, 'probe.mjs');
            writeFileSync(
                gjsScript,
                `import GLib from 'gi://GLib?version=2.0';\n` +
                    `import Graphene from 'gi://Graphene?version=1.0';\n` +
                    `import Gdk from 'gi://Gdk?version=4.0';\n` +
                    `const structProbe = ${structProbe.toString()};\n` +
                    `print(JSON.stringify(structProbe(GLib, Graphene, Gdk)));\n`,
            );
            const res = spawnSync('gjs', ['-m', gjsScript], { encoding: 'utf8' });
            assert.equal(res.status, 0, `gjs probe failed: ${res.stderr}`);
            const fromGjs = JSON.parse(res.stdout.trim());
            const own = JSON.parse(JSON.stringify(structProbe(GLib, Graphene, Gdk)));
            assert.deepEqual(own, fromGjs, 'gjs and node-gi probe outputs are identical');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
