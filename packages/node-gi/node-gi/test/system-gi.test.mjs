// SPDX-License-Identifier: MIT
// @gjsify/node-gi — systemGiLibraryDirs() / pathCovers() unit spec.
//
// Runs on EVERY platform (no addon, no GI, no display): the whole point of
// `systemGiLibraryDirs()` taking its host facts as parameters is that the darwin
// branch is verifiable from a Linux host, exactly like the CLI's
// `resolvePrebuildDirName()`. The FUNCTIONAL half — that these directories make a
// bare-leaf `dlopen` succeed — can only be proved on a real Mac and is gated by
// the `macos` job's env-free GTK step (see .github/workflows/node-gi.yml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    composeDyldFallback,
    dyldDefaultFallbackDirs,
    pathCovers,
    splitSearchPath,
    systemGiLibraryDirs,
} from '../system-gi.js';

/** A `pkg-config` stub: no spawn, so the spec never depends on the host having it. */
const noPkgConfig = () => [];
/** An `existsDir` stub over an explicit allow-list. */
const dirsExist = (present) => (dir) => present.includes(dir);

test('systemGiLibraryDirs: no directories off darwin', () => {
    // Linux resolves typelib backers through ld.so's configured cache and Windows
    // re-reads its DLL search path per LoadLibrary — neither needs this.
    for (const platform of ['linux', 'win32', 'freebsd']) {
        assert.deepEqual(
            systemGiLibraryDirs({
                platform,
                env: { GI_TYPELIB_PATH: '/usr/local/lib/girepository-1.0' },
                existsDir: () => true,
                searchDirs: noPkgConfig,
            }),
            [],
            `${platform} must need no loader-path repair`,
        );
    }
});

test('systemGiLibraryDirs: finds the Homebrew x64 prefix by its typelib marker', () => {
    // The reported host: GI stack under /usr/local, GI_TYPELIB_PATH unset,
    // pkg-config unavailable to the test. This is the directory measured to fix
    // the reported failure.
    assert.deepEqual(
        systemGiLibraryDirs({
            platform: 'darwin',
            env: {},
            existsDir: dirsExist(['/usr/local/lib/girepository-1.0']),
            searchDirs: noPkgConfig,
        }),
        ['/usr/local/lib'],
    );
});

test('systemGiLibraryDirs: finds the Apple-silicon and MacPorts prefixes too', () => {
    // Same code path, different prefix — the reason nothing here hardcodes one.
    assert.deepEqual(
        systemGiLibraryDirs({
            platform: 'darwin',
            env: {},
            existsDir: dirsExist(['/opt/homebrew/lib/girepository-1.0']),
            searchDirs: noPkgConfig,
        }),
        ['/opt/homebrew/lib'],
    );
    assert.deepEqual(
        systemGiLibraryDirs({
            platform: 'darwin',
            env: {},
            existsDir: dirsExist(['/opt/local/lib/girepository-1.0']),
            searchDirs: noPkgConfig,
        }),
        ['/opt/local/lib'],
    );
});

test('systemGiLibraryDirs: a prefix without the marker is NOT believed', () => {
    // A bare /usr/local/lib (no GI installed) must not be added — the marker is
    // what separates "a GI stack lives here" from "this path exists".
    assert.deepEqual(
        systemGiLibraryDirs({
            platform: 'darwin',
            env: {},
            existsDir: dirsExist(['/usr/local/lib']),
            searchDirs: noPkgConfig,
        }),
        [],
    );
});

test('systemGiLibraryDirs: pkg-config finds a prefix nobody hardcoded', () => {
    // The general mechanism: pkg-config's own pc_path names <libdir>/pkgconfig, so
    // a jhbuild/custom prefix is discovered without being listed anywhere.
    assert.deepEqual(
        systemGiLibraryDirs({
            platform: 'darwin',
            env: {},
            existsDir: dirsExist(['/opt/gnome/lib/girepository-1.0']),
            searchDirs: () => ['/opt/gnome/lib/pkgconfig', '/opt/gnome/share/pkgconfig'],
        }),
        ['/opt/gnome/lib'],
        'only the pkgconfig dir whose parent holds girepository-1.0 is taken',
    );
});

