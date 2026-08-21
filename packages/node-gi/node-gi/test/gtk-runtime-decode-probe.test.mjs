// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the DECODE probe the GTK bundle builders record into their manifest
// and the release gate asserts (#996).
//
// WHY IT IS UNIT-TESTED HERE, like the two gates in gtk-runtime-bundle-gates.test.mjs:
// the probe only ever runs inside a bundle builder, and those run on no machine a
// developer has. A bug in it surfaces either as a red release leg or — the expensive
// one — as a green leg that shipped the defect the probe exists to catch. So everything
// about the probe that is NOT the decode itself is pure and is driven from here.
//
// THE DEFECT UNDER TEST, measured on the published darwin-x64 0.28.0 bundle: 860 icon
// files, manifest `verified icons: 863`, and `Pixbuf.new_from_file()` on the bundle's
// own Adwaita SVG returning −1×−1 — the addon kept absolute Homebrew install names, so
// a Mac with Homebrew glib loaded two GObject registries and type identity failed
// across the boundary. Every count in the manifest was correct. A file count is not a
// capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAddonPath, prebuildAddonPath } from '../native-paths.js';
import {
    HOST_GTK_ENV,
    PROBE_KINDS,
    decodeProbeProblems,
    probeChildEnv,
    selectProbeImages,
    spawnDecodeProbe,
} from '../../scripts/decode-probe.mjs';

/** A directory shaped enough like a bundle for the probe to find images in it. */
function fakeBundle({ svg = true, png = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-probe-fixture-'));
    mkdirSync(join(dir, 'share', 'icons', 'Adwaita'), { recursive: true });
    // A one-pixel-ish SVG and PNG, written rather than copied: the point of these cases
    // is WHICH file the walk picks, not what is inside it.
    if (svg) {
        writeFileSync(
            join(dir, 'share', 'icons', 'Adwaita', 'zzz-last.svg'),
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>',
        );
        writeFileSync(
            join(dir, 'share', 'icons', 'Adwaita', 'aaa-first.svg'),
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>',
        );
    }
    if (png) writeFileSync(join(dir, 'share', 'icons', 'Adwaita', 'icon.png'), Buffer.alloc(8));
    return dir;
}

test('selectProbeImages picks the sorted-first svg and png, so two builds probe the same file', () => {
    const dir = fakeBundle();
    const picked = selectProbeImages(dir);
    // Posix separators in the record: a manifest reader on any OS compares these.
    assert.equal(picked.svg, 'share/icons/Adwaita/aaa-first.svg');
    assert.equal(picked.png, 'share/icons/Adwaita/icon.png');
});

test('selectProbeImages reports a missing kind as null rather than guessing', () => {
    assert.equal(selectProbeImages(fakeBundle({ png: false })).png, null);
    assert.equal(selectProbeImages(fakeBundle({ svg: false })).svg, null);
    assert.deepEqual(selectProbeImages(join(tmpdir(), 'gjsify-no-such-bundle')), { svg: null, png: null });
});

/** A record in the shape a darwin/win32 builder writes when everything worked. */
function goodRecord(overrides = {}) {
    return {
        ok: true,
        platform: 'darwin',
        gtkSource: 'bundle',
        bundleIsProbeTarget: true,
        svg: { file: 'share/icons/Adwaita/a.svg', width: 16, height: 16 },
        png: { file: 'share/icons/Adwaita/a.png', width: 16, height: 16, source: 'bundled' },
        ...overrides,
    };
}

test('an ABSENT record fails — it does not degrade to "unverified"', () => {
    // The shape being avoided: an arch guard that answered GREEN instead of "nobody
    // checked". A bundle built by a builder too old to decode must not publish.
    for (const absent of [undefined, null, 'yes', 42]) {
        const problems = decodeProbeProblems(absent);
        assert.equal(problems.length, 1, `expected exactly one problem for ${JSON.stringify(absent)}`);
        assert.match(problems[0], /no windowingData\.decodeProbe/);
    }
});

test('`ok: true` is not taken on trust — the recorded dimensions decide', () => {
    const zeroed = goodRecord({
        svg: { file: 'share/icons/Adwaita/open-menu-symbolic.svg', width: -1, height: -1 },
    });
    const problems = decodeProbeProblems(zeroed);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /open-menu-symbolic\.svg to -1x-1 — a failed load, not an image/);
});

test('both kinds are required — win32 ships exactly one loader module', () => {
    const svgOnly = goodRecord();
    delete svgOnly.png;
    assert.deepEqual(
        decodeProbeProblems(svgOnly),
        ['decode probe carries no png result'],
        'a bundle that decodes svg and nothing else is not a working icon theme',
    );
    assert.deepEqual(PROBE_KINDS, ['svg', 'png']);
});

test('a record that cannot say WHICH GTK decoded the file fails closed', () => {
    // Same rule as the absent record: a builder that predates the check does not get to
    // publish on the strength of dimensions alone, because the HOST GTK decoding a file
    // that merely sits at the bundle's path produces exactly those dimensions.
    const record = goodRecord();
    delete record.platform;
    assert.equal(decodeProbeProblems(record).length, 1);
    assert.match(decodeProbeProblems(record)[0], /records no platform/);
});

