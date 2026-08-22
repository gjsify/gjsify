// SPDX-License-Identifier: MIT
// Locale discovery, and — the half that matters — what it REFUSES.
//
// Every refusal here covers one shape of the same failure: a package that installs its
// translations and shows none of them. That is the worst kind to ship, because it is
// indistinguishable from "this app has no German", so nobody files it as a packaging bug.
//
// Exercised through `discoverPayload` against a real directory tree rather than a mocked fs: the
// thing under test is what the filesystem layout means to `bindtextdomain`, and a mock would only
// re-assert the assumption being checked.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPayload } from './discover.js';
import type { ConfigDataShip } from '../../types/config-data.js';

/** A project dir with a built bundle, plus whatever locale tree the case needs. */
function project(build: (root: string) => void): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-ship-locale-'));
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

function mo(root: string, rel: string): void {
    const full = join(root, 'dist', 'locale', rel);
    mkdirSync(join(full, '..'), { recursive: true });
    // Content is irrelevant to discovery — the layout is what is under test.
    writeFileSync(full, 'MO');
}

export default async () => {
    await describe('discoverPayload — locales', async () => {
        await it('finds nothing when no localeDir is declared', async () => {
            const root = project(() => {});
            try {
                expect(discover(root, {}).localeFiles.length).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('collects every catalogue and keeps its layout', async () => {
            const root = project((r) => {
                mo(r, 'de/LC_MESSAGES/hello.mo');
                mo(r, 'fr/LC_MESSAGES/hello.mo');
                mo(r, 'pt_BR/LC_MESSAGES/hello.mo');
            });
            try {
                const found = discover(root, { localeDir: 'dist/locale' }).localeFiles;
                expect(found.map((f) => f.rel).sort()).toStrictEqual([
                    'de/LC_MESSAGES/hello.mo',
                    'fr/LC_MESSAGES/hello.mo',
                    'pt_BR/LC_MESSAGES/hello.mo',
                ]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a declared directory that is not there', async () => {
            const root = project(() => {});
            try {
                expect(() => discover(root, { localeDir: 'dist/locale' })).toThrow('does not exist');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a directory that declares locales and ships none', async () => {
            // An empty tree is a promise the package does not keep — and it packs green.
            const root = project((r) => mkdirSync(join(r, 'dist', 'locale'), { recursive: true }));
            try {
                expect(() => discover(root, { localeDir: 'dist/locale' })).toThrow('no `.mo` catalogue');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a .po left in place of a compiled catalogue', async () => {
            // `bindtextdomain` reads `.mo` only. A staged `.po` is a file nothing ever opens.
            const root = project((r) => {
                mo(r, 'de/LC_MESSAGES/hello.mo');
                const full = join(r, 'dist', 'locale', 'fr', 'LC_MESSAGES');
                mkdirSync(full, { recursive: true });
                writeFileSync(join(full, 'hello.po'), 'msgid ""\n');
            });
            try {
                expect(() => discover(root, { localeDir: 'dist/locale' })).toThrow('.po source');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('refuses a catalogue outside <lang>/LC_MESSAGES/', async () => {
            // The commonest slip: msgfmt run without the LC_MESSAGES level. It installs, and the
            // app stays English.
            const root = project((r) => mo(r, 'de/hello.mo'));
            try {
                expect(() => discover(root, { localeDir: 'dist/locale' })).toThrow('LC_MESSAGES');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('keeps the locale tree out of the wholesale bundle staging', async () => {
            // `dist/locale/` sits BESIDE `dist/app.gjs.mjs`, and `bundleFiles` is "everything next
            // to the bundle" — so without this the same `.mo` shipped twice: once correctly under
            // `share/locale/`, once as dead weight under `lib/<binary>/locale/`. Measured on a real
            // package before the fix; nothing ever looks in the second place.
            const root = project((r) => mo(r, 'de/LC_MESSAGES/hello.mo'));
            try {
                const found = discover(root, { localeDir: 'dist/locale' });
                expect(found.bundleFiles).toStrictEqual(['app.gjs.mjs']);
                expect(found.localeFiles.length).toBe(1);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('still stages a sibling directory that is not the locale tree', async () => {
            // The subtraction is targeted: only the DECLARED locale directory drops out, so a
            // package that legitimately ships assets beside its bundle keeps them.
            const root = project((r) => {
                mo(r, 'de/LC_MESSAGES/hello.mo');
                mkdirSync(join(r, 'dist', 'assets'), { recursive: true });
                writeFileSync(join(r, 'dist', 'assets', 'logo.png'), 'PNG');
            });
            try {
                const found = discover(root, { localeDir: 'dist/locale' });
                expect(found.bundleFiles.sort()).toStrictEqual(['app.gjs.mjs', join('assets', 'logo.png')]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('names the offending file, not just the directory', async () => {
            // A refusal that says only "something is wrong in dist/locale" sends the reader
            // hunting; the whole point is that the fix is obvious from the message.
            const root = project((r) => mo(r, 'hello.mo'));
            try {
                expect(() => discover(root, { localeDir: 'dist/locale' })).toThrow('hello.mo');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
