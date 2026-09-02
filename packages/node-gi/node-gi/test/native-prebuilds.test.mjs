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
    resolveHostMusl,
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
    // A guard against a shape that does not exist YET, and the test says so rather
    // than implying it is load-bearing today: no published gtk-runtime package
    // declares `gjsify.prebuilds`, and their bundle lives at `<pkg>/gtk/` rather than
    // under a declared prebuilds dir, so this walk would not reach one anyway. The
    // manifest below therefore FABRICATES the key, to pin the behaviour if that ever
    // changes. Which GTK a process uses is a policy decision (ADR 0023) applied in
    // gtk-runtime.js against `gtkSource()`; a second copy of those typelibs on the
    // path is the hazard #920 records.
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

// ---------------------------------------------------------------------------
// The second pass, and the target spelling. Both were found by review: the first
// revision reimplemented pass 1 of `detect-native-packages.ts`'s two-pass algorithm,
// whose own comment says pass 1 is insufficient, and hardcoded `${platform}-${arch}`
// against a repo whose `hostPlatformTokens()` calls itself the single definition.
// ---------------------------------------------------------------------------

/** A facade declaring prebuilds, with its per-target companion placed by `where`. */
function splitTree({ where, target = 'darwin-x64' }) {
    const root = '/app';
    const rootNm = `${root}/node_modules`;
    const facade = `${rootNm}/@gjsify/webkit-native`;
    const companionNm = where === 'nested' ? `${facade}/node_modules` : rootNm;
    const companion = `${companionNm}/@gjsify/webkit-native-${target}`;
    const prebuild = `${companion}/prebuilds/${target}`;
    const dirs = {
        [rootNm]: [dir('@gjsify')],
        [`${rootNm}/@gjsify`]:
            where === 'nested' ? [dir('webkit-native')] : [dir('webkit-native'), dir(`webkit-native-${target}`)],
        // NO `prebuilds` directory on the facade, which is the real shape:
        // `@gjsify/webkit-native` declares the key and ships `"files": []`. An earlier
        // fixture gave it an empty one, and that single wrong detail let a pre-filter
        // that skipped the facade — and so skipped the sibling walk — pass this test
        // while failing on a real nested install.
        [facade]: [],
        [companion]: [dir('prebuilds')],
        [`${companion}/prebuilds`]: [dir(target)],
        [prebuild]: [file('WebKit-6.0.typelib'), file('libgjsifywebkit.dylib')],
    };
    if (where === 'nested') {
        dirs[companionNm] = [dir('@gjsify')];
        dirs[`${companionNm}/@gjsify`] = [dir(`webkit-native-${target}`)];
    }
    return {
        root,
        prebuild,
        fs: fakeFs({
            dirs,
            manifests: {
                [`${facade}/package.json`]: {
                    name: '@gjsify/webkit-native',
                    gjsify: { prebuilds: 'prebuilds', platforms: [target] },
                },
                [`${companion}/package.json`]: {
                    name: `@gjsify/webkit-native-${target}`,
                    gjsify: { prebuilds: 'prebuilds', platforms: [target] },
                },
            },
        }),
    };
}

test('resolves the companion when npm hoists it beside the facade', () => {
    const { root, prebuild, fs } = splitTree({ where: 'hoisted' });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: root, platform: 'darwin', arch: 'x64', fs }), [prebuild]);
});

test('resolves the companion when it is NESTED under a DECLARING facade', () => {
    // Walking up from node-gi never enters the facade's own `node_modules`, so pass one
    // cannot see this; the second pass restarts from the declaring package's directory.
    //
    // "DECLARING" is load-bearing and the fixture below is deliberate about it: this
    // covers a facade that carries `gjsify.prebuilds`. The published
    // `@gjsify/webkit-native` does NOT — it declares only `gjsify.platforms` and two
    // optionalDependencies — so a companion nested under THAT one is found by neither
    // this resolver nor the CLI's, for want of a candidate to start from. Measured on a
    // real darwin install; recorded in the module header rather than papered over.
    const { root, prebuild, fs } = splitTree({ where: 'nested' });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: root, platform: 'darwin', arch: 'x64', fs }), [prebuild]);
});

test('loads a pre-rename tarball under the legacy uname spelling', () => {
    // AGENTS.md keeps `linux-x86_64` READ-only so tarballs published before the rename
    // still load. A single `${platform}-${arch}` probe cannot see one.
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/tls-native-linux-x86_64`;
    const prebuild = `${pkg}/prebuilds/linux-x86_64`;
    const fs = fakeFs({
        dirs: {
            [nm]: [dir('@gjsify')],
            [`${nm}/@gjsify`]: [dir('tls-native-linux-x86_64')],
            [pkg]: [dir('prebuilds')],
            [`${pkg}/prebuilds`]: [dir('linux-x86_64')],
            [prebuild]: [file('GjsifyTls-1.0.typelib')],
        },
        manifests: {
            [`${pkg}/package.json`]: {
                name: '@gjsify/tls-native-linux-x86_64',
                gjsify: { prebuilds: 'prebuilds', platforms: ['linux-x86_64'] },
            },
        },
    });
    assert.deepEqual(discoverPrebuiltTypelibDirs({ startDir: '/app', platform: 'linux', arch: 'x64', fs }), [prebuild]);
});

test('prefers the musl directory on a musl host, and only on linux', () => {
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/x-linux-x64`;
    const fs = fakeFs({
        dirs: {
            [nm]: [dir('@gjsify')],
            [`${nm}/@gjsify`]: [dir('x-linux-x64')],
            [pkg]: [dir('prebuilds')],
            [`${pkg}/prebuilds`]: [dir('linux-x64'), dir('linux-x64-musl')],
            [`${pkg}/prebuilds/linux-x64`]: [file('X-1.0.typelib')],
            [`${pkg}/prebuilds/linux-x64-musl`]: [file('X-1.0.typelib')],
        },
        manifests: {
            [`${pkg}/package.json`]: { name: '@gjsify/x-linux-x64', gjsify: { prebuilds: 'prebuilds' } },
        },
    });
    const musl = discoverPrebuiltTypelibDirs({
        startDir: '/app',
        platform: 'linux',
        arch: 'x64',
        musl: true,
        fs,
    });
    assert.deepEqual(musl, [`${pkg}/prebuilds/linux-x64-musl`]);
    const glibc = discoverPrebuiltTypelibDirs({
        startDir: '/app',
        platform: 'linux',
        arch: 'x64',
        musl: false,
        fs,
    });
    assert.deepEqual(glibc, [`${pkg}/prebuilds/linux-x64`]);
});

