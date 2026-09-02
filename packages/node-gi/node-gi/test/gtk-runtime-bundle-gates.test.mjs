// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the two build-time gates for the batteries-included GTK runtime
// bundles: does every typelib the bundle ships have its backing library IN the
// bundle, and do the third-party terms travel with the binaries?
//
// WHY THESE ARE UNIT-TESTED HERE AND NOT ONLY IN CI. The gates live in the two
// bundle builders, which only ever run on a macOS or Windows runner — so their logic
// is exercised on no machine a developer has, and a bug in them would surface as
// either a red release leg or (worse) a green one that shipped the defect they exist
// to stop. Everything in packages/node-gi/scripts/{typelib-backers,bundle-licenses}.mjs
// is deliberately pure and platform-agnostic for exactly this reason: it is driven
// here from a SYNTHESISED typelib (so the header offsets are pinned by an assertion,
// not by a comment) and, when the host has a GI stack, from that host's real typelib
// corpus.
//
// THE DEFECT UNDER TEST, measured on the PUBLISHED 0.27.1 tarballs: the darwin
// bundles ship Adw-1.typelib with no libadwaita dylib and the win32 bundle ships
// GtkSource-5.typelib with no gtksourceview DLL, so `new Adw.Application()` fails
// with "Failed to load shared library" on a bundle that advertises the class; and
// `Pango-1.0` DEPENDS on `HarfBuzz-0.0`, which is why simply dropping every unbacked
// typelib is NOT the fix — that would break Pango, and with it Gdk/Gsk/Gtk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    REQUIRED_NAMESPACES,
    WINDOWING_REQUIRED_NAMESPACES,
    analyzeTypelibs,
    nativeLibraryIndex,
    planTypelibSet,
    readTypelibDir,
    readTypelibMetadata,
    verifyBundleTypelibs,
} from '../../scripts/typelib-backers.mjs';
import {
    WINDOWING_DATA_SETS,
    copyTreeDereferenced,
    duplicatedModuleLeaves,
    findSymlinks,
    formatDuplicatedModuleProblems,
    formatSymlinkProblems,
    formatWindowingDataProblems,
    verifyWindowingData,
} from '../../scripts/bundle-data.mjs';
import {
    WIN32_LICENSE_FAMILIES,
    assertLicenseCoverage,
    describeBrewKegs,
    formatLicenseProblems,
    licenseFamilyFor,
    parseBrewLicenseStanza,
    renderThirdPartyNotice,
    scanLicenseFiles,
    upstreamLicenseComponents,
} from '../../scripts/bundle-licenses.mjs';
import {
    GL_IMPLEMENTATION_PATTERNS,
    describeGlImplementation,
    formatMissingGlImplementation,
} from '../../scripts/gl-implementation.mjs';

// --- a synthetic typelib ----------------------------------------------------
// girepository's Header, built by hand so the parser is tested against the FORMAT
// rather than against whatever the host happens to have installed. Field order and
// offsets mirror gitypelib-internal.h; strings are appended past the header and
// referenced by absolute offset, which is how a real typelib stores them.
const MAGIC = Buffer.from('GOBJ\nMETADATA\r\n\u001a', 'latin1');

function synthesizeTypelib({ namespace, version, sharedLibrary, dependencies }) {
    const header = Buffer.alloc(64);
    MAGIC.copy(header, 0);
    header.writeUInt8(4, 16); // major_version
    header.writeUInt8(0, 17); // minor_version
    const strings = [];
    let cursor = header.length;
    const put = (value) => {
        if (value === null || value === undefined) return 0;
        const buf = Buffer.from(`${value}\0`, 'utf8');
        strings.push(buf);
        const at = cursor;
        cursor += buf.length;
        return at;
    };
    // Written in field order so the offsets stay readable.
    const depOffset = put(dependencies);
    const nsOffset = put(namespace);
    const verOffset = put(version);
    const libOffset = put(sharedLibrary);
    header.writeUInt32LE(depOffset, 36);
    header.writeUInt32LE(nsOffset, 44);
    header.writeUInt32LE(verOffset, 48);
    header.writeUInt32LE(libOffset, 52);
    return Buffer.concat([header, ...strings]);
}

function fixtureDir(...subdirs) {
    const root = mkdtempSync(join(tmpdir(), 'gtk-runtime-gates-'));
    for (const sub of subdirs) mkdirSync(join(root, sub), { recursive: true });
    return root;
}

test('the typelib header parse reads namespace, version, backers and dependencies', () => {
    const dir = fixtureDir();
    const file = join(dir, 'Adw-1.typelib');
    writeFileSync(
        file,
        synthesizeTypelib({
            namespace: 'Adw',
            version: '1',
            sharedLibrary: 'libadwaita-1.0.dylib',
            dependencies: 'Gtk-4.0|Gio-2.0',
        }),
    );
    const meta = readTypelibMetadata(file);
    assert.equal(meta.namespace, 'Adw');
    assert.equal(meta.version, '1');
    assert.equal(meta.key, 'Adw-1');
    assert.deepEqual(meta.sharedLibraries, ['libadwaita-1.0.dylib']);
    assert.deepEqual(meta.dependencies, ['Gtk-4.0', 'Gio-2.0']);
});

test('a comma-separated shared_library yields EVERY backer, not just the first', () => {
    // GLib-2.0 really does name two (libgobject + libglib): GI dlopens each, so a
    // check that stopped at the first would pass a bundle missing the second.
    const dir = fixtureDir();
    const file = join(dir, 'GLib-2.0.typelib');
    writeFileSync(
        file,
        synthesizeTypelib({
            namespace: 'GLib',
            version: '2.0',
            sharedLibrary: 'libgobject-2.0.0.dylib,libglib-2.0.0.dylib',
            dependencies: null,
        }),
    );
    const meta = readTypelibMetadata(file);
    assert.deepEqual(meta.sharedLibraries, ['libgobject-2.0.0.dylib', 'libglib-2.0.0.dylib']);

    const analysis = analyzeTypelibs({
        typelibs: [meta],
        libraries: new Set(['libgobject-2.0.0.dylib']), // second one absent
        caseInsensitive: false,
    });
    assert.equal(analysis.backed.length, 0);
    assert.deepEqual(analysis.unbacked[0].missing, ['libglib-2.0.0.dylib']);
});

test('an absent shared_library means header-only, and a MIS-PARSE throws instead', () => {
    const dir = fixtureDir();
    const headerOnly = join(dir, 'xlib-2.0.typelib');
    writeFileSync(headerOnly, synthesizeTypelib({ namespace: 'xlib', version: '2.0', sharedLibrary: null }));
    assert.deepEqual(readTypelibMetadata(headerOnly).sharedLibraries, []);

    // The failure that MUST NOT be silent: something unreadable looking like "no
    // backing library needed" would make the whole gate pass vacuously.
    const junk = join(dir, 'Bogus-1.0.typelib');
    writeFileSync(junk, Buffer.alloc(128, 7));
    assert.throws(() => readTypelibMetadata(junk), /not a GObject-Introspection typelib/);

    const wrongOffsets = Buffer.from(synthesizeTypelib({ namespace: 'Ok', version: '1.0', sharedLibrary: null }));
    wrongOffsets.writeUInt32LE(9999, 44); // namespace offset past EOF
    const broken = join(dir, 'Broken-1.0.typelib');
    writeFileSync(broken, wrongOffsets);
    assert.throws(() => readTypelibMetadata(broken), /refusing to guess/);
});

