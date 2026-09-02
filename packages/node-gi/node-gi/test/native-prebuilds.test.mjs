// SPDX-License-Identifier: MIT
// @gjsify/node-gi — discovery of staged prebuild typelibs outside the GTK bundle.
//
// THE DEFECT UNDER TEST. `@gjsify/webkit-native` ships `WebKit-6.0.typelib` beside
// `libgjsifywebkit.dylib` and is the only WebKit a darwin host has (ADR 0022). Under
// Node, `requireGi('WebKit', '6.0')` reported "Typelib file for namespace 'WebKit',
// version '6.0' not found" while that typelib sat installed in `node_modules` — the
// CLI composes `GI_TYPELIB_PATH` for `gjsify run`, but a bundle started as plain
// `node app.node.mjs` never passes through it, and only the GTK runtime bundle got
// the env-free treatment ADR 0021 makes the rule.
//
// WHY THIS IS A UNIT TEST AND NOT ONLY AN INTEGRATION ONE. The discovery is where the
// darwin and win32 target strings are formed, and neither platform is the one a
// developer or this repo's Linux CI runs on. `discoverPrebuiltTypelibDirs` therefore
// takes `platform`/`arch` and its filesystem as parameters — the same discipline
// `detect-native-packages.ts` states — so every branch is exercisable from anywhere,
// against a synthesised tree rather than a real install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
    activateNativePrebuilds,
    discoverPrebuiltTypelibDirs,
    resetNativePrebuildsForTests,
} from '../native-prebuilds.js';

/**
 * A fake filesystem over a plain map of `path -> entry`.
 * Directories are declared by listing their children; files carry no content,
 * because discovery only ever looks at names and manifests.
 */
function fakeFs({ dirs = {}, manifests = {} }) {
    const norm = (p) => p.replace(/\\/g, '/');
    return {
        isDirectory: (p) => Object.hasOwn(dirs, norm(p)),
        exists: (p) => Object.hasOwn(dirs, norm(p)) || Object.hasOwn(manifests, norm(p)),
        readDir: (p) => dirs[norm(p)] ?? [],
        readJson: (p) => manifests[norm(p)] ?? null,
    };
}

const dir = (name) => ({ name, isDirectory: true });
const file = (name) => ({ name, isDirectory: false });

/** A tree with one scoped package carrying a darwin-x64 typelib. */
function webkitTree({ target = 'darwin-x64', typelib = 'WebKit-6.0.typelib' } = {}) {
    const root = '/app';
    const nm = `${root}/node_modules`;
    const pkg = `${nm}/@gjsify/webkit-native-darwin-x64`;
    const prebuild = `${pkg}/prebuilds/${target}`;
    return {
        root,
        prebuild,
        fs: fakeFs({
            dirs: {
                [nm]: [dir('@gjsify')],
                [`${nm}/@gjsify`]: [dir('webkit-native-darwin-x64')],
                [pkg]: [dir('prebuilds')],
                [`${pkg}/prebuilds`]: [dir(target)],
                [prebuild]: [file(typelib), file('libgjsifywebkit.dylib')],
            },
            manifests: {
                [`${pkg}/package.json`]: {
                    name: '@gjsify/webkit-native-darwin-x64',
                    gjsify: { prebuilds: 'prebuilds', platforms: [target] },
                },
            },
        }),
    };
}

test('finds a scoped package whose prebuild dir carries a typelib', () => {
    const { root, prebuild, fs } = webkitTree();
    const found = discoverPrebuiltTypelibDirs({ startDir: root, platform: 'darwin', arch: 'x64', fs });
    assert.deepEqual(found, [prebuild]);
});

test('resolves the target from the parameters, not from the host', () => {
    // The same tree, asked for a target it does not carry. This is the branch that
    // would otherwise only ever be exercised on the platform in question.
    const { root, fs } = webkitTree({ target: 'darwin-x64' });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: root, platform: 'win32', arch: 'x64', fs }), []);
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: root, platform: 'darwin', arch: 'arm64', fs }), []);
});

test('ignores a declared prebuild dir that ships no typelib', () => {
    // A package may declare prebuilds and ship only a .node addon or a bare dylib.
    // Adding those directories would put noise on GI's search path for no namespace.
    const { root, fs } = webkitTree({ typelib: 'node_gi.node' });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: root, platform: 'darwin', arch: 'x64', fs }), []);
});