// ---------------------------------------------------------------------------
// The two decisions this module COPIES from `detect-native-packages.ts`. Both had
// drifted: the copy compiled, passed every test above, and answered differently
// from the file it names as its source — which is the only failure mode a copy has.
// ---------------------------------------------------------------------------

/** One package that both DECLARES and STAGES `spelling`, and nothing else. */
function declaredSpellingTree(spelling) {
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/x-native`;
    return {
        prebuild: `${pkg}/prebuilds/${spelling}`,
        fs: fakeFs({
            dirs: {
                [nm]: [dir('@gjsify')],
                [`${nm}/@gjsify`]: [dir('x-native')],
                [pkg]: [dir('prebuilds')],
                [`${pkg}/prebuilds`]: [dir(spelling)],
                [`${pkg}/prebuilds/${spelling}`]: [file('X-1.0.typelib')],
            },
            manifests: {
                [`${pkg}/package.json`]: {
                    name: '@gjsify/x-native',
                    gjsify: { prebuilds: 'prebuilds', platforms: [spelling] },
                },
            },
        }),
    };
}

test('resolves every spelling the CLI resolves for this host', () => {
    // Measured against `resolvePrebuildDirName()` itself, not against a reading of
    // it: the CLI answers all five, and this module answered two. `linux-amd64` and
    // `linux-aarch64` need `canonicalPlatformToken`'s arch folding (the declared
    // probe compared RAW strings, so it could only ever match a token the line after
    // it pushed anyway — dead code wearing a comment that claimed otherwise);
    // `linux-armv7` and `linux-i686` need the two rows the legacy table was missing.
    for (const [spelling, platform, arch] of [
        ['linux-x86_64', 'linux', 'x64'],
        ['linux-amd64', 'linux', 'x64'],
        ['linux-aarch64', 'linux', 'arm64'],
        ['linux-armv7', 'linux', 'arm'],
        ['linux-i686', 'linux', 'ia32'],
    ]) {
        const { prebuild, fs } = declaredSpellingTree(spelling);
        assert.deepEqual(
            discoverPrebuiltTypelibDirs({ startDir: '/app', platform, arch, musl: false, fs }),
            [prebuild],
            `declared + staged "${spelling}" on ${platform}-${arch}`,
        );
    }
});

test('the declared spelling is probed BEFORE the canonical one', () => {
    // A pre-rename tarball that ships BOTH directories must load the one it declares;
    // order is the only thing that decides it, and the two are indistinguishable to a
    // test that ships only one.
    const nm = '/app/node_modules';
    const pkg = `${nm}/@gjsify/x-native`;
    const fs = fakeFs({
        dirs: {
            [nm]: [dir('@gjsify')],
            [`${nm}/@gjsify`]: [dir('x-native')],
            [pkg]: [dir('prebuilds')],
            [`${pkg}/prebuilds`]: [dir('linux-x64'), dir('linux-x86_64')],
            [`${pkg}/prebuilds/linux-x64`]: [file('X-1.0.typelib')],
            [`${pkg}/prebuilds/linux-x86_64`]: [file('X-1.0.typelib')],
        },
        manifests: {
            [`${pkg}/package.json`]: {
                name: '@gjsify/x-native',
                gjsify: { prebuilds: 'prebuilds', platforms: ['linux-x86_64'] },
            },
        },
    });
    assert.deepEqual(
        discoverPrebuiltTypelibDirs({ startDir: '/app', platform: 'linux', arch: 'x64', musl: false, fs }),
        [`${pkg}/prebuilds/linux-x86_64`],
    );
});

test('a host that cannot answer the glibc probe is glibc, not musl', () => {
    // `process.report` is a NODE-only API. It does not answer on bun, on deno, or
    // under GJS — three of the four runtimes node-gi loads on. Reading that silence
    // as "musl" made every one of them prefer a `-musl` directory on an ordinary
    // glibc host, and a musl-linked library staged there cannot load on the platform
    // it would then be chosen for: a silent wrong artifact, not a loud refusal.
    assert.equal(resolveHostMusl({ platform: 'linux' }), false);
    assert.equal(resolveHostMusl({ platform: 'linux', muslLoaderPresent: false }), false);
    // The loader is the fact that answers where the report cannot.
    assert.equal(resolveHostMusl({ platform: 'linux', muslLoaderPresent: true }), true);
    // A glibc-linked process on a host that ALSO installs musl (gcompat) is glibc:
    // the report is about the running process and wins.
    assert.equal(resolveHostMusl({ platform: 'linux', glibcVersionRuntime: '2.41', muslLoaderPresent: true }), false);
    // Linux-only, as npm's own `libc` field is. A caller's host facts do not get to
    // invent a target the grammar does not have.
    assert.equal(resolveHostMusl({ platform: 'darwin', muslLoaderPresent: true }), false);
    assert.equal(resolveHostMusl({ platform: 'win32', muslLoaderPresent: true }), false);
});