test('planTypelibSet drops an unbacked typelib nothing needs', () => {
    const typelibs = [
        {
            key: 'Gtk-4.0',
            namespace: 'Gtk',
            version: '4.0',
            name: 'Gtk-4.0.typelib',
            file: 'Gtk-4.0.typelib',
            sharedLibraries: ['libgtk-4.1.dylib'],
            dependencies: [],
        },
        {
            key: 'Adw-1',
            namespace: 'Adw',
            version: '1',
            name: 'Adw-1.typelib',
            file: 'Adw-1.typelib',
            sharedLibraries: ['libadwaita-1.0.dylib'],
            dependencies: ['Gtk-4.0'],
        },
    ];
    const plan = planTypelibSet({
        typelibs,
        libraries: new Set(['libgtk-4.1.dylib']),
        caseInsensitive: false,
    });
    assert.deepEqual(
        plan.copy.map((t) => t.key),
        ['Gtk-4.0'],
    );
    assert.deepEqual(
        plan.dropped.map((t) => t.key),
        ['Adw-1'],
    );
    assert.deepEqual(plan.problems, []);
});

test('planTypelibSet REFUSES to drop an unbacked typelib a kept one depends on', () => {
    // The measured shape: Pango-1.0 depends on HarfBuzz-0.0, whose backer
    // (libharfbuzz-gobject) was not in the darwin closure. Dropping HarfBuzz would
    // break gi_repository_require('Pango'), so this must fail the build and name the
    // missing library — the repair is a seed pattern, not a drop.
    const typelibs = [
        {
            key: 'Pango-1.0',
            namespace: 'Pango',
            version: '1.0',
            name: 'Pango-1.0.typelib',
            file: 'Pango-1.0.typelib',
            sharedLibraries: ['libpango-1.0.0.dylib'],
            dependencies: ['HarfBuzz-0.0'],
        },
        {
            key: 'HarfBuzz-0.0',
            namespace: 'HarfBuzz',
            version: '0.0',
            name: 'HarfBuzz-0.0.typelib',
            file: 'HarfBuzz-0.0.typelib',
            sharedLibraries: ['libharfbuzz-gobject.0.dylib'],
            dependencies: [],
        },
    ];
    const plan = planTypelibSet({
        typelibs,
        libraries: new Set(['libpango-1.0.0.dylib']),
        caseInsensitive: false,
    });
    assert.deepEqual(
        plan.blocked.map((t) => t.key),
        ['HarfBuzz-0.0'],
    );
    assert.equal(plan.dropped.length, 0);
    assert.match(plan.problems.join('\n'), /HarfBuzz-0\.0.*CANNOT be dropped.*Pango-1\.0/s);
});

test('the required-namespace floor fails a bundle the filter emptied out', () => {
    // Without this, a build whose GTK seeds all failed to match would drop every
    // typelib, find no violations, and ship an empty bundle green.
    const plan = planTypelibSet({
        typelibs: [
            {
                key: 'Gtk-4.0',
                namespace: 'Gtk',
                version: '4.0',
                name: 'Gtk-4.0.typelib',
                file: 'x',
                sharedLibraries: ['libgtk-4.1.dylib'],
                dependencies: [],
            },
        ],
        libraries: new Set(),
        caseInsensitive: false,
        requiredNamespaces: ['Gtk'],
    });
    assert.match(plan.problems.join('\n'), /required namespace Gtk is not shippable/);
});

test('verifyBundleTypelibs reads BOTH sets back off disk and refuses an empty one', () => {
    const dir = fixtureDir('girepository-1.0', 'lib');
    const typelibDir = join(dir, 'girepository-1.0');
    const libDir = join(dir, 'lib');
    writeFileSync(
        join(typelibDir, 'Gtk-4.0.typelib'),
        synthesizeTypelib({ namespace: 'Gtk', version: '4.0', sharedLibrary: 'libgtk-4.1.dylib' }),
    );
    // Backer absent → a problem naming the pair.
    let result = verifyBundleTypelibs({ typelibDir, nativeDir: libDir, caseInsensitive: false });
    assert.match(result.problems.join('\n'), /Gtk-4\.0\.typelib.*MISSING libgtk-4\.1\.dylib/);

    writeFileSync(join(libDir, 'libgtk-4.1.dylib'), 'not really a dylib');
    result = verifyBundleTypelibs({ typelibDir, nativeDir: libDir, caseInsensitive: false });
    assert.deepEqual(result.problems, []);
    assert.equal(result.backed.length, 1);

    // A bundle with no typelibs at all must NOT pass by having nothing to complain
    // about — the positive fact is "something was verified".
    const empty = fixtureDir('girepository-1.0', 'lib');
    const vacuous = verifyBundleTypelibs({
        typelibDir: join(empty, 'girepository-1.0'),
        nativeDir: join(empty, 'lib'),
        caseInsensitive: false,
    });
    assert.match(vacuous.problems.join('\n'), /nothing was actually verified/);
});

test('windows DLL matching is case-insensitive, darwin leaf matching is not', () => {
    const typelib = {
        key: 'Adw-1',
        namespace: 'Adw',
        version: '1',
        name: 'Adw-1.typelib',
        file: 'x',
        sharedLibraries: ['Adwaita-1-0.dll'],
        dependencies: [],
    };
    const win = analyzeTypelibs({
        typelibs: [typelib],
        libraries: nativeLibraryIndexOf(['adwaita-1-0.dll'], true),
        caseInsensitive: true,
    });
    assert.equal(win.backed.length, 1, 'LoadLibrary does not care about case');
    const mac = analyzeTypelibs({
        typelibs: [typelib],
        libraries: nativeLibraryIndexOf(['adwaita-1-0.dll'], false),
        caseInsensitive: false,
    });
    assert.equal(mac.unbacked.length, 1, 'a bare-leaf g_module_open through dyld does');
});

test("the host's own typelib corpus parses, and its GTK stack is self-consistent", (t) => {
    // Not a fixture: the real thing. Every typelib on the box must parse (the header
    // offsets are then pinned by ~200 real files, not by one synthetic), and the
    // system GI stack must satisfy the same symmetry rule the bundles are held to —
    // if it did not, the rule itself would be wrong.
    const dirs = [
        '/usr/lib64/girepository-1.0',
        '/usr/lib/x86_64-linux-gnu/girepository-1.0',
        '/usr/lib/girepository-1.0',
    ];
    const dir = dirs.find((d) => existsSync(d));
    if (!dir) return t.skip('no system girepository-1.0 directory on this host');
    const typelibs = readTypelibDir(dir);
    assert.ok(typelibs.length > 0, `${dir} holds no typelibs`);
    for (const meta of typelibs) {
        assert.match(meta.key, /^[A-Za-z_][\w+-]*-\d+(\.\d+)*$/, `${meta.name} parsed as ${meta.key}`);
        // The file name encodes the same namespace-version the header carries; a
        // parser reading the wrong offsets would disagree here on nearly every file.
        assert.equal(`${meta.key}.typelib`, meta.name);
    }
    const libDirs = ['/usr/lib64', '/usr/lib/x86_64-linux-gnu', '/usr/lib'].filter((d) => existsSync(d));
    const libraries = new Set(libDirs.flatMap((d) => readdirSync(d)));
    const gtkStack = typelibs.filter((meta) => REQUIRED_NAMESPACES.includes(meta.namespace));
    if (gtkStack.length === 0) return t.skip('no GTK stack installed on this host');
    const analysis = analyzeTypelibs({ typelibs: gtkStack, libraries, caseInsensitive: false });
    assert.deepEqual(
        analysis.unbacked.map((meta) => `${meta.key} -> ${meta.missing.join(',')}`),
        [],
        'a system GI stack must satisfy the same typelib/library symmetry the bundles are gated on',
    );
});

test('WINDOWING_REQUIRED_NAMESPACES names what --windowing exists to add', () => {
    // Guards the floor itself: if this list were emptied, the --windowing bundles
    // could silently ship without Adwaita and every gate would still be green.
    //
    // `Gst` + `GstApp` joined it when the bundles started shipping GStreamer, and
    // BOTH are named because the failure modes differ: no `Gst` is no audio at all,
    // while no `GstApp` is a perfectly loaded Gst whose `appsrc.push_buffer(…)` is
    // not a function — the decode pipeline dying at its first sample.
    assert.deepEqual(WINDOWING_REQUIRED_NAMESPACES, ['Adw', 'GtkSource', 'Gst', 'GstApp']);
    for (const ns of ['GLib', 'GObject', 'Gio', 'Gtk', 'Gdk', 'Pango', 'GdkPixbuf', 'Graphene', 'cairo']) {
        assert.ok(REQUIRED_NAMESPACES.includes(ns), `${ns} is part of the bundle's promise`);
    }
});

