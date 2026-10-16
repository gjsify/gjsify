// SPDX-License-Identifier: MIT
// @gjsify/gi-runtime-android's build decisions, checked without an NDK, an Android
// GObject-Introspection prefix or a NativeScript AAR.
//
// Same arrangement and the same reason as android-link-libs.test.mjs: the bundle build
// needs a cross toolchain and a meson tree nothing in CI has, so no test can reach it by
// running it, and a decision nothing checks is a decision that drifts. The failures
// asserted here are the ones whose only other detector is a device:
//
//   - a soname the closure walk cannot resolve crashes `dlopen` before any JavaScript runs;
//   - a typelib taken from an ABI nothing measured describes the wrong struct layout;
//   - a bundled library with no attribution ships a licence violation in every APK.
//
// Each of those is a thrown error with the name in it, and each has a test below that
// asserts the throw rather than the happy path, because the happy path is what the real
// build prints and the throw is what no run exercises.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    aarEntries,
    parseNeeded,
    planClosure,
    planGiRoots,
    readLicenseCorpus,
    planTypelibs,
    renderAndroidManifest,
    renderNotice,
} from '../../gi-runtime-android/scripts/build-gi-runtime-android.mjs';
import { buildZip, dosDateTime } from '../../scripts/aar-zip.mjs';