test('leaves gtk-runtime-* to the GTK activation', () => {
    // Which GTK a process uses is a policy decision (ADR 0023) applied in
    // gtk-runtime.js. Prepending the bundle from here too would put a second copy of
    // the same typelibs on the path and defeat a gtkSource() of "system" — the
    // two-copies hazard #920 records.
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/gtk-runtime-darwin-x64`;
    const prebuild = `${pkg}/prebuilds/darwin-x64`;
    const fs = fakeFs({
        dirs: {
            [nm]: [dir('@gjsify')],
            [`${nm}/@gjsify`]: [dir('gtk-runtime-darwin-x64')],
            [pkg]: [dir('prebuilds')],
            [`${pkg}/prebuilds`]: [dir('darwin-x64')],
            [prebuild]: [file('Gtk-4.0.typelib')],
        },
        manifests: {
            [`${pkg}/package.json`]: {
                name: '@gjsify/gtk-runtime-darwin-x64',
                gjsify: { prebuilds: 'prebuilds' },
            },
        },
    });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: '/app', platform: 'darwin', arch: 'x64', fs }), []);
});

test('accepts a typelib the walk reports as a symlink', () => {
    // The real `readDir` widens "directory" to include symlinks, because that is how
    // npm and pnpm place a workspace package and the walk has to follow one. An
    // earlier revision then tested the typelib with `!isDirectory && endsWith(...)`,
    // which silently dropped a SYMLINKED typelib — the exact layout a linked
    // workspace install produces. The suffix alone is the honest test.
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/webkit-native-darwin-x64`;
    const prebuild = `${pkg}/prebuilds/darwin-x64`;
    const fs = fakeFs({
        dirs: {
            [nm]: [dir('@gjsify')],
            [`${nm}/@gjsify`]: [dir('webkit-native-darwin-x64')],
            [pkg]: [dir('prebuilds')],
            [`${pkg}/prebuilds`]: [dir('darwin-x64')],
            // isDirectory: true is what a symlinked typelib looks like to readDir.
            [prebuild]: [dir('WebKit-6.0.typelib')],
        },
        manifests: {
            [`${pkg}/package.json`]: {
                name: '@gjsify/webkit-native-darwin-x64',
                gjsify: { prebuilds: 'prebuilds' },
            },
        },
    });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: '/app', platform: 'darwin', arch: 'x64', fs }), [
        prebuild,
    ]);
});

test('ignores a package that declares no prebuilds', () => {
    const nm = '/app/node_modules';
    const pkg = `${nm}/left-pad`;
    const fs = fakeFs({
        dirs: { [nm]: [dir('left-pad')], [pkg]: [] },
        manifests: { [`${pkg}/package.json`]: { name: 'left-pad' } },
    });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: '/app', platform: 'darwin', arch: 'x64', fs }), []);
});

test('walks up, and reports the nearest install first', () => {
    // npm may hoist the per-target package to the root or nest it under its parent,
    // and both are correct installs. Nearest-first matters because a prepend makes
    // the LAST one win, and the activation reverses this order to preserve it.
    const inner = '/app/packages/leaf/node_modules';
    const outer = '/app/node_modules';
    const innerPkg = `${inner}/@gjsify/webkit-native-darwin-x64`;
    const outerPkg = `${outer}/@gjsify/webkit-native-darwin-x64`;
    const manifest = {
        name: '@gjsify/webkit-native-darwin-x64',
        gjsify: { prebuilds: 'prebuilds' },
    };
    const fs = fakeFs({
        dirs: {
            [inner]: [dir('@gjsify')],
            [`${inner}/@gjsify`]: [dir('webkit-native-darwin-x64')],
            [innerPkg]: [dir('prebuilds')],
            [`${innerPkg}/prebuilds`]: [dir('darwin-x64')],
            [`${innerPkg}/prebuilds/darwin-x64`]: [file('WebKit-6.0.typelib')],
            [outer]: [dir('@gjsify')],
            [`${outer}/@gjsify`]: [dir('webkit-native-darwin-x64')],
            [outerPkg]: [dir('prebuilds')],
            [`${outerPkg}/prebuilds`]: [dir('darwin-x64')],
            [`${outerPkg}/prebuilds/darwin-x64`]: [file('WebKit-6.0.typelib')],
        },
        manifests: {
            [`${innerPkg}/package.json`]: manifest,
            [`${outerPkg}/package.json`]: manifest,
        },
    });
    const found = discoverPrebuiltTypelibDirs({
        startDir: '/app/packages/leaf',
        platform: 'darwin',
        arch: 'x64',
        fs,
    });
    assert.deepEqual(found, [join(innerPkg, 'prebuilds', 'darwin-x64'), join(outerPkg, 'prebuilds', 'darwin-x64')]);
});

