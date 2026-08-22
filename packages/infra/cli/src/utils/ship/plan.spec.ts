// SPDX-License-Identifier: MIT
// What lands where, and — the half that matters — what is REFUSED.
//
// The planner is pure so these cases can be written without building an app,
// and the refusals are the reason it is pure at all: an icon whose size cannot
// be told, two icons colliding on one destination, a schema named so it would
// collide with another package's in the one shared system directory, and an
// `extraFiles` destination climbing out of the prefix. Every one of those
// produces a package that INSTALLS and is wrong, which is the class this
// project pays the most for.

import { describe, expect, it } from '@gjsify/unit';

import { iconSizeDir, planOverlay, planStage, type StageInputs } from './plan.js';
import { FORMATS } from './formats.js';
import type { ShipSettings } from './types.js';

function settings(overrides: Partial<ShipSettings> = {}): ShipSettings {
    return {
        projectDir: '/project',
        appId: 'org.example.Hello',
        name: 'Hello',
        binaryName: 'hello',
        version: '1.0.0',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['A demo'],
        license: 'MIT',
        homepage: 'https://example.org',
        section: 'gnome',
        group: 'Applications/System',
        kind: 'app',
        mimeTypes: [],
        extraDepends: { deb: [], rpm: [] },
        bundlePath: '/project/dist/gjs.js',
        bundleDir: '/project/dist',
        iconFiles: [],
        schemaFiles: [],
        typelibFiles: [],
        localeFiles: [],
        extraFiles: {},
        execArgs: [],
        outDir: 'ship',
        arch: 'x64',
        minGjsVersion: '1.86',
        ...overrides,
    };
}

function inputs(overrides: Partial<StageInputs> = {}): StageInputs {
    return {
        bundleFiles: ['gjs.js'],
        launcher: '#!/bin/sh\n',
        metainfo: '<component/>\n',
        desktopEntry: '[Desktop Entry]\n',
        ...overrides,
    };
}