const pkgDir = fileURLToPath(new URL('../../gi-runtime-android/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${pkgDir}package.json`, 'utf8'));
const licenseTable = JSON.parse(readFileSync(`${pkgDir}licenses/bundled-projects.json`, 'utf8'));
const declaredDivergence = JSON.parse(readFileSync(`${pkgDir}typelib-abi-divergence.json`, 'utf8'));

/** A GI prefix as the closure walk sees it: DT_NEEDED per soname, `null` outside the prefix. */
function prefix(libraries) {
    return (soname) => (soname in libraries ? libraries[soname] : null);
}

describe('parseNeeded: the DT_NEEDED lines of llvm-readelf -d', () => {
    // Shape taken from a real `llvm-readelf -d libnode_gi.so`, including the entries that
    // must NOT be read as dependencies: SONAME and RUNPATH also carry a bracketed name.
    const output = [
        '',
        'Dynamic section at offset 0x12d000 contains 29 entries:',
        '  Tag                Type                 Name/Value',
        ' 0x0000000000000001 (NEEDED)             Shared library: [libgirepository-2.0.so]',
        ' 0x0000000000000001 (NEEDED)             Shared library: [libgobject-2.0.so]',
        ' 0x0000000000000001 (NEEDED)             Shared library: [libNativeScript.so]',
        ' 0x000000000000000e (SONAME)             Library soname: [libnode_gi.so]',
        ' 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN]',
        ' 0x0000000000000007 (RELA)               0x1234',
        '',
    ].join('\n');

    it('reads the dependencies in link order', () => {
        assert.deepEqual(parseNeeded(output), ['libgirepository-2.0.so', 'libgobject-2.0.so', 'libNativeScript.so']);
    });

    it('does not mistake SONAME or RUNPATH for a dependency', () => {
        const needed = parseNeeded(output);
        assert.ok(!needed.includes('libnode_gi.so'));
        assert.ok(!needed.some((name) => name.includes('ORIGIN')));
    });

    it('answers an empty list for a static or dependency-free object', () => {
        assert.deepEqual(parseNeeded('Dynamic section at offset 0x0 contains 0 entries:\n'), []);
    });
});

describe('planClosure: what the AAR carries is measured, not listed', () => {
    const giPrefix = {
        'libnode_gi.so': ['libgirepository-2.0.so', 'libcairo.so', 'libNativeScript.so', 'liblog.so'],
        'libgirepository-2.0.so': ['libgobject-2.0.so', 'libffi.so', 'libc.so'],
        'libgobject-2.0.so': ['libglib-2.0.so', 'libffi.so'],
        'libglib-2.0.so': ['libz.so', 'libc.so', 'libm.so'],
        'libcairo.so': ['libpixman-1.so', 'libglib-2.0.so'],
        'libpixman-1.so': ['libm.so'],
        'libffi.so': ['libc.so'],
    };

    it('bundles the transitive closure and nothing the root itself is', () => {
        const { bundle } = planClosure({ roots: ['libnode_gi.so'], needed: prefix(giPrefix) });
        assert.deepEqual(bundle, [
            'libcairo.so',
            'libffi.so',
            'libgirepository-2.0.so',
            'libglib-2.0.so',
            'libgobject-2.0.so',
            'libpixman-1.so',
        ]);
    });

    it('reaches a library only a dependency of a dependency names', () => {
        // libpixman-1 is nowhere in libnode_gi.so's own DT_NEEDED — it arrives through
        // cairo. A hand-written list is exactly where this one goes missing.
        const { bundle } = planClosure({ roots: ['libnode_gi.so'], needed: prefix(giPrefix) });
        assert.ok(bundle.includes('libpixman-1.so'));
    });

    it('separates the libraries the process already has, with no duplicate of them bundled', () => {
        const { bundle, system } = planClosure({ roots: ['libnode_gi.so'], needed: prefix(giPrefix) });
        assert.deepEqual(system, ['libNativeScript.so', 'libc.so', 'liblog.so', 'libm.so', 'libz.so']);
        for (const soname of system) assert.ok(!bundle.includes(soname));
    });

    it('FAILS BY NAME on a soname that is neither in the prefix nor known to be provided', () => {
        // The failure this function exists for: the APK would lack a library the loader
        // resolves at startup, and the only other place that shows up is a device.
        const grown = { ...giPrefix, 'libcairo.so': ['libpixman-1.so', 'libselinux.so'] };
        assert.throws(() => planClosure({ roots: ['libnode_gi.so'], needed: prefix(grown) }), /libselinux\.so/);
    });

    it('names every unknown soname at once, so one build tells the whole story', () => {
        const grown = { ...giPrefix, 'libcairo.so': ['libxcb.so', 'libselinux.so'] };
        assert.throws(
            () => planClosure({ roots: ['libnode_gi.so'], needed: prefix(grown) }),
            (error) => {
                assert.match(error.message, /libselinux\.so, libxcb\.so/);
                return true;
            },
        );
    });

    it('refuses a root the prefix does not have, which is a caller bug and not a missing dep', () => {
        assert.throws(
            () => planClosure({ roots: ['libnope.so'], needed: prefix(giPrefix) }),
            /libnope\.so is not readable/,
        );
    });

    it('terminates on a dependency cycle', () => {
        const cyclic = { 'a.so': ['b.so'], 'b.so': ['a.so', 'c.so'], 'c.so': ['b.so'] };
        assert.deepEqual(planClosure({ roots: ['a.so'], needed: prefix(cyclic) }).bundle, ['b.so', 'c.so']);
    });

    // ADR 0117 § 2: a selected namespace's backer is in the prefix and in NOBODY's
    // DT_NEEDED, so the only way into the payload is to start the walk there as well.
    const seeded = {
        ...giPrefix,
        'libgtk-4.so': ['libgraphene-1.0.so', 'libglib-2.0.so', 'liblog.so'],
        'libgraphene-1.0.so': ['libm.so'],
    };

    it('bundles a seed and everything under it, which no root reaches', () => {
        const { bundle } = planClosure({ roots: ['libnode_gi.so'], seeds: ['libgtk-4.so'], needed: prefix(seeded) });
        assert.ok(bundle.includes('libgtk-4.so'));
        assert.ok(bundle.includes('libgraphene-1.0.so'));
    });

    it('leaves the default closure exactly as it was when nothing is seeded', () => {
        const withEmpty = planClosure({ roots: ['libnode_gi.so'], seeds: [], needed: prefix(seeded) });
        const without = planClosure({ roots: ['libnode_gi.so'], needed: prefix(seeded) });
        assert.deepEqual(withEmpty, without);
        assert.ok(!without.bundle.includes('libgtk-4.so'));
    });

    it('keeps a seed that is also a root unbundled, so the addon is not staged twice', () => {
        // Asking for a namespace backed by libnode_gi.so itself must not put a second
        // copy of the addon in the AAR.
        const { bundle } = planClosure({
            roots: ['libnode_gi.so'],
            seeds: ['libnode_gi.so'],
            needed: prefix(giPrefix),
        });
        assert.ok(!bundle.includes('libnode_gi.so'));
    });

    it('still separates system libraries a seed pulls in', () => {
        const { bundle, system } = planClosure({
            roots: ['libnode_gi.so'],
            seeds: ['libgtk-4.so'],
            needed: prefix(seeded),
        });
        assert.ok(system.includes('liblog.so'));
        assert.ok(!bundle.includes('liblog.so'));
    });

    it('refuses a seed the prefix does not have', () => {
        assert.throws(
            () => planClosure({ roots: ['libnode_gi.so'], seeds: ['libnope.so'], needed: prefix(giPrefix) }),
            /libnope\.so is not readable/,
        );
    });
});

describe('planGiRoots: a requested namespace becomes the seeds that back it', () => {
    // Shaped like the pinned Android prefix reads: HarfBuzz backs its typelib with
    // libharfbuzz-gobject.so, which is NOT what Pango or Gtk link against, so selecting
    // Gtk without walking the typelib dependency graph leaves that backer unshipped and
    // `planTypelibSet` blocks the whole set.
    const typelibs = [
        { key: 'GLib-2.0', namespace: 'GLib', sharedLibraries: ['libglib-2.0.so'], dependencies: [] },
        { key: 'GObject-2.0', namespace: 'GObject', sharedLibraries: ['libgobject-2.0.so'], dependencies: ['GLib-2.0'] },
        { key: 'HarfBuzz-0.0', namespace: 'HarfBuzz', sharedLibraries: ['libharfbuzz-gobject.so'], dependencies: ['GObject-2.0'] },
        { key: 'Pango-1.0', namespace: 'Pango', sharedLibraries: ['libpango-1.0.so'], dependencies: ['HarfBuzz-0.0', 'GObject-2.0'] },
        { key: 'Gtk-4.0', namespace: 'Gtk', sharedLibraries: ['libgtk-4.so'], dependencies: ['Pango-1.0', 'HarfBuzz-0.0'] },
        { key: 'GLibUnix-2.0', namespace: 'GLibUnix', sharedLibraries: [], dependencies: ['GLib-2.0'] },
        { key: 'Gdk-4.0', namespace: 'Gdk', sharedLibraries: ['libgtk-4.so'], dependencies: ['cairo-1.0'] },
    ];

    it('seeds the backer the requested namespace names', () => {
        const { seeds } = planGiRoots({ namespaces: ['Pango'], typelibs });
        assert.ok(seeds.includes('libpango-1.0.so'));
    });

    it('seeds the backers of the whole typelib dependency closure', () => {
        // The measured failure: seeding only libgtk-4.so leaves libharfbuzz-gobject.so
        // out, and `planTypelibSet` then reports HarfBuzz-0.0 as blocked.
        const { seeds } = planGiRoots({ namespaces: ['Gtk'], typelibs });
        assert.deepEqual(
            [...seeds].sort(),
            ['libglib-2.0.so', 'libgobject-2.0.so', 'libgtk-4.so', 'libharfbuzz-gobject.so', 'libpango-1.0.so'],
        );
    });

    it('walks a diamond once and terminates', () => {
        // Gtk reaches HarfBuzz both directly and through Pango.
        const { seeds } = planGiRoots({ namespaces: ['Gtk', 'Pango'], typelibs });
        assert.equal(new Set(seeds).size, seeds.length);
    });

    it('accepts a pinned Ns-Version as well as a bare Ns', () => {
        assert.deepEqual(planGiRoots({ namespaces: ['Pango-1.0'], typelibs }).seeds.sort(), [
            'libglib-2.0.so',
            'libgobject-2.0.so',
            'libharfbuzz-gobject.so',
            'libpango-1.0.so',
        ]);
    });

    it('reports which typelib each request resolved to', () => {
        assert.deepEqual(planGiRoots({ namespaces: ['Gtk'], typelibs }).resolved, [
            { requested: 'Gtk', key: 'Gtk-4.0' },
        ]);
    });

    it('contributes nothing for a header-only namespace, which is not an error', () => {
        const { seeds, resolved } = planGiRoots({ namespaces: ['GLibUnix'], typelibs });
        assert.deepEqual(seeds, ['libglib-2.0.so']);
        assert.deepEqual(resolved, [{ requested: 'GLibUnix', key: 'GLibUnix-2.0' }]);
    });

    it('FAILS BY NAME on a namespace the prefix has no typelib for', () => {
        // Soup is the ADR's example: an app imports it, the sysroot does not carry it,
        // and the alternative is an APK that throws on the import at runtime.
        assert.throws(() => planGiRoots({ namespaces: ['Soup'], typelibs }), /no typelib for Soup/);
    });

    it('names every missing namespace at once and lists what is on offer', () => {
        assert.throws(
            () => planGiRoots({ namespaces: ['Soup', 'WebKit'], typelibs }),
            (error) => {
                assert.match(error.message, /Soup, WebKit/);
                assert.match(error.message, /Gtk/);
                return true;
            },
        );
    });

    it('REFUSES a bare namespace the prefix has two versions of, rather than guessing', () => {
        // Picking by sort order here would choose an ABI for the app silently.
        const twoGtk = [...typelibs, { key: 'Gtk-3.0', namespace: 'Gtk', sharedLibraries: ['libgtk-3.so'], dependencies: [] }];
        assert.throws(() => planGiRoots({ namespaces: ['Gtk'], typelibs: twoGtk }), /Gtk-3\.0, Gtk-4\.0/);
    });

    it('skips a dependency with no typelib, leaving planTypelibSet the single judge', () => {
        // Gdk-4.0 depends on cairo-1.0 and this prefix ships no cairo typelib. Refusing
        // here would be a second gate for what `planTypelibSet` already names.
        const { seeds } = planGiRoots({ namespaces: ['Gdk'], typelibs });
        assert.deepEqual(seeds, ['libgtk-4.so']);
    });

    it('asks for nothing when no namespace is declared', () => {
        assert.deepEqual(planGiRoots({ namespaces: [], typelibs }), { seeds: [], resolved: [] });
    });
});

describe('planTypelibs: one assets tree, so every ABI has to agree about it', () => {
    const shared = () => ({
        'GLib-2.0.typelib': Buffer.from('glib'),
        'GObject-2.0.typelib': Buffer.from('gobject'),
        'Gio-2.0.typelib': Buffer.from('gio'),
    });
    const perAbi = (x86Overrides = {}, drop = []) => {
        const x86 = { ...shared(), ...x86Overrides };
        for (const name of drop) delete x86[name];
        return { 'arm64-v8a': new Map(Object.entries(shared())), x86_64: new Map(Object.entries(x86)) };
    };
    const declared = (divergent = [], sourceAbi = 'arm64-v8a') => ({ sourceAbi, divergent });

    it('accepts byte-identical sets and reports no divergence', () => {
        const plan = planTypelibs({ perAbi: perAbi(), declared: declared() });
        assert.equal(plan.sourceAbi, 'arm64-v8a');
        assert.deepEqual(plan.typelibs, ['GLib-2.0.typelib', 'GObject-2.0.typelib', 'Gio-2.0.typelib']);
        assert.deepEqual(plan.divergent, []);
    });

    it('FAILS, with both byte counts, on a divergence nothing declared', () => {
        // The one that cannot be caught later: a shared asset tree describing the wrong
        // layout produces wrong field reads on the other ABI, not an error.
        assert.throws(
            () => planTypelibs({ perAbi: perAbi({ 'Gio-2.0.typelib': Buffer.from('gio-x86') }), declared: declared() }),
            (error) => {
                assert.match(
                    error.message,
                    /Gio-2\.0\.typelib differs between arm64-v8a \(3 bytes\) and x86_64 \(7 bytes\)/,
                );
                assert.match(error.message, /typelib-abi-divergence\.json/);
                return true;
            },
        );
    });

    it('accepts a declared divergence and names it, so the build report says which', () => {
        const plan = planTypelibs({
            perAbi: perAbi({ 'GLib-2.0.typelib': Buffer.from('glib-x86') }),
            declared: declared([{ typelib: 'GLib-2.0.typelib' }]),
        });
        assert.deepEqual(plan.divergent, ['GLib-2.0.typelib']);
    });

    it('refuses a source ABI this run never measured', () => {
        assert.throws(
            () => planTypelibs({ perAbi: perAbi(), declared: declared([], 'armeabi-v7a') }),
            /armeabi-v7a, which is not among/,
        );
    });

    it('refuses a set another ABI is missing part of', () => {
        assert.throws(
            () => planTypelibs({ perAbi: perAbi({}, ['Gio-2.0.typelib']), declared: declared() }),
            /x86_64 is missing Gio-2\.0\.typelib/,
        );
    });

    it('refuses a typelib only the other ABI has, which the asset tree could not carry', () => {
        assert.throws(
            () => planTypelibs({ perAbi: perAbi({ 'Gtk-4.0.typelib': Buffer.from('gtk') }), declared: declared() }),
            /x86_64 has Gtk-4\.0\.typelib, which arm64-v8a does not/,
        );
    });

    it('the committed declaration explains each divergence with a measurement', () => {
        assert.ok(declaredDivergence.sourceAbi.length > 0);
        for (const entry of declaredDivergence.divergent) {
            assert.ok(entry.reason.length > 80, `${entry.typelib} is declared divergent without saying why`);
            assert.ok(entry.measuredBytes[declaredDivergence.sourceAbi] > 0, `${entry.typelib} has no measured size`);
        }
    });
});

describe('renderNotice: nothing ships unattributed', () => {
    const system = ['libc.so', 'libNativeScript.so'];

    it('FAILS BY NAME on a bundled library the table does not attribute', () => {
        assert.throws(
            () =>
                renderNotice({
                    bundled: ['libglib-2.0.so', 'libwhat.so'],
                    system,
                    table: licenseTable,
                    corpus: null,
                    abis: ['arm64-v8a'],
                }),
            /libwhat\.so is in the bundled closure with no entry/,
        );
    });

    it('FAILS on a soname mapped to a project the table does not describe', () => {
        const broken = { ...licenseTable, libraries: { ...licenseTable.libraries, 'libglib-2.0.so': 'ghost' } };
        assert.throws(
            () =>
                renderNotice({ bundled: ['libglib-2.0.so'], system, table: broken, corpus: null, abis: ['arm64-v8a'] }),
            /project "ghost"/,
        );
    });

    it('attributes every library of the real table, grouped by project with its upstream', () => {
        const bundled = Object.keys(licenseTable.libraries);
        const notice = renderNotice({
            bundled,
            system,
            table: licenseTable,
            corpus: null,
            abis: ['arm64-v8a', 'x86_64'],
        });
        for (const soname of bundled) assert.ok(notice.includes(`\`${soname}\``), `${soname} is not in the notice`);
        for (const project of Object.values(licenseTable.projects)) {
            assert.ok(notice.includes(`### ${project.name}`), `${project.name} has no section`);
            assert.ok(notice.includes(project.upstream), `${project.name} has no upstream`);
        }
    });

    it('says the texts are not embedded instead of claiming terms it cannot read', () => {
        const notice = renderNotice({
            bundled: ['libglib-2.0.so'],
            system,
            table: licenseTable,
            corpus: null,
            abis: ['arm64-v8a'],
        });
        assert.match(notice, /NOT EMBEDDED/);
        assert.ok(
            !/SPDX-License-Identifier: (MIT|LGPL)/.test(notice),
            'the notice states an SPDX expression it did not read off the prefix',
        );
    });

    it('lists what is deliberately NOT bundled, with who supplies it', () => {
        const notice = renderNotice({
            bundled: ['libglib-2.0.so'],
            system,
            table: licenseTable,
            corpus: null,
            abis: ['arm64-v8a'],
        });
        assert.match(notice, /- `libNativeScript\.so` — the NativeScript runtime AAR/);
        assert.match(notice, /- `libc\.so` — Bionic/);
    });

    it('embeds the text when a corpus supplies one, and drops the disclaimer', () => {
        const corpus = new Map([['glib', [{ name: 'COPYING', body: 'GNU LESSER GENERAL PUBLIC LICENSE\n' }]]]);
        const notice = renderNotice({
            bundled: ['libglib-2.0.so'],
            system,
            table: licenseTable,
            corpus,
            abis: ['arm64-v8a'],
        });
        assert.match(notice, /<summary>COPYING<\/summary>/);
        assert.match(notice, /GNU LESSER GENERAL PUBLIC LICENSE/);
        assert.ok(!notice.includes('NOT EMBEDDED'));
    });
});

describe('renderAndroidManifest: the one XML an AAR must have', () => {
    const xml = renderAndroidManifest({ packageName: 'studio.artandcode.gjsify.gi_runtime', minSdk: 24 });

    it('declares the package name and the SDK floor AGP reads', () => {
        assert.match(xml, /package="studio\.artandcode\.gjsify\.gi_runtime"/);
        assert.match(xml, /android:minSdkVersion="24"/);
    });

    it('declares nothing else — no permission, no component, nothing exported', () => {
        assert.ok(!/uses-permission|<activity|<service|<receiver|<provider|android:exported/.test(xml));
    });
});

/** The DOS epoch, which every entry is stamped with so the AAR is byte-reproducible. */
const MTIME = 315532800;

const samplePayload = {
    'arm64-v8a': { nodeGi: Buffer.from('addon-arm64'), libs: new Map([['libglib-2.0.so', Buffer.from('glib-arm64')]]) },
    x86_64: { nodeGi: Buffer.from('addon-x86_64'), libs: new Map([['libglib-2.0.so', Buffer.from('glib-x86_64')]]) },
};
const sampleTypelibs = new Map([['GLib-2.0.typelib', Buffer.from('typelib-bytes')]]);

describe('aarEntries: the archive layout AGP and NativeScript key on', () => {
    const entries = aarEntries({ perAbi: samplePayload, typelibs: sampleTypelibs, mtime: MTIME });

    it('lays the payload out where AGP merges it from', () => {
        assert.deepEqual(entries.map((entry) => entry.path).sort(), [
            'AndroidManifest.xml',
            'assets/app/girepository-1.0/GLib-2.0.typelib',
            'classes.jar',
            'jni/arm64-v8a/libglib-2.0.so',
            'jni/arm64-v8a/libnode_gi.so',
            'jni/x86_64/libglib-2.0.so',
            'jni/x86_64/libnode_gi.so',
        ]);
    });

    it('keeps the two ABIs apart, so a universal APK and abiFilters both work', () => {
        const arm = entries.find((entry) => entry.path === 'jni/arm64-v8a/libnode_gi.so');
        const x86 = entries.find((entry) => entry.path === 'jni/x86_64/libnode_gi.so');
        assert.equal(arm.data.toString(), 'addon-arm64');
        assert.equal(x86.data.toString(), 'addon-x86_64');
    });

    it('carries an empty but well-formed classes.jar, which AGP requires to exist', () => {
        const jar = entries.find((entry) => entry.path === 'classes.jar').data;
        assert.equal(jar.length, 22, 'an empty ZIP is the EOCD alone');
        assert.equal(jar.readUInt32LE(0), 0x06054b50);
        assert.equal(jar.readUInt16LE(10), 0, 'and it has no entries');
    });

    it('marks the shared libraries executable and leaves the assets alone', () => {
        for (const entry of entries) {
            const expected = entry.path.endsWith('.so') ? 0o755 : undefined;
            assert.equal(entry.mode, expected, entry.path);
        }
    });

    it('puts the typelibs exactly where host.nativescript.js looks without configuration', () => {
        // NativeScript extracts the APK's `assets/app/**` to `<appDir>/app/**`, so the asset
        // path minus its `assets/` prefix IS the device path — and that is the loader's own
        // default for __NODE_GI_TYPELIB_PATH. The two agreeing is why an app installing this
        // plugin sets no globals at all, and nothing but this test holds them together.
        const host = readFileSync(new URL('../host.nativescript.js', import.meta.url), 'utf8');
        assert.ok(
            host.includes('/app/girepository-1.0'),
            'the loader default moved; the AAR asset dir must move with it',
        );
        const typelib = entries.find((entry) => entry.path.endsWith('.typelib'));
        assert.equal(typelib.path, 'assets/app/girepository-1.0/GLib-2.0.typelib');
    });
});

/**
 * The central directory, read back without the writer's help.
 *
 * A round trip through `buildZip`'s own structures would prove only that it is
 * self-consistent. This walks the EOCD and the central directory by offset, the way AGP's
 * reader does, so a field written into the wrong place fails here instead of in gradle.
 */
function readCentralDirectory(zip) {
    const eocdAt = zip.length - 22;
    assert.equal(
        zip.readUInt32LE(eocdAt),
        0x06054b50,
        'the EOCD is not at a fixed offset, so an archive comment crept in',
    );
    const count = zip.readUInt16LE(eocdAt + 10);
    const size = zip.readUInt32LE(eocdAt + 12);
    const start = zip.readUInt32LE(eocdAt + 16);
    assert.equal(start + size, eocdAt, 'the central directory offset and size do not meet the EOCD');

    const out = [];
    let at = start;
    for (let index = 0; index < count; index += 1) {
        assert.equal(zip.readUInt32LE(at), 0x02014b50, `central header ${index}`);
        const nameLength = zip.readUInt16LE(at + 28);
        const record = {
            madeBy: zip.readUInt16LE(at + 4),
            method: zip.readUInt16LE(at + 10),
            time: zip.readUInt16LE(at + 12),
            date: zip.readUInt16LE(at + 14),
            crc: zip.readUInt32LE(at + 16),
            compressed: zip.readUInt32LE(at + 20),
            uncompressed: zip.readUInt32LE(at + 24),
            external: zip.readUInt32LE(at + 38),
            localAt: zip.readUInt32LE(at + 42),
            path: zip.toString('utf8', at + 46, at + 46 + nameLength),
        };
        // The bytes, found through the local header the central directory points at.
        assert.equal(zip.readUInt32LE(record.localAt), 0x04034b50, `local header of ${record.path}`);
        const localNameLength = zip.readUInt16LE(record.localAt + 26);
        const localExtraLength = zip.readUInt16LE(record.localAt + 28);
        const dataAt = record.localAt + 30 + localNameLength + localExtraLength;
        assert.equal(zip.toString('utf8', record.localAt + 30, record.localAt + 30 + localNameLength), record.path);
        record.data = zip.subarray(dataAt, dataAt + record.compressed);
        out.push(record);
        at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    return out;
}

describe('aar-zip: the archive a reader that is not this writer sees', () => {
    const entries = aarEntries({ perAbi: samplePayload, typelibs: sampleTypelibs, mtime: MTIME });
    const zip = buildZip(entries, MTIME);
    const records = readCentralDirectory(zip);

    it('holds every entry, with its bytes reachable through the local header', () => {
        assert.equal(records.length, entries.length);
        for (const entry of entries) {
            const record = records.find((candidate) => candidate.path === entry.path);
            assert.ok(record !== undefined, `${entry.path} is not in the central directory`);
            assert.deepEqual(Buffer.from(record.data), Buffer.from(entry.data), entry.path);
        }
    });

    it('stores rather than deflates, so AGP can page a .so straight out of the APK', () => {
        for (const record of records) {
            assert.equal(record.method, 0, record.path);
            assert.equal(record.compressed, record.uncompressed, record.path);
        }
    });

    it('reports POSIX modes a reader will actually interpret', () => {
        // The bug this caught: without S_IFREG in the high bits every entry read back as
        // `?rw-r--r--`, mode written or not, because unzip only trusts the field when the
        // file-type bits are set.
        for (const record of records) {
            assert.equal(record.madeBy >> 8, 3, 'the high byte must say Unix or the mode is not read at all');
            assert.equal((record.external >>> 16) & 0o170000, 0o100000, `${record.path} has no S_IFREG`);
            const expected = record.path.endsWith('.so') ? 0o755 : 0o644;
            assert.equal((record.external >>> 16) & 0o7777, expected, record.path);
        }
    });

    it('stamps one date on everything and sorts the names, so the bytes are reproducible', () => {
        assert.deepEqual([...new Set(records.map((record) => `${record.date}:${record.time}`))], ['33:0']);
        const paths = records.map((record) => record.path);
        assert.deepEqual(paths, paths.toSorted());
        assert.deepEqual(buildZip([...entries].reverse(), MTIME), zip, 'input order changed the archive');
    });

    it('refuses a timestamp the format cannot represent instead of wrapping it', () => {
        assert.deepEqual(dosDateTime(MTIME), { date: 33, time: 0 });
        assert.throws(() => dosDateTime(0), /predates the DOS epoch/);
    });
});

describe('the package itself: what npm installs and what a checkout keeps', () => {
    it('declares the notice the licence field points at, and ships the directory holding it', () => {
        // `bundled-license` in manifest-conformance enforces the pair; this is the local
        // half, so the package fails here too rather than only in a repo-wide audit.
        assert.equal(manifest.license, 'SEE LICENSE IN platforms/THIRD-PARTY-NOTICES.md');
        assert.ok(manifest.files.includes('platforms'));
    });

    it('is a NativeScript-only package, and claims no gjsify.platforms', () => {
        // It ships an AAR, not a `prebuilds/<target>/node_gi.node`, so `android-*` in
        // `gjsify.platforms` would promise a loadable artifact the conformance rules then
        // look for. `runtimes.nativescript: native` plus nativescriptPlatforms says what is
        // true instead.
        assert.equal(manifest.gjsify.runtimes.nativescript, 'native');
        assert.deepEqual(manifest.gjsify.nativescriptPlatforms, ['android']);
        assert.equal(manifest.gjsify.platforms, undefined);
        for (const runtime of ['gjs', 'node', 'browser']) assert.equal(manifest.gjsify.runtimes[runtime], 'none');
    });

    it('carries the `nativescript` key, without which the CLI never calls it a plugin', () => {
        // The NS CLI writes `platforms/android/dependencies.json` from the dependencies whose
        // manifest has this key, and the generated gradle scans THAT list for `platforms/android`
        // AARs. Drop the key and everything else still works — npm installs the package, the
        // import resolves, `isPresent` is true — while the APK gets no payload at all and the
        // device reports a dlopen failure that reads like a node-gi bug. So it is asserted here,
        // where the cause is one line away from the symptom.
        assert.equal(typeof manifest.nativescript?.platforms?.android, 'string');
        assert.equal(manifest.nativescript.platforms.ios, undefined, 'the payload is Android-only');
    });

    it('node-gi never depends on it — resolved by name, like the GTK bundle (ADR 0023)', () => {
        // @gjsify/node-gi is tier 2 and has to stay installable with zero Android bytes:
        // npm has no per-platform file filtering, so a dependency here would put a 33 MB
        // AAR into every Node install of node-gi.
        const nodeGi = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
            assert.equal(nodeGi[field]?.[manifest.name], undefined, `${field} names ${manifest.name}`);
        }
    });

    it('keeps the gradle guard in the checkout while ignoring the payload beside it', () => {
        // The guard is only useful when the payload is missing, which is exactly when a
        // blanket `platforms/*` would have dropped it from the checkout too.
        const ignore = readFileSync(`${pkgDir}.gitignore`, 'utf8');
        assert.match(ignore, /^platforms\/\*$/m);
        assert.match(ignore, /^!platforms\/android\/include\.gradle$/m);
        const gradle = readFileSync(`${pkgDir}platforms/android/include.gradle`, 'utf8');
        assert.match(gradle, /gi-runtime-android\.aar/);
        assert.match(gradle, /throw new GradleException/);
        assert.match(gradle, /build-gi-runtime-android\.mjs/);
    });

    it('the host-side view agrees with the archive the build writes', () => {
        // Two files name the asset directory: the builder, which puts the typelibs there,
        // and index.js, which tells a harness where they land. They are the same string or
        // a device harness looks in the wrong place.
        const entries = aarEntries({ perAbi: samplePayload, typelibs: sampleTypelibs, mtime: MTIME });
        const index = readFileSync(`${pkgDir}index.js`, 'utf8');
        const assetDir = entries.find((entry) => entry.path.endsWith('.typelib')).path.replace(/\/[^/]+$/, '');
        assert.ok(
            index.includes(`export const typelibAssetDir = '${assetDir}';`),
            `index.js does not name ${assetDir}`,
        );
        assert.ok(index.includes(`export const deviceTypelibSubdir = '${assetDir.replace('assets/', '')}';`));
    });
});

describe('readLicenseCorpus: a licence file is read or the build stops', () => {
    function corpus(setup) {
        const root = mkdtempSync(join(tmpdir(), 'licorpus-'));
        mkdirSync(join(root, 'glib'));
        setup(root);
        return root;
    }

    it('follows a symlink that resolves inside the tree', () => {
        const root = corpus((r) => {
            writeFileSync(join(r, 'glib', 'LGPL.txt'), 'real text');
            symlinkSync('LGPL.txt', join(r, 'glib', 'COPYING'));
        });
        try {
            const texts = readLicenseCorpus(root).get('glib');
            assert.deepEqual(
                texts.map((t) => [t.name, t.body]),
                [
                    ['COPYING', 'real text'],
                    ['LGPL.txt', 'real text'],
                ],
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('throws naming a dangling symlink and its target instead of dropping it', () => {
        const root = corpus((r) => {
            writeFileSync(join(r, 'glib', 'OTHER'), 'x');
            symlinkSync('/nonexistent/build-host/LGPL.txt', join(r, 'glib', 'COPYING'));
        });
        try {
            assert.throws(
                () => readLicenseCorpus(root),
                (e) => /glib\/COPYING is a dangling symlink -> \/nonexistent\/build-host\/LGPL\.txt/.test(e.message),
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
