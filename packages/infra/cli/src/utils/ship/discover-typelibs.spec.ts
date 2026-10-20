// SPDX-License-Identifier: MIT
// Which files `gjsify.ship.bundledTypelibs` actually stages.
//
// A typelib is never alone: `Gwebgl-0.1.typelib` is useless without the library
// it names, and staging one without the other produces a package that installs
// and dies at the first import — with nothing in the output saying so, because
// discovery has no idea it dropped anything. That silence is why this file
// exercises `discoverPayload` against a real directory rather than asserting on
// a regular expression: the subject is what a DIRECTORY means, and every case
// here is a file that used to disappear from it.
//
// The layout axis (ADR 0024 § 2) is what put the non-ELF spellings in reach —
// they land in `Contents/Frameworks` and in a Windows program directory's `lib\`
// — so the extension list stopped being a Linux question.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPayload } from './discover.js';
import type { HostOs } from './types.js';
import type { ConfigDataShip } from '../../types/config-data.js';

/** A project with a built bundle and one `gi/` directory holding `files`. */
function project(files: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-ship-typelib-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'app.gjs.mjs'), '// bundle\n');
    mkdirSync(join(root, 'gi'), { recursive: true });
    for (const file of files) writeFileSync(join(root, 'gi', file), 'x');
    return root;
}