export default async () => {
    await describe('planStage', async () => {
        await it('places the launcher, the bundle and the metadata', async () => {
            const paths = planStage(settings(), inputs()).map((file) => file.path);
            expect(paths).toStrictEqual([
                'bin/hello',
                'lib/hello/gjs.js',
                'share/applications/org.example.Hello.desktop',
                'share/metainfo/org.example.Hello.metainfo.xml',
            ]);
        });

        await it('makes the launcher executable and the data not', async () => {
            const files = planStage(settings(), inputs());
            expect(files.find((file) => file.path === 'bin/hello')?.mode).toBe(0o755);
            expect(files.find((file) => file.path === 'lib/hello/gjs.js')?.mode).toBe(0o644);
        });

        await it('keeps a native module executable', async () => {
            const files = planStage(settings(), inputs({ bundleFiles: ['gjs.js', 'native.node'] }));
            expect(files.find((file) => file.path === 'lib/hello/native.node')?.mode).toBe(0o755);
        });

        await it('stages neither desktop entry nor icon for a cli app', async () => {
            const paths = planStage(
                settings({ kind: 'cli', iconFiles: ['/project/data/icon.svg'] }),
                inputs({ desktopEntry: undefined }),
            ).map((file) => file.path);
            expect(paths).toStrictEqual([
                'bin/hello',
                'lib/hello/gjs.js',
                'share/metainfo/org.example.Hello.metainfo.xml',
            ]);
        });

        await it('renames icons after the app id, into their size directory', async () => {
            const paths = planStage(
                settings({
                    iconFiles: ['/project/data/icons/hicolor/128x128/apps/whatever.png', '/project/data/logo.svg'],
                }),
                inputs(),
            ).map((file) => file.path);
            expect(paths).toContain('share/icons/hicolor/128x128/apps/org.example.Hello.png');
            expect(paths).toContain('share/icons/hicolor/scalable/apps/org.example.Hello.svg');
        });

        await it('refuses two icons that would install as the same file', async () => {
            expect(() => planStage(settings({ iconFiles: ['/a/icon-64.png', '/b/other-64.png'] }), inputs())).toThrow(
                'both install as',
            );
        });

        await it('refuses a schema whose name does not start with the app id', async () => {
            expect(() =>
                planStage(settings({ schemaFiles: ['/project/data/settings.gschema.xml'] }), inputs()),
            ).toThrow('must be named');
        });

        await it('stages bundled typelibs beside the bundle, in gi/', async () => {
            // gjsify's own GI libraries arrive as npm prebuilds, so an app using one must CARRY it:
            // there is no `gir1.2-…` to depend on. A typelib without its shared library installs
            // and then dies at the first import, so both are staged from the same directory.
            const files = planStage(
                { ...settings(), typelibFiles: ['/p/Gwebgl-0.1.typelib', '/p/libgwebgl.so'] },
                inputs(),
            );
            const staged = files.map((file) => file.path);
            expect(staged.includes('lib/hello/gi/Gwebgl-0.1.typelib')).toBe(true);
            expect(staged.includes('lib/hello/gi/libgwebgl.so')).toBe(true);
        });

        await it('stages catalogues into share/locale, layout preserved', async () => {
            // The LAYOUT is the point: `bindtextdomain` looks in
            // `<dir>/<lang>/LC_MESSAGES/<domain>.mo` and nowhere else, so a catalogue staged by
            // basename alone would install and never be found.
            const files = planStage(
                settings({
                    localeFiles: [
                        { rel: 'de/LC_MESSAGES/hello.mo', abs: '/p/dist/locale/de/LC_MESSAGES/hello.mo' },
                        { rel: 'fr/LC_MESSAGES/hello.mo', abs: '/p/dist/locale/fr/LC_MESSAGES/hello.mo' },
                    ],
                }),
                inputs(),
            );
            const staged = files.map((file) => file.path);
            expect(staged.includes('share/locale/de/LC_MESSAGES/hello.mo')).toBe(true);
            expect(staged.includes('share/locale/fr/LC_MESSAGES/hello.mo')).toBe(true);
            expect(files.find((f) => f.path === 'share/locale/de/LC_MESSAGES/hello.mo')?.mode).toBe(0o644);
        });

        await it('refuses an extra file that escapes the prefix', async () => {
            expect(() => planStage(settings({ extraFiles: { '../etc/passwd': '/project/evil' } }), inputs())).toThrow(
                'escapes the install prefix',
            );
        });

        await it('lets an extra file override a staged default', async () => {
            const files = planStage(settings({ extraFiles: { 'lib/hello/gjs.js': '/project/other.js' } }), inputs());
            const bundle = files.find((file) => file.path === 'lib/hello/gjs.js');
            expect(bundle?.source).toStrictEqual({ kind: 'file', path: '/project/other.js' });
        });
    });

    await describe('planOverlay', async () => {
        await it('writes Debian machine-readable copyright, with blank lines escaped', async () => {
            const overlay = planOverlay(settings(), FORMATS.deb, inputs({ licenseText: 'MIT\n\nPermission…\n' }));
            expect(overlay.length).toBe(1);
            expect(overlay[0]?.path).toBe('share/doc/hello/copyright');
            const text = overlay[0]?.source.kind === 'text' ? overlay[0].source.text : '';
            expect(text).toContain('Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/');
            // A truly blank line would end the field and truncate the licence.
            expect(text).toContain('\n .\n');
        });

        await it('copies the licence verbatim for rpm', async () => {
            const overlay = planOverlay(settings(), FORMATS.rpm, inputs({ licenseText: 'MIT\n\nPermission…\n' }));
            expect(overlay[0]?.path).toBe('share/licenses/hello/LICENSE');
            expect(overlay[0]?.source.kind === 'text' ? overlay[0].source.text : '').toBe('MIT\n\nPermission…\n');
        });

        await it('is empty when the project has no licence file', async () => {
            expect(planOverlay(settings(), FORMATS.deb, inputs()).length).toBe(0);
        });
    });

    await describe('iconSizeDir', async () => {
        await it('reads the size from the path, the filename, or the extension', async () => {
            expect(iconSizeDir('/a/hicolor/256x256/apps/x.png')).toBe('256x256');
            expect(iconSizeDir('/a/icon-48.png')).toBe('48x48');
            expect(iconSizeDir('/a/icon.svg')).toBe('scalable');
        });

        await it('refuses an icon whose size it cannot tell', async () => {
            expect(() => iconSizeDir('/a/icon.png')).toThrow('cannot tell what size');
        });
    });
};
