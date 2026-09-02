// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a STAGED typelib (typelib and its backer in ONE directory)
// against a REAL filesystem.
//
// WHY REAL DIRECTORIES HERE, when `system-gi.test.mjs` and `native-prebuilds.test.mjs`
// inject their filesystem. Those suites pin the ALGORITHM and are right to run
// anywhere; what they cannot show is that the shape they describe is the shape an
// install actually has. Both defects below were about a real layout being read as a
// different real layout, so the fixture is the point: `mkdtemp` a tree with the
// typelib and the dylib in the same directory and let the production readers
// (`statSync`, `readdirSync`, `readFileSync`) meet it.
//
// The two, measured on the macOS 15.7.9 x86_64 VM against the published 0.45.0
// `@gjsify/webkit-native`, are each recorded next to the code that answers them:
// DISCOVERY (finding the staged directory with nothing in the environment) in
// `native-prebuilds.js` + ADR 0021 § The Node host, LAYOUT (reading it as its own
// libdir) in `system-gi.js` § `giLibraryDirsForTypelibDir`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { giLibraryDirsForTypelibDir, systemGiLibraryDirs, TYPELIB_SUBDIR } from '../system-gi.js';
import {
    activateNativePrebuilds,
    discoverPrebuiltTypelibDirs,
    resetNativePrebuildsForTests,
} from '../native-prebuilds.js';

/**
 * An installed `@gjsify/webkit-native-darwin-x64` as npm hoists it: the typelib and
 * the dylib it names by bare leaf, side by side under the declared `gjsify.prebuilds`
 * directory (ADR 0017).
 */
function stagedTree(t) {
    const root = mkdtempSync(join(tmpdir(), 'node-gi-staged-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const pkg = join(root, 'node_modules', '@gjsify', 'webkit-native-darwin-x64');
    const prebuilds = join(pkg, 'prebuilds');
    const staged = join(prebuilds, 'darwin-x64');
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, 'WebKit-6.0.typelib'), '');
    writeFileSync(join(staged, 'libgjsifywebkit.dylib'), '');
    writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({
            name: '@gjsify/webkit-native-darwin-x64',
            gjsify: { prebuilds: 'prebuilds', platforms: ['darwin-x64'] },
        }),
    );
    return { root, prebuilds, staged };
}

// ---------------------------------------------------------------------------
// Defect A — the library directory a typelib directory implies.
// ---------------------------------------------------------------------------

test('a staged pair puts the libdir IN the typelib dir, not above it', (t) => {
    const { prebuilds, staged } = stagedTree(t);

    // The real `statSync` predicate, so the fixture is what answers.
    const dirs = systemGiLibraryDirs({
        platform: 'darwin',
        env: { GI_TYPELIB_PATH: staged },
        searchDirs: () => [],
    });

    assert.ok(
        dirs.includes(staged),
        `the directory holding libgjsifywebkit.dylib must be offered to the loader; got ${JSON.stringify(dirs)}`,
    );
    assert.equal(dirs[0], staged, 'and it outranks the parent, which is the reading that failed');
    // The parent is kept as the tolerant tail rather than dropped: a relocated
    // INSTALL layout whose typelib dir is not named girepository-1.0 still needs it.
    assert.ok(dirs.includes(prebuilds), 'the install-layout reading survives as the fallback');
});

test('GI’s install layout still answers with the parent alone', (t) => {
    // The canonical shape, and the reason the marker decides rather than a probe:
    // `<libdir>/girepository-1.0/` holds no library, so offering it would put a
    // directory on the loader's search path that can never match a leaf.
    const root = mkdtempSync(join(tmpdir(), 'node-gi-installed-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const libDir = join(root, 'lib');
    const typelibDir = join(libDir, TYPELIB_SUBDIR);
    mkdirSync(typelibDir, { recursive: true });
    writeFileSync(join(typelibDir, 'Gtk-4.0.typelib'), '');
    writeFileSync(join(libDir, 'libgtk-4.1.dylib'), '');

    assert.deepEqual(
        systemGiLibraryDirs({ platform: 'darwin', env: { GI_TYPELIB_PATH: typelibDir }, searchDirs: () => [] }),
        [libDir],
    );
});

test('giLibraryDirsForTypelibDir: the marker decides, its absence offers both', () => {
    // Pure, so both layouts are pinned without a filesystem at all.
    assert.deepEqual(giLibraryDirsForTypelibDir(`/usr/local/lib/${TYPELIB_SUBDIR}`), ['/usr/local/lib']);
    assert.deepEqual(giLibraryDirsForTypelibDir('/app/prebuilds/darwin-x64'), [
        '/app/prebuilds/darwin-x64',
        '/app/prebuilds',
    ]);
    // A relocated install: unknown layout, so the parent is still reachable.
    assert.deepEqual(giLibraryDirsForTypelibDir('/opt/mystack/lib/typelibs'), [
        '/opt/mystack/lib/typelibs',
        '/opt/mystack/lib',
    ]);
});

// ---------------------------------------------------------------------------
// Defect B — finding that directory with no environment variable at all.
// ---------------------------------------------------------------------------

test('discovery walks a real node_modules with the production readers', (t) => {
    const { root, staged } = stagedTree(t);
    // No `fs` option: this exercises REAL_FS — `readdirSync(withFileTypes)`,
    // `readFileSync` of the manifest, `statSync` — which every other case stubs out.
    // Asserted on the FIRST entry, not on the whole array: the walk climbs to the
    // filesystem root, and a `node_modules` above the temp dir is the runner's
    // business, not this fixture's.
    const found = discoverPrebuiltTypelibDirs({ startDir: root, platform: 'darwin', arch: 'x64' });
    assert.equal(found[0], staged, `nearest install first; got ${JSON.stringify(found)}`);
});

test('activation hands the staged dir to BOTH of GI’s search paths', (t) => {
    const { root, staged } = stagedTree(t);
    resetNativePrebuildsForTests();
    t.after(resetNativePrebuildsForTests);

    const search = [];
    const library = [];
    const applied = activateNativePrebuilds(
        { prependSearchPath: (p) => search.push(p), prependLibraryPath: (p) => library.push(p) },
        { startDir: root, platform: 'darwin', arch: 'x64' },
    );

    assert.equal(applied[0], staged);
    // Both, because a typelib is half an answer: the second call is what row 2 of
    // the measurement above was missing.
    assert.ok(search.includes(staged), 'the typelib half');
    assert.ok(library.includes(staged), 'the library half');
});
