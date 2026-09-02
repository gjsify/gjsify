// SPDX-License-Identifier: MIT
// Font discovery, and — the half that matters — what it REFUSES.
//
// Every case here covers one shape of the same failure, and it is a quieter one than the
// locale suite's: a package that ships a typeface nothing loads. Pango does not report a
// missing family, it SUBSTITUTES — so the app renders in the wrong face with no error, no
// exit code and nothing a CI leg could look at. "The branding is off" is not something a
// user files as a packaging bug either.
//
// Exercised through `discoverPayload` against a real directory tree rather than a mocked
// fs, for the reason the locale suite gives: what is under test is what a filesystem
// layout MEANS to fontconfig, and a mock would only re-assert the assumption.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPayload } from './discover.js';
import type { ConfigDataShip } from '../../types/config-data.js';

/** A project dir with a built bundle, plus whatever font tree the case needs. */
function project(build: (root: string) => void): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-ship-fonts-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'app.gjs.mjs'), '// bundle\n');
    build(root);
    return root;
}

function discover(root: string, ship: Partial<ConfigDataShip>) {
    return discoverPayload({
        projectDir: root,
        pkg: { name: 'hello', version: '1.0.0' },
        ship: ship as ConfigDataShip,
        declaredBundle: 'dist/app.gjs.mjs',
    });
}

/** Content is irrelevant to discovery — the NAME is what decides here. */
function face(root: string, rel: string): void {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'TTF');
}

export default async () => {
    await describe('discoverPayload — fonts', async () => {
        await it('finds nothing when the project has no data/fonts and declares none', async () => {
            const root = project(() => {});
            try {
                expect(discover(root, {}).fontFiles.length).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('picks up the data/fonts convention with no configuration at all', async () => {
            // The same promise `discover.ts`'s header makes for icons and schemas: a project
            // laid out the GNOME way needs no `gjsify.ship` key.
            const root = project((r) => face(r, join('data', 'fonts', 'Brand-Regular.ttf')));
            try {
                const found = discover(root, {}).fontFiles;
                expect(found.length).toBe(1);
                expect(found[0]?.endsWith('Brand-Regular.ttf')).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('takes a single file as well as a directory', async () => {
            const root = project((r) => face(r, join('assets', 'Brand.otf')));
            try {
                expect(discover(root, { fonts: 'assets/Brand.otf' }).fontFiles.length).toBe(1);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('collects every face and walks subdirectories', async () => {
            // fontconfig scans recursively, so a family split into subdirectories is a
            // legitimate layout rather than something to flatten.
            const root = project((r) => {
                face(r, join('data', 'fonts', 'Brand-Regular.ttf'));
                face(r, join('data', 'fonts', 'Brand-Bold.otf'));
                face(r, join('data', 'fonts', 'mono', 'Brand-Mono.ttc'));
            });
            try {
                const found = discover(root, {}).fontFiles;
                expect(found.length).toBe(3);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('ignores the licence that ships beside the faces', async () => {
            // A font directory almost always carries one, and it is not a stray to complain
            // about — the same call `discoverIcons` makes for a non-icon.
            const root = project((r) => {
                face(r, join('data', 'fonts', 'Brand-Regular.ttf'));
                writeFileSync(join(r, 'data', 'fonts', 'OFL.txt'), 'SIL Open Font License\n');
            });
            try {
                expect(discover(root, {}).fontFiles.length).toBe(1);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a declared path that is not there', async () => {
            const root = project(() => {});
            try {
                expect(() => discover(root, { fonts: 'data/fonts' })).toThrow('does not exist');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a declared directory that ships no face', async () => {
            // Declaring fonts and shipping none is a promise the package does not keep, and it
            // packs green. The DEFAULT path stays silent for the same input — an absent
            // `data/fonts` is not a declaration.
            const root = project((r) => {
                mkdirSync(join(r, 'data', 'fonts'), { recursive: true });
                writeFileSync(join(r, 'data', 'fonts', 'README.md'), '# fonts\n');
            });
            try {
                expect(() => discover(root, { fonts: 'data/fonts' })).toThrow('no font face');
                expect(discover(root, {}).fontFiles.length).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a woff2 by name rather than dropping it', async () => {
            // The one stray worth a diagnostic: somebody put it there meaning it to ship.
            // Whether FreeType opens it is `FT_CONFIG_OPTION_USE_BROTLI`, a property of the
            // FreeType the SHIPPED artifact loads — so it may resolve on the packaging host
            // and not in the bundle, which is the substitution this key exists against.
            const root = project((r) => {
                face(r, join('data', 'fonts', 'Brand-Regular.ttf'));
                face(r, join('data', 'fonts', 'Brand-Regular.woff2'));
            });
            try {
                expect(() => discover(root, {})).toThrow('web-font wrapper');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('names the offending file, not just the directory', async () => {
            const root = project((r) => face(r, join('data', 'fonts', 'Brand-Regular.woff')));
            try {
                expect(() => discover(root, {})).toThrow('Brand-Regular.woff');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a configured file that is not a face at all', async () => {
            const root = project((r) => face(r, join('assets', 'Brand.zip')));
            try {
                expect(() => discover(root, { fonts: 'assets/Brand.zip' })).toThrow('not a font face');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