function staged(files: readonly string[]): string[] {
    const root = project(files);
    try {
        return discoverPayload({
            projectDir: root,
            pkg: { name: 'hello', version: '1.0.0' },
            ship: { bundledTypelibs: ['gi'] } as ConfigDataShip,
            declaredBundle: 'dist/app.gjs.mjs',
        })
            .typelibFiles.map((path) => basename(path))
            .sort();
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

/** Two directories, `gi-linux/` and `gi-darwin/`, each holding the one file that OS would carry. */
function stagedForLayout(bundledTypelibs: ConfigDataShip['bundledTypelibs'], layoutOs: HostOs | undefined): string[] {
    const root = project([]);
    try {
        for (const [dir, file] of [
            ['gi-linux', 'libbridge.so'],
            ['gi-darwin', 'libbridge.dylib'],
        ]) {
            mkdirSync(join(root, dir), { recursive: true });
            writeFileSync(join(root, dir, file), 'x');
        }
        return discoverPayload({
            projectDir: root,
            pkg: { name: 'hello', version: '1.0.0' },
            ship: { bundledTypelibs } as ConfigDataShip,
            declaredBundle: 'dist/app.gjs.mjs',
            layoutOs,
        })
            .typelibFiles.map((path) => basename(path))
            .sort();
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

export default async () => {
    await describe('bundled typelib discovery', async () => {
        await it('stages the typelib and its library on all three OSes', () => {
            // `.so`-only was the shipped behaviour, and it dropped the `.dylib`
            // and the `.dll` while keeping the `.typelib` beside them — the
            // installs-and-dies-at-first-import case, produced by the code that
            // exists to prevent it.
            expect(staged(['Gwebgl-0.1.typelib', 'libgwebgl.so'])).toStrictEqual([
                'Gwebgl-0.1.typelib',
                'libgwebgl.so',
            ]);
            expect(staged(['Gwebgl-0.1.typelib', 'libgwebgl.dylib'])).toStrictEqual([
                'Gwebgl-0.1.typelib',
                'libgwebgl.dylib',
            ]);
            expect(staged(['Gwebgl-0.1.typelib', 'gwebgl-0.dll'])).toStrictEqual([
                'Gwebgl-0.1.typelib',
                'gwebgl-0.dll',
            ]);
        });

        await it('keeps a versioned ELF soname', () => {
            expect(staged(['libgwebgl.so.1.2.3'])).toStrictEqual(['libgwebgl.so.1.2.3']);
        });

        await it('matches the case the file actually has', () => {
            // Not pedantry on this list: two of the three extensions belong to
            // case-preserving-but-INSENSITIVE filesystems, where `LIBFOO.DLL` and
            // `Foo.Dylib` are ordinary names. A lowercase-only test drops them
            // into the same silence as the case above.
            expect(staged(['LIBGWEBGL.DLL', 'Foo.Dylib', 'Gwebgl-0.1.TypeLib'])).toStrictEqual([
                'Foo.Dylib',
                'Gwebgl-0.1.TypeLib',
                'LIBGWEBGL.DLL',
            ]);
        });

        await it('does NOT case-fold the ELF branch', () => {
            // The `/i` belongs to `.dylib`/`.dll`, which come off case-insensitive
            // filesystems. Applying it to `.so` as well made `README.SO` a shared
            // library — a scope the stated rationale never covered.
            expect(staged(['README.SO', 'NOTES.So', 'libgwebgl.so'])).toStrictEqual(['libgwebgl.so']);
        });

        await it('leaves everything else where it is', () => {
            // The `.gir` beside a prebuilt typelib is the measured case: it is
            // XML for a compiler, not something an installed app loads, and every
            // committed `prebuilds/<os>-<arch>/` in this repo carries one.
            expect(staged(['Gwebgl-0.1.gir', 'README.md', 'libgwebgl.so'])).toStrictEqual(['libgwebgl.so']);
        });

        await it('refuses a directory that is not there', () => {
            const root = project([]);
            try {
                expect(() =>
                    discoverPayload({
                        projectDir: root,
                        pkg: { name: 'hello', version: '1.0.0' },
                        ship: { bundledTypelibs: ['missing'] } as ConfigDataShip,
                        declaredBundle: 'dist/app.gjs.mjs',
                    }),
                ).toThrow('bundledTypelibs');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('bundled typelibs keyed per OS', async () => {
        const table = { linux: ['gi-linux'], darwin: ['gi-darwin'] };

        await it('stages only the directories of the layout being assembled', () => {
            expect(stagedForLayout(table, 'linux')).toStrictEqual(['libbridge.so']);
            expect(stagedForLayout(table, 'darwin')).toStrictEqual(['libbridge.dylib']);
        });

        await it('stages nothing for a target with no key', () => {
            expect(stagedForLayout(table, 'win32')).toStrictEqual([]);
        });

        await it('keeps a flat list for every target', () => {
            expect(stagedForLayout(['gi-linux'], 'darwin')).toStrictEqual(['libbridge.so']);
        });

        await it('refuses a key nothing reads, such as the positional spelling', () => {
            expect(() => stagedForLayout({ macos: ['gi-darwin'] } as never, 'darwin')).toThrow('bundledTypelibs.macos');
        });

        await it('refuses a table without a layout OS', () => {
            expect(() => stagedForLayout(table, undefined)).toThrow('per-OS table');
        });
    });

    await describe('gjsify.ship.formats', async () => {
        function formatFilesOf(ship: ConfigDataShip) {
            const root = project(['Foo-1.typelib', 'libfoo.so']);
            try {
                writeFileSync(join(root, 'provider.so'), 'x');
                return discoverPayload({
                    projectDir: root,
                    pkg: { name: 'hello', version: '1.0.0' },
                    ship,
                    declaredBundle: 'dist/app.gjs.mjs',
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }

        await it("keeps a format's typelibs and files out of the shared payload", () => {
            const found = formatFilesOf({
                formats: { deb: { bundledTypelibs: ['gi'], extraFiles: { 'lib/x/p.so': 'provider.so' } } },
            } as ConfigDataShip);
            expect(found.typelibFiles).toStrictEqual([]);
            expect(found.formatFiles.deb?.typelibFiles.map((f) => basename(f)).sort()).toStrictEqual([
                'Foo-1.typelib',
                'libfoo.so',
            ]);
            expect(basename(found.formatFiles.deb?.extraFiles['lib/x/p.so'] ?? '')).toBe('provider.so');
            expect(found.formatFiles.rpm).toBe(undefined);
        });

        await it('looks for them on the Linux layout only', () => {
            const root = project([]);
            try {
                const ship = { formats: { deb: { bundledTypelibs: ['not-built-here'] } } } as ConfigDataShip;
                const input = {
                    projectDir: root,
                    pkg: { name: 'hello', version: '1.0.0' },
                    ship,
                    declaredBundle: 'dist/app.gjs.mjs',
                };
                expect(discoverPayload({ ...input, layoutOs: 'darwin' }).formatFiles).toStrictEqual({});
                expect(() => discoverPayload({ ...input, layoutOs: 'linux' })).toThrow();
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a format that has no overlay to carry the files', () => {
            expect(() => formatFilesOf({ formats: { appimage: { bundledTypelibs: ['gi'] } } } as never)).toThrow(
                'formats.appimage',
            );
        });
    });
};
