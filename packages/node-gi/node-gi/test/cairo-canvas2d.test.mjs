// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the cairo canvas2d slice, HEADLESS (no display).
//
// Covers the APIs @gjsify/canvas2d-core drives beyond the base drawing slice:
//  • LinearGradient / RadialGradient (+ addColorStopRGB[A]) as Context sources;
//  • SurfacePattern (+ setExtend/getExtend/setFilter/getFilter);
//  • Context: copyPath/copyPathFlat/appendPath (cairo_path_t handles),
//    identityMatrix, userToDevice/userToDeviceDistance/deviceToUser/
//    deviceToUserDistance, setDash/getDashCount (+ the net-new getDash),
//    getSource (concrete-subclass fan-out), inFill/inStroke, newSubPath.
//
// gjs is the gold standard, verified two ways:
//  • BYTE-FOR-BYTE PIXEL PARITY — the same scene (gradients, repeating surface
//    pattern, dashed stroke, path copy/append round-trip) drawn under `gjs -m`,
//    written to PNG, decoded back and compared pixel-for-pixel;
//  • STATE PARITY — a deterministic probe of every new getter/transform runs on
//    both runtimes and the JSON results must be deeply equal.
// Both self-skip when gjs is not on PATH (bun/deno legs, or a gjs-less box);
// runtime-independent invariants are asserted unconditionally.
//
// Part of the cross-runtime conformance subset (runs on node / bun / deno).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import cairo from '../cairo.js';

// The deterministic scene, as ONE source of truth: called directly under node-gi,
// and its own source (drawScene.toString()) is embedded into the `gjs -m` parity
// child (native cairo) below — so the identical body runs on both.
function drawScene(cairo) {
    const W = 96;
    const H = 72;
    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, W, H);
    const cr = new cairo.Context(surface);

    // Linear-gradient background.
    const lin = new cairo.LinearGradient(0, 0, 0, H);
    lin.addColorStopRGB(0, 0.95, 0.95, 1);
    lin.addColorStopRGBA(1, 0.2, 0.25, 0.5, 1);
    cr.setSource(lin);
    cr.paint();

    // Radial-gradient disc.
    const rad = new cairo.RadialGradient(28, 24, 2, 28, 24, 16);
    rad.addColorStopRGBA(0, 1, 0.9, 0.2, 1);
    rad.addColorStopRGBA(1, 0.8, 0.2, 0.1, 0);
    cr.setSource(rad);
    cr.arc(28, 24, 16, 0, 2 * Math.PI);
    cr.fill();

    // 8x8 checker tile -> repeating SurfacePattern with NEAREST filter, painted
    // through a clip (the canvas2d createPattern('repeat') shape).
    const tile = new cairo.ImageSurface(cairo.Format.ARGB32, 8, 8);
    const tcr = new cairo.Context(tile);
    tcr.setSourceRGB(1, 1, 1);
    tcr.paint();
    tcr.setSourceRGB(0.1, 0.1, 0.1);
    tcr.rectangle(0, 0, 4, 4);
    tcr.fill();
    tcr.rectangle(4, 4, 4, 4);
    tcr.fill();
    tcr.$dispose();
    tile.flush();
    const pat = new cairo.SurfacePattern(tile);
    pat.setExtend(cairo.Extend.REPEAT);
    pat.setFilter(cairo.Filter.NEAREST);
    cr.save();
    cr.rectangle(52, 8, 36, 28);
    cr.clip();
    cr.setSource(pat);
    cr.paint();
    cr.restore();

    // Dashed stroke (setDash), then dashing disabled again by the empty array.
    cr.setLineWidth(2);
    cr.setSourceRGB(0.05, 0.4, 0.1);
    cr.setDash([6, 3, 2, 3], 1);
    cr.moveTo(4, 46);
    cr.lineTo(92, 46);
    cr.stroke();
    cr.setDash([], 0);

    // Path copy/append round-trip: build a triangle, copy it, clear, re-append.
    cr.newPath();
    cr.moveTo(8, 54);
    cr.lineTo(28, 54);
    cr.lineTo(18, 68);
    cr.closePath();
    const saved = cr.copyPath();
    cr.newPath();
    cr.appendPath(saved);
    cr.setSourceRGBA(0.2, 0.2, 0.8, 0.9);
    cr.fill();

    // A flattened curve copied under a transform, appended after identityMatrix
    // (exercises copyPathFlat + the user-space copy semantics).
    cr.save();
    cr.translate(40, 50);
    cr.scale(1.5, 1);
    cr.newPath();
    cr.moveTo(0, 8);
    cr.curveTo(6, -4, 18, 20, 24, 8);
    const flat = cr.copyPathFlat();
    cr.restore();
    cr.identityMatrix();
    cr.newPath();
    cr.appendPath(flat);
    cr.setSourceRGB(0, 0, 0);
    cr.setLineWidth(1);
    cr.stroke();

    // newSubPath: two disjoint circles in ONE path (no connecting segment).
    cr.newPath();
    cr.newSubPath();
    cr.arc(70, 58, 6, 0, 2 * Math.PI);
    cr.newSubPath();
    cr.arc(84, 58, 4, 0, 2 * Math.PI);
    cr.setSourceRGBA(0.6, 0.1, 0.5, 1);
    cr.fill();

    cr.$dispose();
    surface.flush();
    return surface;
}

