// The defect this module exists for, measured on postmarketOS v26.06 / aarch64
// (OnePlus 6T, gjs 1.88.1, no node): libadwaita 1.9.2 installed, `Adw-1.typelib`
// present in `/usr/lib/girepository-1.0`, Adwaita apps running on the device —
// and `gjsify system-check` printing `✗ libadwaita` under Required and exiting 1,
// because `libadwaita-dev` (the `.pc` file, which nothing at runtime reads) was
// not installed.
//
// Every case drives INJECTED host facts rather than the running machine: a host
// that happens to have GTK exercises one branch and proves nothing about the
// other three.

import { describe, it, expect } from '@gjsify/unit';
import { findSystemTypelib, type GiTypelibOptions, systemGiTypelibDirs } from './gi-typelib.js';

/** An `existsDir`/`existsFile` predicate over an explicit set. */
function present(paths: string[]): (p: string) => boolean {
    const set = new Set(paths);
    return (p: string) => set.has(p);
}

/** No pkg-config on this host — the runtime-only case the whole module is about. */
const noPkgConfig = (): string[] => [];

export default async () => {
    await describe('systemGiTypelibDirs', async () => {
        await it('finds the plain Linux libdir with no pkg-config at all', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: {},
                existsDir: present(['/usr/lib/girepository-1.0']),
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['/usr/lib/girepository-1.0']);
        });

        await it('finds a Fedora lib64 layout', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: {},
                existsDir: present(['/usr/lib64/girepository-1.0']),
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['/usr/lib64/girepository-1.0']);
        });

        // Debian/Ubuntu. The triplet is discovered, never derived from
        // `process.arch` — that mapping is a table with a row per port.
        await it('discovers a Debian multiarch triplet by listing the parent', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: {},
                existsDir: present(['/usr/lib/aarch64-linux-gnu/girepository-1.0']),
                listDirs: (dir) => (dir === '/usr/lib' ? ['aarch64-linux-gnu', 'systemd'] : []),
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['/usr/lib/aarch64-linux-gnu/girepository-1.0']);
        });

        // An explicit statement from the host is not second-guessed against the
        // marker: it IS the marker.
        await it('honours GI_TYPELIB_PATH first, in order', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: { GI_TYPELIB_PATH: '/opt/app/typelibs:/usr/lib/girepository-1.0' },
                existsDir: present(['/opt/app/typelibs', '/usr/lib/girepository-1.0']),
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['/opt/app/typelibs', '/usr/lib/girepository-1.0']);
        });

        await it('drops a GI_TYPELIB_PATH entry that does not exist', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: { GI_TYPELIB_PATH: '/gone' },
                existsDir: present(['/usr/lib/girepository-1.0']),
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['/usr/lib/girepository-1.0']);
        });

        // The general mechanism: a prefix no list here names.
        await it('follows pkg-config to a bespoke prefix', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: {},
                existsDir: present(['/home/dev/jhbuild/lib/girepository-1.0']),
                listDirs: () => [],
                searchDirs: () => ['/home/dev/jhbuild/lib/pkgconfig'],
            });
            expect(dirs).toEqual(['/home/dev/jhbuild/lib/girepository-1.0']);
        });

        await it('never returns a directory twice', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: { GI_TYPELIB_PATH: '/usr/lib/girepository-1.0' },
                existsDir: present(['/usr/lib/girepository-1.0']),
                listDirs: () => [],
                searchDirs: () => ['/usr/lib/pkgconfig'],
            });
            expect(dirs).toEqual(['/usr/lib/girepository-1.0']);
        });

        await it('returns nothing when the marker is nowhere', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'linux',
                env: {},
                existsDir: () => false,
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual([]);
        });

        // Reuses systemGiLibraryDirs, so Homebrew/MacPorts prefixes come for free
        // and the two cannot disagree about where the GI stack is.
        await it('reaches a Homebrew prefix on darwin', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'darwin',
                env: {},
                existsDir: present(['/opt/homebrew/lib/girepository-1.0']),
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['/opt/homebrew/lib/girepository-1.0']);
        });

        // POSIX separators and semantics must NOT leak into a win32 answer — the
        // trap system-gi.ts documents.
        await it('uses Windows path and separator semantics on win32', async () => {
            const dirs = systemGiTypelibDirs({
                platform: 'win32',
                env: { PATH: 'C:\\msys64\\mingw64\\bin;C:\\Windows\\System32' },
                existsDir: present(['C:\\msys64\\mingw64\\lib\\girepository-1.0']),
                listDirs: () => [],
                searchDirs: noPkgConfig,
            });
            expect(dirs).toEqual(['C:\\msys64\\mingw64\\lib\\girepository-1.0']);
        });
    });

    await describe('findSystemTypelib', async () => {
        const host: GiTypelibOptions = {
            platform: 'linux',
            env: {},
            existsDir: present(['/usr/lib/girepository-1.0']),
            listDirs: () => [],
            searchDirs: noPkgConfig,
        };

        // The measured case, in one assertion: the typelib is what decides.
        await it('finds Adw-1 where the device has it', async () => {
            const found = findSystemTypelib('Adw', '1', {
                ...host,
                existsFile: present(['/usr/lib/girepository-1.0/Adw-1.typelib']),
            });
            expect(found).toBe('/usr/lib/girepository-1.0/Adw-1.typelib');
        });

        await it('spells the API version into the leaf, not just the namespace', async () => {
            const found = findSystemTypelib('Gtk', '4.0', {
                ...host,
                existsFile: present(['/usr/lib/girepository-1.0/Gtk-4.0.typelib']),
            });
            expect(found).toBe('/usr/lib/girepository-1.0/Gtk-4.0.typelib');
        });

        // Gtk-3.0 beside Gtk-4.0 is the normal state of a desktop; matching the
        // wrong one would report a GTK4 app buildable on a GTK3-only host.
        await it('does not accept a different API version of the same namespace', async () => {
            const found = findSystemTypelib('Gtk', '4.0', {
                ...host,
                existsFile: present(['/usr/lib/girepository-1.0/Gtk-3.0.typelib']),
            });
            expect(found).toBeNull();
        });

        await it('returns null when nothing is installed', async () => {
            const found = findSystemTypelib('Adw', '1', { ...host, existsFile: () => false });
            expect(found).toBeNull();
        });

        await it('takes the first directory that has it', async () => {
            const found = findSystemTypelib('Soup', '3.0', {
                ...host,
                env: { GI_TYPELIB_PATH: '/opt/app/typelibs' },
                existsDir: present(['/opt/app/typelibs', '/usr/lib/girepository-1.0']),
                existsFile: present([
                    '/opt/app/typelibs/Soup-3.0.typelib',
                    '/usr/lib/girepository-1.0/Soup-3.0.typelib',
                ]),
            });
            expect(found).toBe('/opt/app/typelibs/Soup-3.0.typelib');
        });
    });
};