// --- licenses ---------------------------------------------------------------

test('the Homebrew license stanza is read from the keg, incl. multi-line forms', () => {
    assert.equal(parseBrewLicenseStanza('  license "LGPL-2.1-or-later"\n'), '"LGPL-2.1-or-later"');
    assert.equal(
        parseBrewLicenseStanza(
            'class Foo\n  license all_of: [\n    "MIT",\n    "LGPL-2.1-only",\n  ]\n  depends_on "x"\n',
        ),
        'all_of: [ "MIT", "LGPL-2.1-only", ]',
    );
    assert.equal(parseBrewLicenseStanza('  desc "x"\n  homepage "y"\n'), null);
});

test('every bundled dylib is attributed to the keg it came from, or the build fails', () => {
    const files = new Map([
        ['libgtk-4.1.dylib', '/opt/homebrew/Cellar/gtk4/4.22.4/lib/libgtk-4.1.dylib'],
        ['libglib-2.0.0.dylib', '/opt/homebrew/Cellar/glib/2.88.1/lib/libglib-2.0.0.dylib'],
        ['libgobject-2.0.0.dylib', '/opt/homebrew/Cellar/glib/2.88.1/lib/libgobject-2.0.0.dylib'],
    ]);
    const { components, unattributed } = describeBrewKegs({ files, fallbackLicense: () => 'LGPL-2.1-or-later' });
    assert.deepEqual(unattributed, []);
    assert.deepEqual(
        components.map((c) => `${c.name}@${c.version}`),
        ['glib@2.88.1', 'gtk4@4.22.4'],
    );
    assert.deepEqual(components.find((c) => c.name === 'glib').binaries, [
        'libglib-2.0.0.dylib',
        'libgobject-2.0.0.dylib',
    ]);
    assert.deepEqual(
        assertLicenseCoverage({
            components,
            binaries: [...files.keys()],
            unattributed,
            attribution: 'per-binary',
            textCount: 3,
        }),
        [],
    );

    // A side-loaded library outside any keg has no derivable terms — that must stop
    // the build rather than ship an unattributed binary.
    files.set('libsideloaded.dylib', '/usr/local/lib/libsideloaded.dylib');
    const second = describeBrewKegs({ files, fallbackLicense: () => 'MIT' });
    assert.equal(second.unattributed.length, 1);
    const problems = assertLicenseCoverage({
        components: second.components,
        binaries: [...files.keys()],
        unattributed: second.unattributed,
        attribution: 'per-binary',
        textCount: 3,
    });
    assert.match(problems.join('\n'), /libsideloaded\.dylib cannot be attributed/);
});

test('zero recovered license texts is a failure, not a quiet omission', () => {
    // The published 0.27.1 state: 37-45 relocated LGPL binaries, no license file of
    // any kind in the tarball.
    const problems = assertLicenseCoverage({
        components: [
            {
                name: 'glib',
                version: '2.88.1',
                license: 'LGPL-2.1-or-later',
                binaries: ['libglib-2.0.0.dylib'],
                texts: [],
            },
        ],
        binaries: ['libglib-2.0.0.dylib'],
        attribution: 'per-binary',
        textCount: 0,
    });
    assert.match(problems.join('\n'), /not one license text was recovered/);
});

test('scanLicenseFiles finds terms at COPYING depth and ignores a doc tree', () => {
    const root = fixtureDir(
        'share/doc/cairo',
        'share/doc/tiff/manual/html/project',
        'share/licenses/adwaita-icon-theme',
    );
    writeFileSync(join(root, 'share', 'doc', 'cairo', 'COPYING'), 'cairo terms');
    writeFileSync(join(root, 'share', 'doc', 'cairo', 'README'), 'not a license');
    writeFileSync(join(root, 'share', 'doc', 'tiff', 'manual', 'html', 'project', 'license.html'), '<html>');
    writeFileSync(join(root, 'share', 'licenses', 'adwaita-icon-theme', 'COPYING_LGPL'), 'lgpl');
    const found = scanLicenseFiles({ root, subdirs: ['share/licenses', 'share/doc'], maxDepth: 2 });
    assert.deepEqual(
        found.map((f) => f.relative),
        ['share/doc/cairo/COPYING', 'share/licenses/adwaita-icon-theme/COPYING_LGPL'],
    );
    assert.deepEqual(
        found.map((f) => f.component),
        ['cairo', 'adwaita-icon-theme'],
    );
});