// Deterministic state probe — every value is computed by cairo itself
// (font/zlib/display-independent), so gjs and node-gi must agree exactly.
// Uses ONLY methods GJS's native cairo exposes (no getDash here — see below).
function probeState(cairo) {
    const out = {};
    const surface = new cairo.ImageSurface(cairo.Format.ARGB32, 40, 30);
    const cr = new cairo.Context(surface);

    // Matrix point/distance transforms under translate+scale.
    cr.translate(10, 20);
    cr.scale(2, 3);
    out.userToDevice = cr.userToDevice(1, 1);
    out.userToDeviceDistance = cr.userToDeviceDistance(1, 1);
    out.deviceToUser = cr.deviceToUser(12, 23);
    out.deviceToUserDistance = cr.deviceToUserDistance(2, 3);
    cr.identityMatrix();
    out.identityUserToDevice = cr.userToDevice(5, 6);

    // inFill / inStroke against a rectangle path.
    cr.newPath();
    cr.rectangle(2, 2, 10, 8);
    out.inFillInside = cr.inFill(5, 5);
    out.inFillOutside = cr.inFill(30, 25);
    cr.setLineWidth(4);
    out.inStrokeOnEdge = cr.inStroke(2, 5);
    out.inStrokeCenter = cr.inStroke(7, 6);

    // Dash state machine, incl. the GJS setDash validation semantics.
    out.dashCountInitial = cr.getDashCount();
    cr.setDash([4, 2], 0.5);
    out.dashCount = cr.getDashCount();
    let dashErr = '';
    try {
        cr.setDash([1, -1], 0);
    } catch (e) {
        dashErr = String(e.message);
    }
    out.dashErr = dashErr;
    cr.setDash([1, undefined, 2], 0); // undefined entries are skipped (GJS)
    out.dashCountSkip = cr.getDashCount();
    cr.setDash([], 0); // empty array disables dashing
    out.dashCountOff = cr.getDashCount();

    // Gradients + surface pattern types, extend/filter get/set.
    const lin = new cairo.LinearGradient(0, 0, 10, 0);
    lin.addColorStopRGB(0, 1, 0, 0);
    lin.addColorStopRGBA(1, 0, 0, 1, 0.5);
    out.linType = lin.getType();
    const rad = new cairo.RadialGradient(0, 0, 1, 5, 5, 10);
    rad.addColorStopRGBA(0, 0, 1, 0, 1);
    out.radType = rad.getType();
    const tile = new cairo.ImageSurface(cairo.Format.ARGB32, 4, 4);
    const sp = new cairo.SurfacePattern(tile);
    out.spType = sp.getType();
    out.spExtendDefault = sp.getExtend();
    sp.setExtend(cairo.Extend.REFLECT);
    out.spExtend = sp.getExtend();
    out.spFilterDefault = sp.getFilter();
    sp.setFilter(cairo.Filter.NEAREST);
    out.spFilter = sp.getFilter();

    // getSource fans out to the concrete pattern class on both runtimes: the
    // surface-pattern source must expose getFilter() (SurfacePattern in gjs).
    cr.setSource(lin);
    out.sourceTypeLinear = cr.getSource().getType();
    cr.setSource(sp);
    out.sourceTypeSurface = cr.getSource().getType();
    out.sourceFilter = cr.getSource().getFilter();
    cr.setSourceRGB(1, 0, 0);
    out.sourceTypeSolid = cr.getSource().getType();

    // Path copy/append round-trip via extents.
    cr.newPath();
    cr.moveTo(1, 2);
    cr.lineTo(11, 2);
    cr.lineTo(11, 9);
    cr.closePath();
    const before = cr.pathExtents();
    const copied = cr.copyPath();
    cr.newPath();
    out.emptyExtents = cr.pathExtents();
    cr.appendPath(copied);
    out.roundTripExtents = cr.pathExtents();
    out.extentsEqual = JSON.stringify(before) === JSON.stringify(out.roundTripExtents);
    const flat = cr.copyPathFlat();
    cr.newPath();
    cr.appendPath(flat);
    out.flatExtents = cr.pathExtents();

    // newSubPath clears the current point (the roundRect/arc idiom).
    cr.newPath();
    cr.moveTo(3, 3);
    out.hasPointBeforeNewSub = cr.hasCurrentPoint();
    cr.newSubPath();
    out.hasPointAfterNewSub = cr.hasCurrentPoint();

    cr.$dispose();
    return out;
}

const haveGjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

test('gradient/pattern classes: hierarchy + handle wiring', () => {
    const lin = new cairo.LinearGradient(0, 0, 10, 10);
    assert.ok(lin instanceof cairo.LinearGradient);
    assert.ok(lin instanceof cairo.Gradient);
    assert.ok(lin instanceof cairo.Pattern);
    assert.equal(lin.getType(), cairo.PatternType.LINEAR);

    const rad = new cairo.RadialGradient(0, 0, 1, 5, 5, 10);
    assert.ok(rad instanceof cairo.Gradient);
    assert.equal(rad.getType(), cairo.PatternType.RADIAL);

    const tile = new cairo.ImageSurface(cairo.Format.ARGB32, 4, 4);
    const sp = new cairo.SurfacePattern(tile);
    assert.ok(sp instanceof cairo.SurfacePattern);
    assert.ok(sp instanceof cairo.Pattern);
    assert.equal(sp.getType(), cairo.PatternType.SURFACE);

    lin.$dispose();
    rad.$dispose();
    sp.$dispose();
    tile.$dispose();
});

test('getSource returns the concrete pattern subclass', () => {
    const s = new cairo.ImageSurface(cairo.Format.ARGB32, 8, 8);
    const cr = new cairo.Context(s);

    cr.setSourceRGB(1, 0, 0);
    assert.ok(cr.getSource() instanceof cairo.SolidPattern);

    const lin = new cairo.LinearGradient(0, 0, 8, 0);
    cr.setSource(lin);
    assert.ok(cr.getSource() instanceof cairo.LinearGradient);

    const rad = new cairo.RadialGradient(0, 0, 1, 4, 4, 8);
    cr.setSource(rad);
    assert.ok(cr.getSource() instanceof cairo.RadialGradient);

    const tile = new cairo.ImageSurface(cairo.Format.ARGB32, 2, 2);
    const sp = new cairo.SurfacePattern(tile);
    cr.setSource(sp);
    const src = cr.getSource();
    assert.ok(src instanceof cairo.SurfacePattern);
    // The returned wrapper owns its own ref — usable after the original goes away.
    sp.$dispose();
    assert.equal(src.getType(), cairo.PatternType.SURFACE);
    assert.equal(src.getExtend(), cairo.Extend.NONE);

    cr.$dispose();
    s.$dispose();
});

test('setDash/getDash/getDashCount round-trip (getDash is net-new)', () => {
    const s = new cairo.ImageSurface(cairo.Format.ARGB32, 4, 4);
    const cr = new cairo.Context(s);
    assert.equal(cr.getDashCount(), 0);
    cr.setDash([4, 2], 0.5);
    assert.equal(cr.getDashCount(), 2);
    assert.deepEqual(cr.getDash(), [[4, 2], 0.5]);
    assert.throws(() => cr.setDash([0], 0), /Dash value must be positive/);
    assert.throws(() => cr.setDash([1, -2], 0), /Dash value must be positive/);
    cr.setDash([], 0);
    assert.deepEqual(cr.getDash(), [[], 0]);
    cr.$dispose();
    s.$dispose();
});