test('de-duplicates a directory reachable twice', () => {
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/webkit-native-darwin-x64`;
    const prebuild = `${pkg}/prebuilds/darwin-x64`;
    const fs = fakeFs({
        dirs: {
            [nm]: [dir('@gjsify'), dir('@gjsify')],
            [`${nm}/@gjsify`]: [dir('webkit-native-darwin-x64')],
            [pkg]: [dir('prebuilds')],
            [`${pkg}/prebuilds`]: [dir('darwin-x64')],
            [prebuild]: [file('WebKit-6.0.typelib')],
        },
        manifests: {
            [`${pkg}/package.json`]: {
                name: '@gjsify/webkit-native-darwin-x64',
                gjsify: { prebuilds: 'prebuilds' },
            },
        },
    });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: '/app', platform: 'darwin', arch: 'x64', fs }), [
        prebuild,
    ]);
});

// ---- THE ACTIVATION ---------------------------------------------------------
//
// Discovery returns nearest-first, but GI only ever sees what `prependSearchPath`
// hands it, and a prepend makes the LAST call win. The order the search path ends
// up in is therefore a property of the activation, not of the discovery, and the
// same assertions `gi-library-path.test.mjs` makes about `activateGiLibraryPath`
// apply here: reported == handed, the reported order survives the prepend, and it
// runs at most once. Without these, a reversed loop or a dropped `unshift` would
// leave every test above green while a HOISTED copy shadowed a nested one.

/** Two installs of the same package, one nearer the start dir than the other. */
function twoInstallTree() {
    const near = '/app/node_modules/@gjsify/webkit-native-darwin-x64';
    const far = '/node_modules/@gjsify/webkit-native-darwin-x64';
    const manifest = { name: '@gjsify/webkit-native-darwin-x64', gjsify: { prebuilds: 'prebuilds' } };
    const dirs = {};
    const manifests = {};
    for (const [nm, pkg] of [
        ['/app/node_modules', near],
        ['/node_modules', far],
    ]) {
        dirs[nm] = [dir('@gjsify')];
        dirs[`${nm}/@gjsify`] = [dir('webkit-native-darwin-x64')];
        dirs[pkg] = [dir('prebuilds')];
        dirs[`${pkg}/prebuilds`] = [dir('darwin-x64')];
        dirs[`${pkg}/prebuilds/darwin-x64`] = [file('WebKit-6.0.typelib')];
        manifests[`${pkg}/package.json`] = manifest;
    }
    return {
        fs: fakeFs({ dirs, manifests }),
        near: `${near}/prebuilds/darwin-x64`,
        far: `${far}/prebuilds/darwin-x64`,
        options: { startDir: '/app', platform: 'darwin', arch: 'x64' },
    };
}

/** An addon stub recording what the activation handed to GI, in call order. */
function recordingNative() {
    const search = [];
    const library = [];
    return { search, library, prependSearchPath: (p) => search.push(p), prependLibraryPath: (p) => library.push(p) };
}

test('an addon without the binding is left completely alone', () => {
    resetNativePrebuildsForTests();
    // Predates `prependSearchPath`: the search path must stay exactly as it was,
    // which is the state before this module existed.
    assert.deepEqual(activateNativePrebuilds({}), []);
    resetNativePrebuildsForTests();
    assert.deepEqual(activateNativePrebuilds(undefined), []);
});

test('it runs at most once', () => {
    resetNativePrebuildsForTests();
    const { fs, options } = twoInstallTree();
    const native = recordingNative();
    activateNativePrebuilds(native, { ...options, fs });
    const afterFirst = native.search.length;
    assert.equal(afterFirst, 2);
    // index.js activates at import time; a consumer calling it again would
    // otherwise grow GI's search path by the whole set on every call.
    assert.deepEqual(activateNativePrebuilds(native, { ...options, fs }).length, 2);
    assert.equal(native.search.length, afterFirst);
});

test('every directory it reports was actually handed to GI, on both paths', () => {
    resetNativePrebuildsForTests();
    const { fs, options } = twoInstallTree();
    const native = recordingNative();
    const applied = activateNativePrebuilds(native, { ...options, fs });
    // The return value is the claim, `search` is what happened. Drift between them
    // would make "nothing to add" indistinguishable from a silent failure.
    assert.deepEqual([...native.search].sort(), [...applied].sort());
    // A typelib is half an answer: the library it names sits in the same directory,
    // so both paths get the same set.
    assert.deepEqual(native.library, native.search);
});

test('the nearest install still wins after the prepend', () => {
    resetNativePrebuildsForTests();
    const { fs, near, far, options } = twoInstallTree();
    const native = recordingNative();
    const applied = activateNativePrebuilds(native, { ...options, fs });
    assert.deepEqual(applied, [near, far]);
    // LAST prepend wins, so the activation walks in reverse; what GI ends up
    // searching FIRST must still be the nearest install.
    assert.deepEqual([...native.search].reverse(), applied);
});

test('a directory GI refuses is skipped without losing the rest', () => {
    resetNativePrebuildsForTests();
    const { fs, near, far, options } = twoInstallTree();
    const native = recordingNative();
    const reject = far;
    const guarded = {
        prependSearchPath: (p) => {
            if (p === reject) throw new TypeError('prependSearchPath(path: string)');
            native.search.push(p);
        },
        prependLibraryPath: (p) => native.library.push(p),
    };
    // Never fatal, and never a half-truth either: a directory GI would not take
    // must not appear in the returned claim.
    assert.deepEqual(activateNativePrebuilds(guarded, { ...options, fs }), [near]);
    assert.deepEqual(native.search, [near]);
});