test('the notice states the modifications and names every bundled binary', () => {
    const notice = renderThirdPartyNotice({
        target: 'darwin-arm64',
        builder: 'packages/node-gi/scripts/build-gtk-runtime-darwin.mjs',
        provenance: '/opt/homebrew',
        windowing: true,
        modifications: ['`install_name_tool` rewrote install names to `@loader_path`', '`codesign --force --sign -`'],
        components: [
            {
                name: 'gtk4',
                version: '4.22.4',
                license: 'LGPL-2.1-or-later',
                binaries: ['libgtk-4.1.dylib'],
                texts: [{ file: 'COPYING' }],
            },
            {
                name: 'glib',
                version: '2.88.1',
                license: 'LGPL-2.1-or-later',
                binaries: ['libglib-2.0.0.dylib'],
                texts: [],
            },
        ],
        binaries: ['libgtk-4.1.dylib', 'libglib-2.0.0.dylib'],
        attribution: 'per-binary',
        payloadDir: 'licenses',
    });
    assert.match(notice, /install_name_tool/);
    assert.match(notice, /codesign/);
    for (const binary of ['libgtk-4.1.dylib', 'libglib-2.0.0.dylib']) {
        assert.ok(notice.includes(binary), `${binary} must appear in the notice`);
    }
    assert.match(notice, /libglib-2\.0\.0\.dylib` — glib 2\.88\.1/);
    assert.match(notice, /1 component\(s\) ship their license text/);
    assert.match(notice, /1 declare a license without shipping its text/);
});

test('a prefix-attributed notice says so instead of implying a per-binary mapping', () => {
    const notice = renderThirdPartyNotice({
        target: 'win32-x64',
        builder: 'packages/node-gi/gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs',
        provenance: 'C:\\gtk-build\\gtk\\x64\\release',
        windowing: true,
        modifications: [],
        components: [{ name: 'gtk4', license: null, texts: [{ file: 'COPYING' }] }],
        binaries: ['gtk-4-1.dll'],
        attribution: 'prefix',
        payloadDir: 'licenses',
    });
    assert.match(notice, /not recoverable/);
    assert.match(notice, /None\. The libraries are byte-identical copies/);
    assert.ok(notice.includes('gtk-4-1.dll'));
});

// --- win32 license COVERAGE, driven from the measured bundle -------------------
//
// THE DEFECT UNDER TEST, measured on this branch's own `gtk-runtime-win32-x64` and
// `…-windowing` CI artifacts rather than reasoned about: 65 DLLs in `bin/` plus 24
// loadable modules and one executable, against 45 projects the gvsbuild prefix documents.
// Nine of the projects behind fourteen of those binaries are documented nowhere —
// `libglib`, `libgobject` and `libgio` (LGPL-2.1-or-later) and `libcrypto`/`libssl`
// (Apache-2.0, whose § 4 requires the license to travel with the binary) shipped with no
// terms at all. Every gate was green, because `assertLicenseCoverage` ran its per-binary
// rules only under `per-binary` attribution while the win32 call passes `prefix`: what it
// actually asserted was "at least one license text was recovered", which a corpus of one
// file satisfies.
//
// The lists below are the artifacts' own file names. They are fixtures on purpose — the
// builders run on no machine a developer has, so this is the only place the family table
// meets a real bundle before a release does.

/** `bin/` of the `--windowing` artifact; the display-free bundle's 37 are a subset. */
const WIN32_BUNDLED_DLLS = [
    'adwaita-1-0.dll',
    'cairo-2.dll',
    'cairo-gobject-2.dll',
    'cairo-script-interpreter-2.dll',
    'comerr64.dll',
    'epoxy-0.dll',
    'ffi-8.dll',
    'fontconfig-1.dll',
    'freetype-6.dll',
    'fribidi-0.dll',
    'gdk_pixbuf-2.0-0.dll',
    'gio-2.0-0.dll',
    'girepository-1.0-1.dll',
    'girepository-2.0-0.dll',
    'glib-2.0-0.dll',
    'gmodule-2.0-0.dll',
    'gobject-2.0-0.dll',
    'graphene-1.0-0.dll',
    'gssapi64.dll',
    'gstapp-1.0-0.dll',
    'gstaudio-1.0-0.dll',
    'gstbase-1.0-0.dll',
    'gstpbutils-1.0-0.dll',
    'gstreamer-1.0-0.dll',
    'gstriff-1.0-0.dll',
    'gstrtp-1.0-0.dll',
    'gsttag-1.0-0.dll',
    'gstvideo-1.0-0.dll',
    'gtk-4-1.dll',
    'gtksourceview-5-0.dll',
    'harfbuzz-cairo.dll',
    'harfbuzz-gobject.dll',
    'harfbuzz-gpu.dll',
    'harfbuzz-icu.dll',
    'harfbuzz-raster.dll',
    'harfbuzz-subset.dll',
    'harfbuzz-vector.dll',
    'harfbuzz.dll',
    'iconv.dll',
    'icudt78.dll',
    'icuuc78.dll',
    'intl.dll',
    'jpeg62.dll',
    'k5sprt64.dll',
    'krb5_64.dll',
    'libcrypto-3-x64.dll',
    'libexpat.dll',
    'libpng16.dll',
    'libssl-3-x64.dll',
    'nghttp2.dll',
    'opus-0.dll',
    'orc-0.4-0.dll',
    'pango-1.0-0.dll',
    'pangocairo-1.0-0.dll',
    'pangoft2-1.0-0.dll',
    'pangowin32-1.0-0.dll',
    'pcre2-8-0.dll',
    'pixman-1-0.dll',
    'psl-5.dll',
    'rsvg-2-2.dll',
    'soup-3.0-0.dll',
    'sqlite3.dll',
    'tiff.dll',
    'xml2-16.dll',
    'zlib1.dll',
];

/** The loadable modules under `lib/` — GIO modules, GStreamer plugins, pixbuf loaders. */
const WIN32_MODULE_DLLS = [
    'giognomeproxy.dll',
    'gioopenssl.dll',
    'gstalaw.dll',
    'gstapp.dll',
    'gstaudioconvert.dll',
    'gstaudiomixer.dll',
    'gstaudioparsers.dll',
    'gstaudiorate.dll',
    'gstaudioresample.dll',
    'gstaudiotestsrc.dll',
    'gstauparse.dll',
    'gstautodetect.dll',
    'gstcoreelements.dll',
    'gstdirectsound.dll',
    'gstisomp4.dll',
    'gstmulaw.dll',
    'gstogg.dll',
    'gstopus.dll',
    'gstplayback.dll',
    'gstsoup.dll',
    'gsttypefindfunctions.dll',
    'gstvolume.dll',
    'gstwavparse.dll',
    'pixbufloader_svg.dll',
];

/**
 * The bundle's one non-library binary, in `libexec/`. It is its own list because it is the
 * category the first coverage set MISSED: not a flat `bin/` entry and not a module, so
 * neither of the two lists the builder assembled reached it, and the 90th binary in the
 * tarball went unchecked while the notice claimed to cover every one.
 */
const WIN32_EXECUTABLES = ['gst-plugin-scanner.exe'];

/** What the gvsbuild prefix documents — the 45 directories under the artifact's `licenses/`. */
const WIN32_PREFIX_COMPONENTS = [
    'adwaita-icon-theme',
    'cairo',
    'cairomm',
    'directx-headers',
    'expat',
    'fontconfig',
    'fribidi',
    'gdk-pixbuf',
    'gettext',
    'glib-networking',
    'glibmm',
    'gperf',
    'gsettings-desktop-schemas',
    'gst-plugins-base',
    'gst-plugins-good',
    'gstreamer',
    'gtk4',
    'gtkmm',
    'gtksourceview5',
    'harfbuzz',
    'icu',
    'libadwaita',
    'libepoxy',
    'libffi',
    'libjpeg-turbo',
    'libpng',
    'libpsl',
    'librsvg',
    'libsigc++',
    'libsoup3',
    'libyuv',
    'mit-kerberos',
    'nghttp2',
    'ogg',
    'opus',
    'orc',
    'pango',
    'pcre2',
    'pixman',
    'pkgconf',
    'protobuf',
    'protobuf-c',
    'pycairo',
    'pygobject',
    'win-iconv',
];

const WIN32_SHIPPED_BINARIES = [...WIN32_BUNDLED_DLLS, ...WIN32_MODULE_DLLS, ...WIN32_EXECUTABLES];
const WIN32_VENDORED_ROOT = fileURLToPath(
    new URL('../../gtk-runtime-win32-x64/licenses-not-in-prefix', import.meta.url),
);

/** The projects the prefix builds binaries from and documents no terms for — the whole gap. */
const WIN32_UNDOCUMENTED_BY_PREFIX = [
    'freetype',
    'glib',
    'gobject-introspection',
    'graphene',
    'libtiff',
    'libxml2',
    'openssl',
    'sqlite',
    'zlib',
];
const WIN32_UNDOCUMENTED_WHY =
    'the nine projects the gvsbuild prefix builds binaries from and documents no terms for — ' +
    'exactly the set licenses-not-in-prefix/ vendors, so the two lists are held against each other';

/** The corpus shape the win32 builder derives: one component per documented project. */
function corpusOf(names) {
    return names.map((name) => ({ name, texts: [{ file: 'COPYING' }] }));
}

/**
 * The builder's own merge, called the way the builder calls it. NOT re-implemented here:
 * a test that reproduces the rule it is checking stays green while the rule changes under
 * it, which is how the coverage gate itself came to assert nothing.
 */
function vendoredComponents(documentedByPrefix, binaries) {
    return upstreamLicenseComponents({
        root: WIN32_VENDORED_ROOT,
        documented: documentedByPrefix,
        binaries,
        families: WIN32_LICENSE_FAMILIES,
    });
}

test('every binary the win32 bundle ships belongs to a declared license family', () => {
    const orphans = WIN32_SHIPPED_BINARIES.filter((leaf) => !licenseFamilyFor(leaf, WIN32_LICENSE_FAMILIES));
    assert.deepEqual(orphans, [], 'a bundled binary whose project nothing names cannot have its terms shipped');
    // Not a rubber stamp either: a library the bundle does not carry has no entry, so the
    // next gvsbuild bump that adds one fails by name instead of shipping unlicensed.
    for (const stranger of ['libvpx-1.dll', 'x264-164.dll', 'avcodec-61.dll']) {
        assert.equal(licenseFamilyFor(stranger, WIN32_LICENSE_FAMILIES), null, `${stranger} must not match`);
    }
    // And it must name the RIGHT project wherever the leaf name does not say it. A wrong
    // name is worse than a missing one: it ships another project's terms under a positive
    // claim, and the notice reads as complete.
    const familyOf = (leaf) => licenseFamilyFor(leaf, WIN32_LICENSE_FAMILIES).components.join('+');
    assert.equal(familyOf('intl.dll'), 'gettext');
    assert.equal(familyOf('iconv.dll'), 'win-iconv');
    assert.equal(familyOf('harfbuzz-icu.dll'), 'harfbuzz', 'the ICU-linked harfbuzz shard is still harfbuzz');
    assert.equal(familyOf('libcrypto-3-x64.dll'), 'openssl');
    assert.equal(familyOf('pixbufloader_svg.dll'), 'librsvg');
    assert.equal(familyOf('gstsoup.dll'), 'gstreamer+gst-plugins-base+gst-plugins-good');
    assert.equal(familyOf('gst-plugin-scanner.exe'), 'gstreamer', 'the bundle ships one .exe and it is gstreamer`s');
    // TWO leaves, TWO projects. glib 2.80 took girepository-2.0 in; gobject-introspection
    // still builds the 1.0 library and gvsbuild still installs it, so one pattern for both
    // named glib as the project behind a gobject-introspection binary.
    assert.equal(familyOf('girepository-2.0-0.dll'), 'glib', 'girepository-2.0 moved into glib at 2.80');
    assert.equal(
        familyOf('girepository-1.0-1.dll'),
        'gobject-introspection',
        'the 1.0 library is still gobject-introspection`s own, and the bundle ships both',
    );
});

test('the win32 gate fails on the state that actually shipped', () => {
    // The published bundle, replayed: its binaries against the corpus its prefix
    // documents, with nothing filling the gaps. Every problem below was invisible before,
    // because the prefix branch never looked at a binary at all.
    const problems = assertLicenseCoverage({
        components: corpusOf(WIN32_PREFIX_COMPONENTS),
        binaries: WIN32_SHIPPED_BINARIES,
        attribution: 'prefix',
        textCount: WIN32_PREFIX_COMPONENTS.length,
        families: WIN32_LICENSE_FAMILIES,
    });
    const undocumented = new Set(problems.map((p) => /no license text ships for (.+)$/.exec(p)?.[1]));
    assert.deepEqual([...undocumented].sort(), WIN32_UNDOCUMENTED_BY_PREFIX, WIN32_UNDOCUMENTED_WHY);
    assert.equal(problems.length, 14, 'fourteen binaries, replayed off the artifact');
    assert.match(problems.join('\n'), /libcrypto-3-x64\.dll is openssl, and no license text ships for openssl/);
    assert.match(problems.join('\n'), /libssl-3-x64\.dll is openssl/);
    // Not only the payload this branch adds: GLib is five of the bundle's DLLs and has been
    // unlicensed in every published win32 tarball.
    assert.match(problems.join('\n'), /gio-2\.0-0\.dll is glib, and no license text ships for glib/);
});

test('the vendored texts close exactly that gap, and removing one reopens it', () => {
    // Drives the REAL directory beside the win32 builder, not a fixture: a text deleted,
    // renamed past the scanner or emptied goes red HERE rather than on a Windows runner.
    const documentedByPrefix = new Set(WIN32_PREFIX_COMPONENTS);
    const vendored = vendoredComponents(documentedByPrefix, WIN32_SHIPPED_BINARIES);
    // The narrowing that keeps this from becoming a corpus of its own: a bundle without
    // the payload does not carry its terms. The display-free variant ships no OpenSSL.
    const displayFree = WIN32_BUNDLED_DLLS.filter((leaf) => !/^(lib(crypto|ssl)|sqlite3|xml2)/i.test(leaf));
    assert.ok(
        !vendoredComponents(documentedByPrefix, displayFree).some((c) => c.name === 'openssl'),
        'a variant with no libcrypto must not ship OpenSSL terms',
    );
    assert.deepEqual(
        vendored.map((c) => c.name).sort(),
        WIN32_UNDOCUMENTED_BY_PREFIX,
        'the vendored corpus covers the prefix gap and nothing else',
    );
    for (const component of vendored) {
        assert.ok(component.texts.length > 0, `${component.name} ships no text`);
        for (const text of component.texts) assert.ok(text.bytes > 0, `${text.relative} is empty`);
    }

    const components = [...corpusOf(WIN32_PREFIX_COMPONENTS), ...vendored];
    assert.deepEqual(
        assertLicenseCoverage({
            components,
            binaries: WIN32_SHIPPED_BINARIES,
            attribution: 'prefix',
            textCount: components.length,
            families: WIN32_LICENSE_FAMILIES,
        }),
        [],
        'with the gap filled, every shipped binary has its terms',
    );

    // The control that says the check measures something: take OpenSSL back out and the
    // two DLLs this branch adds are named again — and only those two.
    const withoutOpenssl = components.filter((c) => c.name !== 'openssl');
    const problems = assertLicenseCoverage({
        components: withoutOpenssl,
        binaries: WIN32_SHIPPED_BINARIES,
        attribution: 'prefix',
        textCount: withoutOpenssl.length,
        families: WIN32_LICENSE_FAMILIES,
    });
    assert.deepEqual(
        problems.map((p) => p.split(' ')[0]).sort(),
        ['libcrypto-3-x64.dll', 'libssl-3-x64.dll'],
        'the gate points at the binary, not at the corpus',
    );
    assert.match(formatLicenseProblems(problems, { prefix: 'C:\\gtk-build' }), /licenses-not-in-prefix/);
});

test('prefix attribution with no family table is itself the defect', () => {
    // The exact shape that shipped: `attribution: 'prefix'` and nothing to relate a binary
    // to a component with. It must not be able to read as "checked".
    const problems = assertLicenseCoverage({
        components: corpusOf(WIN32_PREFIX_COMPONENTS),
        binaries: WIN32_SHIPPED_BINARIES,
        attribution: 'prefix',
        textCount: 45,
    });
    assert.match(problems.join('\n'), /no license family table/);
});

test('a component named in the corpus but shipping no text is not documented', () => {
    // `share/doc/openssl/` existing and empty is not a license. The gate keys on TEXTS.
    const problems = assertLicenseCoverage({
        components: [{ name: 'openssl', texts: [] }],
        binaries: ['libcrypto-3-x64.dll'],
        attribution: 'prefix',
        textCount: 1,
        families: WIN32_LICENSE_FAMILIES,
    });
    assert.match(problems.join('\n'), /libcrypto-3-x64\.dll is openssl, and no license text ships for openssl/);
});

test('the vendored corpus records where each text came from, and to which gvsbuild pin', () => {
    // The one thing the coverage gate CANNOT see: a vendored text is a copy of an upstream
    // release, and the release it copies is chosen by the gvsbuild pin the workflows build
    // with. Move the pin and these texts silently describe a different version — no binary
    // is missing, no family is unclaimed, and every other check here stays green. So the
    // pin is recorded next to the texts and held against the workflows that use it.
    const provenance = JSON.parse(readFileSync(join(WIN32_VENDORED_ROOT, 'provenance.json'), 'utf8'));
    const directories = readdirSync(WIN32_VENDORED_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    assert.deepEqual(
        directories,
        Object.keys(provenance.components).sort(),
        'every vendored directory needs a recorded upstream version, and every record a directory',
    );
    // And the set is the gap itself, not a list that drifted away from it.
    assert.deepEqual(directories, WIN32_UNDOCUMENTED_BY_PREFIX, WIN32_UNDOCUMENTED_WHY);

    const workflows = ['release.yml', 'node-gi.yml'].map((name) =>
        readFileSync(fileURLToPath(new URL(`../../../../.github/workflows/${name}`, import.meta.url)), 'utf8'),
    );
    for (const [i, yaml] of workflows.entries()) {
        const pins = [...yaml.matchAll(/GVSBUILD_VERSION:\s*'([^']+)'/g)].map((m) => m[1]);
        assert.ok(pins.length > 0, `workflow ${i} declares no GVSBUILD_VERSION — the pattern moved`);
        for (const pin of new Set(pins)) {
            assert.equal(
                pin,
                provenance.gvsbuild,
                `gvsbuild is pinned at ${pin} but licenses-not-in-prefix/ was taken from ${provenance.gvsbuild}. ` +
                    'Re-take the texts from the new pin (their upstream versions are in provenance.json) and ' +
                    'update both — do NOT just move the pin: the bundle would then ship one release of a ' +
                    "library under another release's terms.",
            );
        }
    }
});

// --- runtime data portability -----------------------------------------------

test('a data tree copied WITHOUT dereference is caught as non-portable', () => {
    // The measured shape (PR #977 CI): Homebrew links a keg's tree into its prefix,
    // `cpSync` defaults to dereference:false, so `share/icons/Adwaita` was copied as a
    // LINK into the Cellar — 0.2 MiB of links where the theme is 22 MB of files. It
    // survived because `actions/upload-artifact` FOLLOWS symlinks (so the artifact
    // looked complete) while `npm pack` does not, and because the old size came from
    // `statSync`, which follows too.
    const src = fixtureDir('theme/scalable');
    writeFileSync(join(src, 'theme', 'scalable', 'icon.svg'), '<svg/>');
    const out = fixtureDir('share/icons');

    // What the default copy produced: a link pointing outside the bundle.
    symlinkSync(join(src, 'theme'), join(out, 'share', 'icons', 'Adwaita'));
    const links = findSymlinks(join(out, 'share'));
    assert.equal(links.length, 1);
    assert.equal(links[0].path, 'icons/Adwaita');
    assert.match(formatSymlinkProblems(links, { root: out }), /dereference: true/);

    // What a dereferencing copy produces: real files, nothing to report.
    const good = fixtureDir('share/icons/Adwaita/scalable');
    writeFileSync(join(good, 'share', 'icons', 'Adwaita', 'scalable', 'icon.svg'), '<svg/>');
    assert.deepEqual(findSymlinks(join(good, 'share')), []);
});

test("cpSync's `dereference: true` does NOT dereference nested links — the trap", () => {
    // This is the measured reason the first fix attempt failed in CI: the flag governs
    // only the stat of the path handed to cpSync, so `share/icons/Adwaita/**` came out
    // as 859 links into the Cellar even WITH dereference:true. Pinned as a test because
    // the flag's name says otherwise and the next reader will reach for it again.
    const outside = fixtureDir('theme');
    writeFileSync(join(outside, 'theme', 'icon.svg'), '<svg/>');
    const src = fixtureDir('tree/sub');
    writeFileSync(join(src, 'tree', 'sub', 'plain.svg'), '<svg/>');
    symlinkSync(join(outside, 'theme', 'icon.svg'), join(src, 'tree', 'sub', 'alias.svg'));

    const viaCpSync = join(fixtureDir(), 'out');
    cpSync(join(src, 'tree'), viaCpSync, { recursive: true, dereference: true });
    assert.equal(findSymlinks(viaCpSync).length, 1, 'cpSync leaves the nested link a link');

    const viaWalk = join(fixtureDir(), 'out');
    const stats = copyTreeDereferenced(join(src, 'tree'), viaWalk);
    assert.deepEqual(findSymlinks(viaWalk), [], 'copyTreeDereferenced leaves no link behind');
    assert.equal(stats.files, 2);
    assert.equal(stats.dereferenced, 1);
    assert.deepEqual(stats.dangling, []);
    assert.ok(!lstatSync(join(viaWalk, 'sub', 'alias.svg')).isSymbolicLink());
});

test('copyTreeDereferenced skips a dangling source link and reports it', () => {
    // A broken alias in someone else's icon theme must not fail the build, and must not
    // be shipped as a link that resolves nowhere either.
    const src = fixtureDir('tree');
    writeFileSync(join(src, 'tree', 'real.svg'), '<svg/>');
    symlinkSync('/nonexistent/gone.svg', join(src, 'tree', 'broken.svg'));
    const out = join(fixtureDir(), 'out');
    const stats = copyTreeDereferenced(join(src, 'tree'), out);
    assert.equal(stats.files, 1);
    assert.equal(stats.dangling.length, 1);
    assert.deepEqual(findSymlinks(out), [], 'nothing unresolvable was copied');
    assert.deepEqual(readdirSync(out), ['real.svg']);
});

test('findSymlinks reports a DANGLING link too, and an absent tree is empty', () => {
    const out = fixtureDir('share');
    symlinkSync('/nonexistent/Cellar/adwaita-icon-theme/48/share/icons/Adwaita', join(out, 'share', 'Adwaita'));
    const links = findSymlinks(join(out, 'share'));
    assert.equal(links.length, 1, 'a link whose target is gone is exactly the shipped failure');
    assert.match(links[0].target, /Cellar/);
    assert.deepEqual(findSymlinks(join(out, 'does-not-exist')), []);
});

// --- declared runtime data --------------------------------------------------
// The gate that turns both builders' warn-and-continue data steps into a build failure
// ON THE PUBLISH PATH. `dataBytes: 0` shipped in 0.27.1 precisely because a WARNING is
// what a missing data set produced, so these cases are the rehearsal that the gate fails
// on the bad input — one per declared set, plus the vacuous shapes.

/** A complete windowing data tree, the shape both builders produce. */
function windowingBundle({
    schemas = true,
    icons = true,
    gtksource = true,
    iconIndex = true,
    loaders = true,
    gioModules = true,
} = {}) {
    const root = fixtureDir();
    if (schemas) {
        mkdirSync(join(root, 'share/glib-2.0/schemas'), { recursive: true });
        writeFileSync(join(root, 'share/glib-2.0/schemas/gschemas.compiled'), 'compiled');
    }
    if (icons) {
        mkdirSync(join(root, 'share/icons/Adwaita/scalable'), { recursive: true });
        if (iconIndex) writeFileSync(join(root, 'share/icons/Adwaita/index.theme'), '[Icon Theme]');
        writeFileSync(join(root, 'share/icons/Adwaita/scalable/open-menu-symbolic.svg'), '<svg/>');
    }
    if (gtksource) {
        mkdirSync(join(root, 'share/gtksourceview-5/language-specs'), { recursive: true });
        writeFileSync(join(root, 'share/gtksourceview-5/language-specs/language2.rng'), '<grammar/>');
    }
    if (loaders) writePixbufLoaders(root);
    if (gioModules) writeGioModules(root);
    return root;
}

/**
 * The GIO TLS backend module both builders ship. Leaf differs per platform (brew names it
 * `libgiognutls.so`, gvsbuild `gioopenssl.dll`), so the set requires ONE non-empty file in
 * the dir and never a name.
 */
function writeGioModules(root, { module = 'libgiognutls.so' } = {}) {
    mkdirSync(join(root, 'lib/gio/modules'), { recursive: true });
    writeFileSync(join(root, `lib/gio/modules/${module}`), 'module');
}

/**
 * The gdk-pixbuf loader payload BOTH builders ship (darwin's since
 * build-gtk-runtime-darwin.mjs § 2b). The module leaf differs per platform — brew names
 * it `libpixbufloader_svg.so`, gvsbuild `pixbufloader-svg.dll` — and the set requires a
 * non-empty cache plus at least one module, never an extension.
 */
function writePixbufLoaders(root, { module = 'libpixbufloader_svg.so' } = {}) {
    mkdirSync(join(root, 'lib/gdk-pixbuf-2.0/2.10.0/loaders'), { recursive: true });
    writeFileSync(join(root, 'lib/gdk-pixbuf-2.0/2.10.0/loaders.cache'), `"${module}"\n`);
    writeFileSync(join(root, `lib/gdk-pixbuf-2.0/2.10.0/loaders/${module}`), 'module');
}

// What a real --windowing bundle ships. `GdkPixbuf` is listed because it is in
// REQUIRED_NAMESPACES, i.e. EVERY bundle carries it — so the loader set always has a
// subject and can never be skipped into silence on either platform.
const GTK_NAMESPACES = ['GLib', 'GObject', 'Gio', 'GdkPixbuf', 'Gtk', 'Gdk', 'Adw', 'GtkSource'];

test('a complete windowing bundle passes, and every set is REPORTED as applied', () => {
    const result = verifyWindowingData({
        bundleDir: windowingBundle(),
        shippedNamespaces: GTK_NAMESPACES,
    });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(
        result.applied.map((a) => a.id),
        ['schemas', 'icons', 'pixbuf-loaders', 'gtksource', 'tls-backend'],
    );
    // Positive counts, not merely "no complaints": every applied set found real files.
    for (const applied of result.applied) assert.ok(applied.files > 0, `${applied.id} counted no file`);
});

test('a missing declared data set FAILS — one case per set', () => {
    for (const [absent, expected] of [
        ['schemas', /schemas: share\/glib-2\.0\/schemas\/gschemas\.compiled is missing or empty/],
        ['icons', /icons: nothing matches share\/icons\/\*\/index\.theme/],
        ['gtksource', /gtksource: share\/gtksourceview-5\/ holds no non-empty file/],
        ['loaders', /pixbuf-loaders: lib\/gdk-pixbuf-2\.0\/2\.10\.0\/loaders\.cache is missing or empty/],
        ['gioModules', /tls-backend: nothing matches lib\/gio\/modules\/\*/],
    ]) {
        const result = verifyWindowingData({
            bundleDir: windowingBundle({ [absent]: false }),
            shippedNamespaces: GTK_NAMESPACES,
        });
        assert.ok(result.problems.length > 0, `a bundle without ${absent} must not pass`);
        assert.match(result.problems.join('\n'), expected);
        // The operator message must name the remedy, not just the symptom.
        const message = formatWindowingDataProblems(result.problems, { bundleDir: 'gtk' });
        assert.match(message, /DECLARED WINDOWING DATA IS MISSING/);
        assert.match(message, /do NOT downgrade the step back to a warning/);
    }
});

test('an EMPTY tree or a zero-byte file is as missing as an absent one', () => {
    // The shape a `test -d share/icons` check passes and a consumer still cannot use:
    // the directories exist, the bytes do not.
    const root = windowingBundle({ schemas: false, gtksource: false });
    mkdirSync(join(root, 'share/glib-2.0/schemas'), { recursive: true });
    writeFileSync(join(root, 'share/glib-2.0/schemas/gschemas.compiled'), ''); // truncated
    mkdirSync(join(root, 'share/gtksourceview-5/styles'), { recursive: true }); // empty tree
    const result = verifyWindowingData({ bundleDir: root, shippedNamespaces: GTK_NAMESPACES });
    assert.equal(result.problems.length, 2);
    assert.match(result.problems.join('\n'), /gschemas\.compiled is missing or empty/);
    assert.match(result.problems.join('\n'), /gtksourceview-5\/ holds no non-empty file/);
});

test('an icon theme with an index but NO icons fails the second half of the set', () => {
    const root = fixtureDir('share/glib-2.0/schemas', 'share/icons/Adwaita', 'share/gtksourceview-5');
    writeFileSync(join(root, 'share/glib-2.0/schemas/gschemas.compiled'), 'compiled');
    writeFileSync(join(root, 'share/icons/Adwaita/index.theme'), ''); // empty index — no theme
    writeFileSync(join(root, 'share/gtksourceview-5/language.dtd'), '<!ELEMENT x EMPTY>');
    writePixbufLoaders(root); // present, so the count below is about the ICONS set alone
    writeGioModules(root); // ditto — the TLS backend set applies to every Gio-shipping bundle
    const result = verifyWindowingData({ bundleDir: root, shippedNamespaces: GTK_NAMESPACES });
    assert.equal(result.problems.length, 2, 'both the index glob and the tree count must complain');
    assert.match(result.problems.join('\n'), /nothing matches share\/icons\/\*\/index\.theme/);
    assert.match(result.problems.join('\n'), /share\/icons\/ holds no non-empty file/);
});

test('a set is required by the NAMESPACE the bundle ships, not by a flag', () => {
    // Two sets with no subject: the backer filter dropped Adw + GtkSource (the display-free
    // bundle's shape), and this namespace list also omits GdkPixbuf — so both the GtkSource
    // tree and the pixbuf loaders are SKIPPED, while the sets whose namespaces ARE shipped
    // still apply. That is why the display-free variant needs no relaxed copy of this gate:
    // the same rule, applied to what a bundle actually ships. (A real display-free bundle
    // does ship GdkPixbuf — it declares no data at all, so the gate is never run for it.)
    const result = verifyWindowingData({
        bundleDir: windowingBundle({ gtksource: false, loaders: false }),
        shippedNamespaces: ['GLib', 'GObject', 'Gio', 'Gtk', 'Gdk'],
    });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(
        result.applied.map((a) => a.id),
        ['schemas', 'icons', 'tls-backend'],
    );
    assert.deepEqual(result.skipped, [
        { id: 'pixbuf-loaders', namespace: 'GdkPixbuf' },
        { id: 'gtksource', namespace: 'GtkSource' },
    ]);
});

test('a bundle that applies NO set at all is a failure, not a pass', () => {
    // The vacuous shape: hand the gate a namespace list nothing matches and every check
    // above is trivially satisfied. Same rule as verifyBundleTypelibs' "≥1 backed
    // typelib" floor — a gate with no subject must say so.
    const result = verifyWindowingData({
        bundleDir: windowingBundle(),
        shippedNamespaces: ['freetype2', 'xlib'],
    });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /no windowing data set applied/);
    assert.deepEqual(result.applied, []);
});

test('BOTH bundles require the gdk-pixbuf loaders they ship', () => {
    // THE PREMISE CHANGED, so this test was rewritten rather than adjusted. It used to
    // assert that the loader set was win32-ONLY and that "on darwin the same bundle
    // passes, because that builder does not claim the loaders" — true while the darwin
    // builder bundled none. Measured consequence of that asymmetry on a real macOS x64
    // host against the published @gjsify/gtk-runtime-darwin-x64@0.28.0:
    // Pixbuf.new_from_file() on the bundle's OWN symbolic icon returned NULL, i.e. 715
    // SVGs and no decoder. build-gtk-runtime-darwin.mjs § 2b ships them now, so the set
    // is in the ONE list and the same absence fails for EITHER platform — no `sets`
    // override, which is exactly what both builders pass.
    const withoutLoaders = verifyWindowingData({
        bundleDir: windowingBundle({ loaders: false }),
        shippedNamespaces: GTK_NAMESPACES,
    });
    assert.equal(withoutLoaders.problems.length, 2, 'the cache AND the loader dir must be reported');
    assert.match(withoutLoaders.problems.join('\n'), /loaders\.cache is missing or empty/);
    assert.match(withoutLoaders.problems.join('\n'), /nothing matches lib\/gdk-pixbuf-2\.0\/2\.10\.0\/loaders\/\*/);

    // Either platform's module naming satisfies it: the requirement is a cache plus at
    // least one module, never a file extension (brew ships `.so`/`.dylib`, gvsbuild `.dll`).
    for (const module of ['libpixbufloader_svg.so', 'pixbufloader-svg.dll']) {
        const root = windowingBundle({ loaders: false });
        writePixbufLoaders(root, { module });
        const complete = verifyWindowingData({ bundleDir: root, shippedNamespaces: GTK_NAMESPACES });
        assert.deepEqual(complete.problems, [], `${module} must satisfy the set`);
        assert.ok(complete.applied.some((a) => a.id === 'pixbuf-loaders'));
    }
});

test('WINDOWING_DATA_SETS keys every set to a namespace the floor guarantees', async () => {
    // The requirement is derived from the shipped typelibs, so it can only be dodged by
    // dropping a namespace — and these are exactly the ones typelib-backers.mjs refuses
    // to let a --windowing bundle drop. Pinned so the two rules cannot drift apart.
    const floor = new Set([...REQUIRED_NAMESPACES, ...WINDOWING_REQUIRED_NAMESPACES]);
    for (const set of WINDOWING_DATA_SETS) {
        assert.ok(floor.has(set.namespace), `${set.id} keys on ${set.namespace}, which no floor guarantees`);
        assert.ok(set.requires.length > 0, `${set.id} declares no requirement`);
        assert.ok(set.why && set.remedy, `${set.id} must state why it matters and how to repair it`);
    }
    // And there is exactly ONE list. A per-platform sibling array is how the loader gap
    // stayed invisible: the set existed, both builders imported the module, and only one
    // of them was asserted against it. Keeping this list platform-independent means a
    // builder cannot opt out of a set by not merging it in.
    const module = await import('../../scripts/bundle-data.mjs');
    assert.deepEqual(
        Object.keys(module).filter((name) => name.endsWith('_DATA_SETS')),
        ['WINDOWING_DATA_SETS'],
        'a platform-specific data-set list is a gate one builder can silently skip',
    );
    assert.ok(
        WINDOWING_DATA_SETS.some((set) => set.id === 'pixbuf-loaders'),
        'the pixbuf loaders are shipped by both builders and belong in the shared list',
    );
});

// --- GL implementation vs. GL dispatch (#1097) -----------------------------
// The shipped 0.34.0 win32 bundle: 41 DLLs, epoxy among them, no rasteriser. It
// advertised `windowing: true` and every Gtk.GLArea failed with "No GL
// implementation is available" on a host without a vendor ICD.
const BUNDLE_0_34_0 = ['gtk-4-1.dll', 'epoxy-0.dll', 'cairo-2.dll', 'glib-2.0-0.dll', 'adwaita-1-0.dll'];

test('epoxy alone is NOT a GL implementation — the bundle that shipped for four releases', () => {
    const gl = describeGlImplementation({ dlls: BUNDLE_0_34_0 });
    assert.deepEqual(gl.matched, [], 'epoxy is dispatch; counting it is exactly the misreading #1097 records');
    assert.deepEqual(gl.dispatch, ['epoxy-0.dll'], 'dispatch is reported, in its own field, so it cannot be misread');
});

test('a desktop-GL ICD and ANGLE each count, case-insensitively', () => {
    // Mesa's win32 pair, as `mesa-dist-win` lays it out beside an executable.
    // Sorted with localeCompare, which orders case-insensitively — `libgallium`
    // before `OPENGL32`, not after it as a byte sort would put them.
    const wgl = describeGlImplementation({ dlls: [...BUNDLE_0_34_0, 'OPENGL32.DLL', 'libgallium_wgl.dll'] });
    assert.deepEqual(wgl.matched, ['libgallium_wgl.dll', 'OPENGL32.DLL']);
    // ANGLE, which is what #1097 originally proposed shipping.
    const egl = describeGlImplementation({ dlls: [...BUNDLE_0_34_0, 'libEGL.dll', 'libGLESv2.dll'] });
    assert.deepEqual(egl.matched, ['libEGL.dll', 'libGLESv2.dll']);
});

test('the failure names every pattern it tried, not one absent file', () => {
    // The regression guard: #1097 happened because an unmatched seed was
    // indistinguishable from a matched one. A message naming a single missing file
    // would let the NEXT unmatched pattern reproduce it just as quietly.
    const gl = describeGlImplementation({ dlls: BUNDLE_0_34_0 });
    const message = formatMissingGlImplementation({ gl, prefixBin: 'C:\\gtk-build\\gtk\\x64\\release\\bin' });
    for (const pattern of GL_IMPLEMENTATION_PATTERNS) {
        assert.ok(message.includes(String(pattern)), `the message must state that ${pattern} was tried`);
    }
    assert.ok(message.includes('epoxy-0.dll'), 'and that what IS present is dispatch');
    assert.ok(message.includes('#1097'), 'and where the reasoning lives');
});

test('the patterns are recorded in the result, so a manifest proves the negative was checked', () => {
    const gl = describeGlImplementation({ dlls: [] });
    assert.deepEqual(gl.patterns, GL_IMPLEMENTATION_PATTERNS.map(String));
    assert.ok(
        !gl.patterns.some((p) => /epoxy/i.test(p)),
        'epoxy must never enter the implementation patterns — that is the whole defect',
    );
});

function nativeLibraryIndexOf(names, caseInsensitive) {
    const dir = fixtureDir();
    for (const name of names) writeFileSync(join(dir, name), '');
    return nativeLibraryIndex(dir, { caseInsensitive });
}

// --- rule 3: a module must not ALSO be a flat library entry -------------------
// The gate that would have caught the 24 duplicated GStreamer plugins. Every other gate
// was green on that bundle: the count checks counted the module dir, `verifyRelocation`
// verified BOTH copies (each was correctly relocated), and the typelib symmetry check
// looks at libraries, not plugins. A correct extra copy is invisible to all of them.

test('a module placed in its own dir and NOT in the flat dir is clean', () => {
    assert.deepEqual(
        duplicatedModuleLeaves(
            ['libglib-2.0.0.dylib', 'libgstreamer-1.0.0.dylib'],
            ['/b/lib/gstreamer-1.0/libgstsoup.dylib', '/b/lib/gio/modules/libgiognutls.so'],
        ),
        [],
    );
});

test('the SAME leaf in both places is reported — the 24-plugin defect', () => {
    // Exactly the shape the darwin artifact had: the plugin under lib/gstreamer-1.0/ AND
    // a second copy in flat lib/, because the walk resolved the plugin's own install name.
    assert.deepEqual(
        duplicatedModuleLeaves(
            ['libglib-2.0.0.dylib', 'libgstsoup.dylib', 'libgstplayback.dylib'],
            ['/b/lib/gstreamer-1.0/libgstsoup.dylib', '/b/lib/gstreamer-1.0/libgstplayback.dylib'],
        ),
        ['libgstplayback.dylib', 'libgstsoup.dylib'],
    );
});

test('the flat side may be given as PATHS, not only leaves', () => {
    // darwin passes a Set of leaves, win32 a Set of bin/ file names; neither should have
    // to normalise at the call site.
    assert.deepEqual(duplicatedModuleLeaves(['/b/lib/libgstsoup.dylib'], ['/b/lib/gstreamer-1.0/libgstsoup.dylib']), [
        'libgstsoup.dylib',
    ]);
});

test('win32 folds case, darwin does not — bin/ is a Windows directory', () => {
    assert.deepEqual(duplicatedModuleLeaves(['GstSoup.dll'], ['C:\\b\\lib\\gstreamer-1.0\\gstsoup.dll']), []);
    assert.deepEqual(
        duplicatedModuleLeaves(['GstSoup.dll'], ['C:\\b\\lib\\gstreamer-1.0\\gstsoup.dll'], {
            caseInsensitive: true,
        }),
        ['gstsoup.dll'],
    );
});

test("BOTH builders' actual argument shapes work — darwin a Set, win32 a Map iterator", () => {
    // Not a style point: win32 holds its closure as a Map of leaf -> source path, so the
    // call site passes `binDlls.values()`. Passing the Map ITSELF yields [k, v] pairs and
    // throws on .replace — caught in review, and only ever on a Windows runner otherwise.
    const darwin = new Set(['libglib-2.0.0.dylib', 'libgstsoup.dylib']);
    assert.deepEqual(duplicatedModuleLeaves(darwin, ['/b/lib/gstreamer-1.0/libgstsoup.dylib']), ['libgstsoup.dylib']);
    const win32 = new Map([
        ['glib-2.0-0.dll', 'C:\\gtk\\bin\\glib-2.0-0.dll'],
        ['gstsoup.dll', 'C:\\gtk\\bin\\gstsoup.dll'],
    ]);
    assert.deepEqual(
        duplicatedModuleLeaves(win32.values(), ['C:\\b\\lib\\gstreamer-1.0\\gstsoup.dll'], {
            caseInsensitive: true,
        }),
        ['gstsoup.dll'],
    );
});

test('the operator message names the leaves and refuses the tempting repair', () => {
    const message = formatDuplicatedModuleProblems(['libgstsoup.dylib'], { flatDir: '/b/lib' });
    assert.match(message, /MODULES DUPLICATED INTO \/b\/lib — 1 leaf/);
    assert.match(message, /libgstsoup\.dylib/);
    // The repair is at the WALK. Deleting the flat copy afterwards hides the reference.
    assert.match(message, /Do NOT delete the flat copy as a post-step/);
});