test('copyPath handles are live cairo.Path objects; appendPath typechecks', () => {
    const s = new cairo.ImageSurface(cairo.Format.ARGB32, 8, 8);
    const cr = new cairo.Context(s);
    cr.rectangle(1, 1, 4, 4);
    const p = cr.copyPath();
    assert.ok(p instanceof cairo.Path);
    const pf = cr.copyPathFlat();
    assert.ok(pf instanceof cairo.Path);
    assert.throws(() => cr.appendPath({}), /expected a cairo\.Path/);
    // A wrong-kind handle (a Surface) is rejected by the native typecheck.
    assert.throws(() => cr.appendPath(s), /expected a live cairo\.Path/);
    cr.newPath();
    cr.appendPath(p);
    assert.deepEqual(cr.pathExtents(), [1, 1, 5, 5]);
    cr.$dispose();
    s.$dispose();
});

test('scene invariants: repeated tile + dash gap pixels (AA-independent)', () => {
    const s = drawScene(cairo);
    const data = s.getData();
    const stride = s.getStride();
    // oxlint-disable-next-line unicorn/no-useless-spread -- `data` is a Uint8Array, so .slice() returns a Uint8Array; the spread CONVERTS to a plain Array (the assert.deepEqual calls below compare against array literals)
    const px = (x, y) => [...data.slice(y * stride + x * 4, y * stride + x * 4 + 4)];
    // Checker tile (pattern origin = surface origin; dark squares at tile-mod
    // (0..3,0..3)+(4..7,4..7)): dark interior is exactly rgb(0.1,0.1,0.1) -> 25
    // per channel; the light one pure white. (58,10) ≡ (2,2) dark, (54,10) ≡
    // (6,2) light, (66,18) ≡ (2,2) one repeat period later.
    assert.deepEqual(px(58, 10), [25, 25, 25, 255], 'dark checker square (B,G,R,A)');
    assert.deepEqual(px(54, 10), [255, 255, 255, 255], 'light checker square');
    assert.deepEqual(px(66, 18), [25, 25, 25, 255], 'repeat period dark square');
    s.$dispose();
});

// BYTE-FOR-BYTE pixel parity vs gjs: identical scene, drawn by gjs's native cairo,
// written to PNG, decoded back with node-gi, compared to node-gi's own render.
test('pixel parity with gjs (byte-for-byte)', { skip: haveGjs ? false : 'gjs not on PATH' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'nodegi-cairo-c2d-gjs-'));
    try {
        const gjsPng = join(dir, 'gjs.png');
        const gjsScript = join(dir, 'draw.js');
        const src =
            `import cairo from 'cairo';\n` +
            `const drawScene = ${drawScene.toString()};\n` +
            `const s = drawScene(cairo);\n` +
            `s.writeToPNG(${JSON.stringify(gjsPng)});\n`;
        writeFileSync(gjsScript, src);
        const res = spawnSync('gjs', ['-m', gjsScript], { encoding: 'utf8' });
        assert.equal(res.status, 0, `gjs draw failed: ${res.stderr}`);
        assert.ok(existsSync(gjsPng), 'gjs produced a PNG');

        const fromGjs = cairo.ImageSurface.createFromPNG(gjsPng);
        const own = drawScene(cairo);
        const a = fromGjs.getData();
        const b = own.getData();
        assert.equal(a.length, b.length, 'same pixel-buffer length');
        assert.deepEqual(Buffer.from(a), Buffer.from(b), 'gjs and node-gi pixels are byte-identical');
        fromGjs.$dispose();
        own.$dispose();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// STATE parity vs gjs: the probe runs on both runtimes; results must deep-equal.
test(
    'state parity with gjs (transforms, dash, patterns, paths)',
    {
        skip: haveGjs ? false : 'gjs not on PATH',
    },
    () => {
        const dir = mkdtempSync(join(tmpdir(), 'nodegi-cairo-c2d-probe-'));
        try {
            const gjsScript = join(dir, 'probe.js');
            const src =
                `import cairo from 'cairo';\n` +
                `const probeState = ${probeState.toString()};\n` +
                `print(JSON.stringify(probeState(cairo)));\n`;
            writeFileSync(gjsScript, src);
            const res = spawnSync('gjs', ['-m', gjsScript], { encoding: 'utf8' });
            assert.equal(res.status, 0, `gjs probe failed: ${res.stderr}`);
            const fromGjs = JSON.parse(res.stdout.trim());
            const own = JSON.parse(JSON.stringify(probeState(cairo)));
            assert.deepEqual(own, fromGjs, 'gjs and node-gi state probes are identical');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