test('systemGiLibraryDirs: GI_TYPELIB_PATH wins, on existence alone', () => {
    // An explicit host statement is not second-guessed with the marker probe: the
    // typelib dir need not be named girepository-1.0 (a relocated bundle is not).
    const dirs = systemGiLibraryDirs({
        platform: 'darwin',
        env: { GI_TYPELIB_PATH: '/opt/mystack/lib/typelibs:/usr/local/lib/girepository-1.0' },
        existsDir: dirsExist(['/opt/mystack/lib', '/usr/local/lib', '/usr/local/lib/girepository-1.0']),
        searchDirs: noPkgConfig,
    });
    assert.deepEqual(dirs, ['/opt/mystack/lib', '/usr/local/lib']);
    assert.equal(dirs[0], '/opt/mystack/lib', 'GI_TYPELIB_PATH order is preserved and comes first');
});

test('systemGiLibraryDirs: deduplicates and never yields the filesystem root', () => {
    const dirs = systemGiLibraryDirs({
        platform: 'darwin',
        // A one-segment typelib path would make dirname() the root — never useful,
        // and adding "/" to a loader search path is actively hostile.
        env: { GI_TYPELIB_PATH: '/girepository-1.0:/usr/local/lib/girepository-1.0' },
        existsDir: dirsExist(['/', '/usr/local/lib', '/usr/local/lib/girepository-1.0']),
        searchDirs: () => ['/usr/local/lib/pkgconfig'],
    });
    assert.deepEqual(dirs, ['/usr/local/lib'], 'root dropped, /usr/local/lib listed once');
});

test('pathCovers: the re-exec suppression test', () => {
    // What keeps a CI job / launcher that already exported the variable — and the
    // re-exec'd child itself — from re-execing.
    assert.equal(pathCovers(['/usr/local/lib'], ['/usr/local/lib', '/usr/lib']), true);
    assert.equal(pathCovers(['/usr/local/lib'], ['/usr/lib']), false);
    assert.equal(pathCovers(['/a', '/b'], ['/a']), false, 'partial coverage is not coverage');
    assert.equal(pathCovers([], ['/usr/lib']), true, 'nothing wanted is trivially covered');
});

test('composeDyldFallback: carries dyld’s whole default list', () => {
    // `DYLD_FALLBACK_LIBRARY_PATH` REPLACES dyld's default list rather than
    // extending it, so a composition that omits part of it hands the re-exec'd
    // child a SMALLER search path than the process that spawned it. This used to
    // append a bare `/usr/lib`, which dropped `/usr/local/lib` — where every
    // Homebrew GTK library lives on Intel macOS — and killed every gjs command
    // gjsify launched on such a Mac, `dlopen(libsoup-3.0.0.dylib)` first.
    const env = { HOME: '/Users/dev' };
    assert.deepEqual(dyldDefaultFallbackDirs(env), ['/Users/dev/lib', '/usr/local/lib', '/lib', '/usr/lib']);

    const entries = composeDyldFallback(['/opt/homebrew/lib'], env).split(':');
    assert.equal(entries[0], '/opt/homebrew/lib', 'our dirs out-rank the defaults');
    for (const dir of dyldDefaultFallbackDirs(env)) {
        assert.ok(entries.includes(dir), `${dir} must survive the composition`);
    }
    assert.equal(entries.length, new Set(entries).size, 'no directory is searched twice');
});

test('composeDyldFallback: an inherited value sits between ours and the defaults', () => {
    const entries = composeDyldFallback(['/opt/homebrew/lib'], {
        DYLD_FALLBACK_LIBRARY_PATH: '/opt/ci/lib',
    }).split(':');
    assert.equal(entries[0], '/opt/homebrew/lib');
    assert.equal(entries[1], '/opt/ci/lib', 'the host asked for it, so it stays ahead of the defaults');
    assert.ok(entries.includes('/usr/local/lib'), 'and the defaults are still appended behind it');
});

test('dyldDefaultFallbackDirs: omits $HOME/lib when there is no HOME', () => {
    assert.deepEqual(dyldDefaultFallbackDirs({}), ['/usr/local/lib', '/lib', '/usr/lib']);
});

test('splitSearchPath: drops empty segments', () => {
    assert.deepEqual(splitSearchPath('/a::/b:'), ['/a', '/b']);
    assert.deepEqual(splitSearchPath(undefined), []);
    assert.deepEqual(splitSearchPath('a;b', ';'), ['a', 'b']);
});