test('a decode the HOST GTK answered is not a passing bundle probe', () => {
    // Reachable without any bug: index.js wraps activateBundledGtkRuntime in a
    // never-fatal try/catch, and the function returns null whenever the policy did not
    // pick the bundle — Homebrew/gvsbuild then decodes the file at the bundle's path.
    for (const platform of ['darwin', 'win32']) {
        const problems = decodeProbeProblems(goodRecord({ platform, gtkSource: 'system' }));
        assert.equal(problems.length, 1, JSON.stringify(problems));
        assert.match(problems[0], new RegExp(`gtkSource=system on ${platform}`));
    }
});

test('a decode through a DIFFERENT bundle than the probed dir fails', () => {
    // resolveGtkRuntimeBundle falls through to prebuilds/, the sibling package and the
    // installed optional dep — all three exist on a builder, so "a bundle was active" is
    // not the same claim as "THIS directory was active".
    const problems = decodeProbeProblems(goodRecord({ bundleIsProbeTarget: false }));
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /activated a DIFFERENT bundle/);
});

test('linux stays permissive — there is no linux bundle by design', () => {
    assert.deepEqual(decodeProbeProblems(goodRecord({ platform: 'linux', gtkSource: 'system' })), []);
});

test('probeChildEnv drops every host-GTK variable, whatever its case', () => {
    // The incident: node-gi.yml exports DYLD_FALLBACK_LIBRARY_PATH=$BREW_PREFIX/lib by
    // hand, which is why the darwin loader defect could not be caught by a test.
    const env = { PATH: '/usr/bin', HOME: '/home/me', GJSIFY_GTK_RUNTIME: '/b/gtk' };
    for (const name of HOST_GTK_ENV) env[name] = '/host';
    env.xdg_data_dirs = '/host-lowercased'; // win32 env names are case-insensitive
    const scrubbed = probeChildEnv(env, { platform: 'linux' });
    for (const name of HOST_GTK_ENV) assert.equal(scrubbed[name], undefined, name);
    assert.equal(scrubbed.xdg_data_dirs, undefined);
    assert.deepEqual({ ...scrubbed }, { PATH: '/usr/bin', HOME: '/home/me', GJSIFY_GTK_RUNTIME: '/b/gtk' });
});

test('probeChildEnv takes the build prefix off PATH — the win32 half of the same hazard', () => {
    // Driven for BOTH platforms from linux: `platform` is a parameter exactly so the
    // win32 branch (';', backslashes, case-insensitive) is executable here.
    const win = probeChildEnv(
        { Path: 'C:\\gtk-build\\gtk\\x64\\release\\bin;C:\\Windows\\system32;C:\\GTK-BUILD\\gtk' },
        { hostPrefixes: ['C:\\gtk-build\\gtk'], platform: 'win32' },
    );
    assert.equal(win.Path, 'C:\\Windows\\system32');

    const mac = probeChildEnv(
        { PATH: '/opt/homebrew/bin:/usr/bin:/opt/homebrew:/opt/homebrew-other/bin' },
        { hostPrefixes: ['/opt/homebrew'], platform: 'darwin' },
    );
    // `/opt/homebrew-other` is NOT under `/opt/homebrew` — a plain startsWith would eat it.
    assert.equal(mac.PATH, '/usr/bin:/opt/homebrew-other/bin');
});

test('the builder half fails CLOSED when the addon cannot be loaded at all', () => {
    // Not a throw and not a silent pass: a RECORD saying it failed, which is what the
    // builder embeds and the gate then rejects. Runs on any host — the addon path is
    // deliberately nonexistent.
    const record = spawnDecodeProbe({ bundleDir: fakeBundle(), addon: join(tmpdir(), 'no-such-node_gi.node') });
    assert.equal(record.ok, false);
    assert.ok(decodeProbeProblems(record).length > 0, 'the gate must reject this record');
});

// The decode itself, on any host that HAS an addon and a GdkPixbuf typelib. There is no
// linux GTK bundle by design (linux uses the system GTK), so this probes the system
// stack: it proves the probe MEASURES a decode, not that any shipped bundle decodes.
const addon = [buildAddonPath('Release'), buildAddonPath('Debug'), prebuildAddonPath()].find((p) => existsSync(p));
const HOST_ICONS = '/usr/share/icons/Adwaita';
const decodable = addon && existsSync(HOST_ICONS);

test('the probe decodes a real svg and a real png and records their pixel sizes', { skip: !decodable }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-probe-real-'));
    mkdirSync(join(dir, 'share', 'icons'), { recursive: true });
    for (const [name, from] of [
        ['probe.svg', join(HOST_ICONS, 'symbolic', 'actions', 'open-menu-symbolic.svg')],
        ['probe.png', join(HOST_ICONS, '16x16', 'devices', 'audio-headphones.png')],
    ]) {
        if (existsSync(from)) copyFileSync(from, join(dir, 'share', 'icons', name));
    }
    const record = spawnDecodeProbe({ bundleDir: dir, addon });
    assert.deepEqual(decodeProbeProblems(record), [], JSON.stringify(record, null, 2));
    for (const kind of PROBE_KINDS) {
        assert.ok(record[kind].width > 0 && record[kind].height > 0, `${kind}: ${JSON.stringify(record[kind])}`);
    }
    // The provenance fields the darwin/win32 gate asserts on. This host has no bundle by
    // design, so the VALUE here is 'system' — what is proven is that the record states
    // which GTK ran, which is the field a bundle platform is then held to.
    assert.equal(record.platform, process.platform);
    assert.equal(record.gtkSource, 'system');
    assert.equal(record.bundleIsProbeTarget, false);
});
