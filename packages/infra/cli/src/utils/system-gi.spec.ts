// SPDX-License-Identifier: MIT
//
// Runs on EVERY platform (no GI, no addon, no display): `systemGiLibraryDirs()`
// takes its host facts as parameters so the darwin branch is verifiable from a
// Linux host. Nothing here reads `process.platform`, `process.env` or the real
// filesystem.
//
// The FUNCTIONAL half — that these directories actually make a bare-leaf `dlopen`
// succeed under `gjs` — is provable only on a real Mac. Measured on the macOS
// 15.7.8 x86_64 test VM: with them on the child's `DYLD_FALLBACK_LIBRARY_PATH`,
// `gjsify run` loads `Gtk` and `Adw`; without them it dies in `g_module_open`.
// Trace in `system-gi.ts`.
//
// The last suite is the AGREEMENT check that keeps this module a mirror rather
// than a fork — see `system-gi.ts`'s "A DELIBERATE MIRROR" header.

import { describe, expect, it } from '@gjsify/unit';

import {
    composeDyldFallback,
    dyldDefaultFallbackDirs,
    giLibraryDirsForTypelibDir,
    pathCovers,
    splitSearchPath,
    systemGiLibraryDirs,
    type SystemGiOptions,
} from './system-gi.js';

// The ORIGINAL, reached across the repo by relative path. A spec may do this where
// the shipped module may not: `src/*.spec.ts` is bundled only into
// `dist/test.node.mjs`, never into the published `lib/`, so this import creates no
// `dependencies` edge and ADR 0005 Decision 2 is untouched.
import * as nodeGi from '../../../../node-gi/node-gi/system-gi.js';

/** A `pkg-config` stub: no spawn, so the spec never depends on the host having it. */
const noPkgConfig = () => [];
/** An `existsDir` stub over an explicit allow-list. */
const dirsExist =
    (present: readonly string[]) =>
    (dir: string): boolean =>
        present.includes(dir);

