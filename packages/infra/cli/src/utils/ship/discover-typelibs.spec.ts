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
};
