// The point of taking every host fact as a parameter is that all three platform
// branches — including the darwin one that only matters on a Mac — run from the
// Linux runner this project actually has (ADR 0018 § 5).

import { describe, expect, it } from '@gjsify/unit';
import { PROBED_GI_LIBDIRS, splitSearchPath, systemGiLibraryDirs, TYPELIB_SUBDIR } from './system-gi-dirs.js';

/** A fake filesystem: every listed directory exists, nothing else does. */
const dirs = (...present: string[]) => {
    const set = new Set(present);
    return (dir: string) => set.has(dir);
};

export default async () => {
    await describe('systemGiLibraryDirs: platforms whose loader needs nothing', async () => {
        await it('is empty off darwin, whatever the host says', async () => {
            // Not "unimplemented": linux resolves these leaves through ld.so's
            // system-wide cache, so a per-process answer would be noise. An
            // accidental non-empty here would put directories on a loader path
            // that never needed them.
            for (const platform of ['linux', 'win32', 'freebsd']) {
                expect(
                    systemGiLibraryDirs({
                        platform,
                        typelibPath: '/usr/local/lib/girepository-1.0',
                        pkgConfigDirs: ['/usr/local/lib/pkgconfig'],
                        existsDir: () => true,
                    }),
                ).toStrictEqual([]);
            }
        });
    });

    await describe('systemGiLibraryDirs: an explicit statement is not second-guessed', async () => {
        await it('takes GI_TYPELIB_PATH’s sibling libdir without the marker check', async () => {
            // Source 1 is the host saying outright where typelibs are. Demanding
            // the `girepository-1.0/` marker of it would reject a host that put
            // its typelibs somewhere unusual on purpose.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/custom/prefix/lib/girepository-1.0',
                    existsDir: dirs('/custom/prefix/lib'),
                }),
            ).toStrictEqual(['/custom/prefix/lib']);
        });

        await it('honours every entry of a multi-entry GI_TYPELIB_PATH', async () => {
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/a/lib/girepository-1.0:/b/lib/girepository-1.0',
                    existsDir: dirs('/a/lib', '/b/lib'),
                }),
            ).toStrictEqual(['/a/lib', '/b/lib']);
        });

        await it('drops an entry whose sibling libdir is not there', async () => {
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/gone/lib/girepository-1.0',
                    existsDir: dirs(),
                }),
            ).toStrictEqual([]);
        });

        await it('reads a STAGED pair’s own directory as the libdir', async () => {
            // A prebuild directory (ADR 0017) holds `WebKit-6.0.typelib` AND
            // `libgjsifywebkit.dylib`, so GI's install layout does not describe it and
            // the parent-only derivation named a real directory holding nothing —
            // measured on darwin, where that prebuild is the only WebKit there is.
            const staged = '/app/node_modules/@gjsify/webkit-native-darwin-x64/prebuilds/darwin-x64';
            expect(
                systemGiLibraryDirs({ platform: 'darwin', typelibPath: staged, existsDir: dirs(staged) }),
            ).toStrictEqual([staged]);
        });

        await it('keeps offering the parent where the layout is unnamed', async () => {
            // A relocated INSTALL layout carries no required directory name, so the
            // parent stays reachable — the staged reading is added, not substituted.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/opt/mystack/lib/typelibs',
                    existsDir: dirs('/opt/mystack/lib'),
                }),
            ).toStrictEqual(['/opt/mystack/lib']);
        });

        await it('offers the staged reading FIRST when both exist', async () => {
            // ORDER, not membership: the result is prepended to a loader search path,
            // so it decides which of the two directories a bare leaf resolves from.
            // Every case above lets exactly one of the pair exist, which is why the
            // order was unpinned here while three copies of the rule had to agree on it.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/opt/stack/lib/typelibs',
                    existsDir: dirs('/opt/stack/lib/typelibs', '/opt/stack/lib'),
                }),
            ).toStrictEqual(['/opt/stack/lib/typelibs', '/opt/stack/lib']);
        });

        await it('reads a trailing slash the way node:path does', async () => {
            // `GI_TYPELIB_PATH=<…>/girepository-1.0/` is an ordinary spelling, and this
            // module's hand-rolled `dirname` used to answer it with the input minus its
            // final slash — the typelib directory, which holds no library — while
            // `basename` correctly saw the marker. The two pinned mirrors use
            // `posix.dirname` and never had it, so it was also a live three-way drift.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/usr/local/lib/girepository-1.0/',
                    existsDir: dirs('/usr/local/lib'),
                }),
            ).toStrictEqual(['/usr/local/lib']);
        });
    });

    await describe('systemGiLibraryDirs: a guessed prefix must show the marker', async () => {
        await it('believes a probed prefix only when the typelib dir exists', async () => {
            // The probed list is three candidates; a Mac with Homebrew under
            // /usr/local must not also claim /opt/homebrew.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    existsDir: dirs(`/usr/local/lib/${TYPELIB_SUBDIR}`),
                }),
            ).toStrictEqual(['/usr/local/lib']);
        });

        await it('finds a custom prefix through pkg-config, marker-checked', async () => {
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    pkgConfigDirs: ['/custom/lib/pkgconfig'],
                    existsDir: dirs(`/custom/lib/${TYPELIB_SUBDIR}`),
                }),
            ).toStrictEqual(['/custom/lib']);
        });

        await it('ignores a pkg-config dir not named pkgconfig', async () => {
            // `pc_path` can list directories that are not a `<prefix>/pkgconfig`;
            // taking their parent would name an unrelated prefix.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    pkgConfigDirs: ['/weird/place'],
                    existsDir: () => true,
                }),
            ).toStrictEqual(PROBED_GI_LIBDIRS.darwin as string[]);
        });

        await it('returns nothing when a candidate exists but carries no typelibs', async () => {
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    pkgConfigDirs: ['/usr/local/lib/pkgconfig'],
                    existsDir: dirs('/usr/local/lib'),
                }),
            ).toStrictEqual([]);
        });
    });

    await describe('systemGiLibraryDirs: the result is a set, in precedence order', async () => {
        await it('lists the explicit source before the guessed ones', async () => {
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/explicit/lib/girepository-1.0',
                    existsDir: dirs('/explicit/lib', `/usr/local/lib/${TYPELIB_SUBDIR}`),
                }),
            ).toStrictEqual(['/explicit/lib', '/usr/local/lib']);
        });

        await it('does not repeat a directory two sources both name', async () => {
            // A duplicate would be harmless on the loader path and misleading in
            // a log; more to the point, `pathCovers`-style callers compare lists.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/usr/local/lib/girepository-1.0',
                    pkgConfigDirs: ['/usr/local/lib/pkgconfig'],
                    existsDir: dirs('/usr/local/lib', `/usr/local/lib/${TYPELIB_SUBDIR}`),
                }),
            ).toStrictEqual(['/usr/local/lib']);
        });

        await it('never yields the filesystem root', async () => {
            // `dirname('/girepository-1.0')` is `/`, and putting the root on a
            // loader search path makes it stat every leaf against the whole disk.
            expect(
                systemGiLibraryDirs({
                    platform: 'darwin',
                    typelibPath: '/girepository-1.0',
                    existsDir: () => true,
                }).includes('/'),
            ).toBe(false);
        });
    });

    await describe('splitSearchPath', async () => {
        await it('drops empty entries and treats undefined as empty', async () => {
            // A trailing or doubled `:` is normal in a hand-edited PATH-shaped
            // variable, and an empty entry would become `dirname('') === '.'`.
            expect(splitSearchPath('/a::/b:')).toStrictEqual(['/a', '/b']);
            expect(splitSearchPath(undefined)).toStrictEqual([]);
        });
    });
};