export default async () => {
    await describe('systemGiLibraryDirs (host facts injected)', async () => {
        await it('yields nothing off darwin — a statement about LOADERS', async () => {
            // Linux resolves typelib backers through ld.so's system-wide configured
            // cache (/etc/ld.so.conf.d), which a package install populates; Windows
            // re-reads its DLL search path at every LoadLibrary. dyld consults
            // neither a system config nor a post-launch change — why exactly one
            // platform is listed in PROBED_GI_LIBDIRS.
            for (const platform of ['linux', 'freebsd', 'android']) {
                expect(
                    systemGiLibraryDirs({
                        platform,
                        // Everything an answer could derive from is present and still
                        // yields nothing — the platform gate is first.
                        env: { GI_TYPELIB_PATH: '/usr/local/lib/girepository-1.0' },
                        existsDir: () => true,
                        searchDirs: () => ['/usr/local/lib/pkgconfig'],
                    }),
                ).toStrictEqual([]);
            }
        });

        await it('yields nothing on win32, deliberately rather than by proof', async () => {
            // Windows is ABSENT from the table on purpose: `PATH` is the DLL search
            // path, a Windows GTK distribution puts its own `bin` on it, and
            // `LoadLibrary` re-reads it per call — so an unreachable system GTK is
            // repaired by a PATH prepend (as `buildNativeEnv` already does for
            // prebuilds), not by a second variable.
            expect(
                systemGiLibraryDirs({
                    platform: 'win32',
                    env: { GI_TYPELIB_PATH: 'C:\\msys64\\mingw64\\lib\\girepository-1.0' },
                    existsDir: () => true,
                    searchDirs: noPkgConfig,
                }),
            ).toStrictEqual([]);
        });

        await it('finds the Homebrew x64 prefix by its girepository-1.0 marker', async () => {
            // The measured host: GI stack under /usr/local, GI_TYPELIB_PATH unset, no
            // pkg-config. `/usr/local/lib` resolves every leaf because it is the UNION
            // every Homebrew keg is symlinked into.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/usr/local/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                }),
            ).toStrictEqual(['/usr/local/lib']);
        });

        await it('finds the Apple-silicon and MacPorts prefixes through the same path', async () => {
            // Same code, different prefix — the reason nothing here hardcodes one.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/opt/homebrew/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                }),
            ).toStrictEqual(['/opt/homebrew/lib']);
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/opt/local/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                }),
            ).toStrictEqual(['/opt/local/lib']);
        });

        await it('does NOT believe a guessed prefix that lacks the marker', async () => {
            // The marker separates "a GI stack lives here" from "this path exists",
            // and putting a non-GI system libdir on a loader search path is not free.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/usr/local/lib', '/opt/homebrew/lib', '/opt/local/lib']),
                    searchDirs: () => ['/usr/local/lib/pkgconfig'],
                }),
            ).toStrictEqual([]);
        });

        await it('lets pkg-config find a prefix nobody hardcoded', async () => {
            // pkg-config's own pc_path names <libdir>/pkgconfig, so a jhbuild or
            // otherwise bespoke prefix is discovered without being listed anywhere.
            // The share/ entry is dropped: only a `pkgconfig` basename whose parent
            // holds the marker counts.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/opt/gnome/lib/girepository-1.0']),
                    searchDirs: () => ['/opt/gnome/lib/pkgconfig', '/opt/gnome/share/pkgconfig'],
                }),
            ).toStrictEqual(['/opt/gnome/lib']);
        });

        await it('reads PKG_CONFIG_PATH through the same source', async () => {
            // `pkgConfigSearchDirs` prepends $PKG_CONFIG_PATH to pkg-config's own
            // pc_path, so a user-pointed prefix is source 2 as well. Injected via the
            // real splitting rule rather than a hand-built array.
            const env = { PKG_CONFIG_PATH: '/opt/custom/lib/pkgconfig' };
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env,
                    existsDir: dirsExist(['/opt/custom/lib/girepository-1.0']),
                    searchDirs: (e) => splitSearchPath(e['PKG_CONFIG_PATH']),
                }),
            ).toStrictEqual(['/opt/custom/lib']);
        });

        await it('accepts GI_TYPELIB_PATH on directory existence ALONE', async () => {
            // An explicit host statement is not second-guessed with the marker probe:
            // a relocated bundle's typelib dir is not named `girepository-1.0`, and
            // requiring the marker would reject it.
            const dirs = systemGiLibraryDirs({
                platform: 'darwin',
                env: { GI_TYPELIB_PATH: '/opt/mystack/lib/typelibs' },
                existsDir: dirsExist(['/opt/mystack/lib']),
                searchDirs: noPkgConfig,
            });
            expect(dirs).toStrictEqual(['/opt/mystack/lib']);
        });

        await it('reads a STAGED typelib dir as its own libdir', async () => {
            // The defect: an ADR 0017 prebuild directory holds `WebKit-6.0.typelib`
            // AND `libgjsifywebkit.dylib`, so GI's install layout — typelibs one level
            // BELOW the libraries — does not describe it, and `dirname()` alone named
            // the prebuilds/ parent, a real directory holding nothing. Measured on the
            // macOS 15.7.9 VM: the typelib resolved and its backer never did.
            const staged = '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds/darwin-x64';
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: { GI_TYPELIB_PATH: staged },
                    existsDir: dirsExist([staged, '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds']),
                    searchDirs: noPkgConfig,
                })[0],
            ).toBe(staged);
        });

        await it('offers only the parent for GI’s own install layout', async () => {
            // `<libdir>/girepository-1.0/` holds no library, so it must not reach a
            // loader search path — which is why the marker DECIDES rather than a probe
            // offering both everywhere.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    env: { GI_TYPELIB_PATH: '/usr/local/lib/girepository-1.0' },
                    existsDir: dirsExist(['/usr/local/lib', '/usr/local/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                }),
            ).toStrictEqual(['/usr/local/lib']);
        });

        await it('ranks the three sources most-specific-first', async () => {
            // All three sources live at once: GI_TYPELIB_PATH (in its own given
            // order) → pkg-config → probed prefixes.
            const dirs = systemGiLibraryDirs({
                platform: 'darwin',
                env: { GI_TYPELIB_PATH: '/opt/mystack/lib/typelibs:/opt/second/lib/girepository-1.0' },
                existsDir: dirsExist([
                    '/opt/mystack/lib',
                    '/opt/second/lib',
                    '/opt/gnome/lib/girepository-1.0',
                    '/usr/local/lib/girepository-1.0',
                ]),
                searchDirs: () => ['/opt/gnome/lib/pkgconfig'],
            });
            expect(dirs).toStrictEqual(['/opt/mystack/lib', '/opt/second/lib', '/opt/gnome/lib', '/usr/local/lib']);
        });

        await it('deduplicates, and never yields the filesystem root', async () => {
            const dirs = systemGiLibraryDirs({
                platform: 'darwin',
                // A one-segment typelib path makes dirname() the root, and adding "/"
                // to a loader search path is actively hostile. /usr/local/lib arrives
                // from BOTH source 1 and source 3 here.
                env: { GI_TYPELIB_PATH: '/girepository-1.0:/usr/local/lib/girepository-1.0' },
                existsDir: dirsExist(['/', '/usr/local/lib', '/usr/local/lib/girepository-1.0']),
                searchDirs: () => ['/usr/local/lib/pkgconfig'],
            });
            expect(dirs).toStrictEqual(['/usr/local/lib']);
        });
    });

    await describe('splitSearchPath', async () => {
        await it('drops empty segments', async () => {
            expect(splitSearchPath('/a::/b:')).toStrictEqual(['/a', '/b']);
            expect(splitSearchPath(undefined)).toStrictEqual([]);
            expect(splitSearchPath('')).toStrictEqual([]);
            expect(splitSearchPath('a;b', ';')).toStrictEqual(['a', 'b']);
        });
    });

    await describe('pathCovers', async () => {
        await it('is true only when every wanted dir is already present', async () => {
            expect(pathCovers(['/usr/local/lib'], ['/usr/local/lib', '/usr/lib'])).toBe(true);
            expect(pathCovers(['/usr/local/lib'], ['/usr/lib'])).toBe(false);
            expect(pathCovers(['/a', '/b'], ['/a'])).toBe(false);
            expect(pathCovers([], ['/usr/lib'])).toBe(true);
        });
    });

    // `system-gi.ts` is a PINNED PORT of `packages/node-gi/node-gi/system-gi.js`,
    // because ADR 0005 Decision 2 forbids `@gjsify/cli` (Tier 1) taking a dependency
    // edge on `@gjsify/node-gi`. A copy with no check is a fork with a comment
    // claiming otherwise; this suite is what makes it a mirror.
    //
    // It compares OUTPUTS over a table, not source text: the port is TypeScript with
    // typed options and an eager `node:child_process` import, so the files cannot be
    // identical — what must hold is that they answer the same question the same way.
    await describe('agreement with @gjsify/node-gi’s system-gi.js', async () => {
        const cases: { why: string; opts: SystemGiOptions }[] = [
            {
                why: 'off darwin',
                opts: {
                    platform: 'linux',
                    env: { GI_TYPELIB_PATH: '/usr/local/lib/girepository-1.0' },
                    existsDir: () => true,
                    searchDirs: () => ['/usr/local/lib/pkgconfig'],
                },
            },
            {
                why: 'win32',
                opts: { platform: 'win32', env: {}, existsDir: () => true, searchDirs: noPkgConfig },
            },
            {
                why: 'Homebrew x64 via the marker',
                opts: {
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/usr/local/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                },
            },
            {
                why: 'Homebrew arm64 via the marker',
                opts: {
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/opt/homebrew/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                },
            },
            {
                why: 'MacPorts via the marker',
                opts: {
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/opt/local/lib/girepository-1.0']),
                    searchDirs: noPkgConfig,
                },
            },
            {
                why: 'a marker-less prefix is rejected',
                opts: {
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/usr/local/lib', '/opt/homebrew/lib']),
                    searchDirs: () => ['/usr/local/lib/pkgconfig'],
                },
            },
            {
                why: 'pkg-config finds a custom prefix',
                opts: {
                    platform: 'darwin',
                    env: {},
                    existsDir: dirsExist(['/opt/gnome/lib/girepository-1.0']),
                    searchDirs: () => ['/opt/gnome/lib/pkgconfig', '/opt/gnome/share/pkgconfig'],
                },
            },
            {
                why: 'GI_TYPELIB_PATH on existence alone, then the rest',
                opts: {
                    platform: 'darwin',
                    env: { GI_TYPELIB_PATH: '/opt/mystack/lib/typelibs:/opt/second/lib/girepository-1.0' },
                    existsDir: dirsExist([
                        '/opt/mystack/lib',
                        '/opt/second/lib',
                        '/opt/gnome/lib/girepository-1.0',
                        '/usr/local/lib/girepository-1.0',
                    ]),
                    searchDirs: () => ['/opt/gnome/lib/pkgconfig'],
                },
            },
            {
                why: 'root dropped and duplicates collapsed',
                opts: {
                    platform: 'darwin',
                    env: { GI_TYPELIB_PATH: '/girepository-1.0:/usr/local/lib/girepository-1.0' },
                    existsDir: dirsExist(['/', '/usr/local/lib', '/usr/local/lib/girepository-1.0']),
                    searchDirs: () => ['/usr/local/lib/pkgconfig'],
                },
            },
            {
                why: 'a Mac with no GI stack at all',
                opts: { platform: 'darwin', env: {}, existsDir: () => false, searchDirs: noPkgConfig },
            },
            {
                why: 'a STAGED prebuild dir, typelib and dylib together',
                opts: {
                    platform: 'darwin',
                    env: { GI_TYPELIB_PATH: '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds/darwin-x64' },
                    existsDir: dirsExist([
                        '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds/darwin-x64',
                        '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds',
                    ]),
                    searchDirs: noPkgConfig,
                },
            },
            {
                why: 'a staged dir whose parent does not exist',
                opts: {
                    platform: 'darwin',
                    env: { GI_TYPELIB_PATH: '/app/staged' },
                    existsDir: dirsExist(['/app/staged']),
                    searchDirs: noPkgConfig,
                },
            },
        ];

        for (const { why, opts } of cases) {
            await it(`returns the same dirs as node-gi — ${why}`, async () => {
                expect(systemGiLibraryDirs(opts)).toStrictEqual(nodeGi.systemGiLibraryDirs(opts));
            });
        }

        await it('agrees on which libdirs a typelib dir implies', async () => {
            // The layout decision itself, not only its effect through
            // `systemGiLibraryDirs` — a mirror that agreed on the outputs while
            // disagreeing here would drift the moment either grows a second caller.
            for (const typelibDir of [
                '/usr/local/lib/girepository-1.0',
                '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds/darwin-x64',
                '/opt/mystack/lib/typelibs',
                '/girepository-1.0',
                '/staged',
            ]) {
                expect(giLibraryDirsForTypelibDir(typelibDir)).toStrictEqual(
                    nodeGi.giLibraryDirsForTypelibDir(typelibDir),
                );
            }
        });

        await it('agrees on splitSearchPath and pathCovers too', async () => {
            for (const [value, sep] of [
                ['/a::/b:', ':'],
                ['', ':'],
                ['a;b;;c', ';'],
            ] as const) {
                expect(splitSearchPath(value, sep)).toStrictEqual(nodeGi.splitSearchPath(value, sep));
            }
            expect(splitSearchPath(undefined)).toStrictEqual(nodeGi.splitSearchPath(undefined));
            for (const [wanted, current] of [
                [['/usr/local/lib'], ['/usr/local/lib', '/usr/lib']],
                [['/usr/local/lib'], ['/usr/lib']],
                [['/a', '/b'], ['/a']],
                [[], ['/usr/lib']],
            ] as const) {
                expect(pathCovers(wanted, current)).toBe(nodeGi.pathCovers(wanted, current));
            }
        });

        await it('agrees on the dyld fallback composition', async () => {
            // The two copies WRITE this variable from different processes — the
            // CLI into a gjs child, node-gi into its own re-exec — so a drift
            // here is a platform that works under one launcher and not the other.
            for (const env of [
                {},
                { HOME: '/Users/dev' },
                { HOME: '/Users/dev', DYLD_FALLBACK_LIBRARY_PATH: '/opt/ci/lib' },
                { DYLD_FALLBACK_LIBRARY_PATH: '/usr/local/lib:/usr/lib' },
            ]) {
                expect(dyldDefaultFallbackDirs(env)).toStrictEqual(nodeGi.dyldDefaultFallbackDirs(env));
                for (const wanted of [[], ['/usr/local/lib'], ['/opt/homebrew/lib', '/usr/local/lib']]) {
                    expect(composeDyldFallback(wanted, env)).toBe(nodeGi.composeDyldFallback(wanted, env));
                }
            }
        });

        await it('keeps every dyld default in the composed value', async () => {
            // The regression this exists for: a tail of `/usr/lib` alone dropped
            // `/usr/local/lib` — every Homebrew GTK library on Intel macOS — so
            // setting the variable made the child find LESS than leaving it unset.
            const env = { HOME: '/Users/dev' };
            const entries = composeDyldFallback(['/opt/homebrew/lib'], env).split(':');
            expect(entries[0]).toBe('/opt/homebrew/lib');
            for (const dir of ['/Users/dev/lib', '/usr/local/lib', '/lib', '/usr/lib']) {
                expect(entries.includes(dir)).toBe(true);
            }
            expect(entries.length).toBe(new Set(entries).size);
        });
    });
};
