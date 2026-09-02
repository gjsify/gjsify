// SPDX-License-Identifier: MIT
// Defaulting, and the four things `gjsify ship` refuses to guess.
//
// A package name, an app id, a licence and a maintainer are all fields where a
// plausible guess is worse than an error: the guess installs, and the wrong
// value is then in an artifact someone else has downloaded. Everything else has
// a derived default, because a packaging command that needs twenty lines of
// configuration before it can run is one nobody runs.

import { describe, expect, it } from '@gjsify/unit';

import {
    descriptionParagraphs,
    deriveBinaryName,
    resolveShipApp,
    resolveShipSettings,
    type SettingsInput,
} from './settings.js';
import type { ShipAppOptions } from '../../types/config-data.js';
import { normaliseVersion } from './version.js';

function input(overrides: Partial<SettingsInput> = {}): SettingsInput {
    return {
        projectDir: '/project',
        pkg: { name: 'hello-app', version: '1.2.3', license: 'MIT', author: 'Dev <dev@example.org>' },
        ship: { appId: 'org.example.Hello' },
        flatpak: {},
        // Already RESOLVED, which is the contract: `resolveShipSettings` does no
        // defaulting of its own, so every caller has been through `resolveShipApp`.
        app: 'gjs',
        cli: { layoutOs: 'linux' },
        discovered: {
            bundlePath: '/project/dist/gjs.js',
            bundleDir: '/project/dist',
            bundleFiles: ['gjs.js'],
            iconFiles: ['/project/data/icon.svg'],
            schemaFiles: [],
            typelibFiles: [],
            localeFiles: [],
        },
        ...overrides,
    };
}

export default async () => {
    await describe('resolveShipSettings', async () => {
        await it('derives the package name, display name and version', async () => {
            const { settings } = resolveShipSettings(input());
            expect(settings.binaryName).toBe('hello-app');
            expect(settings.name).toBe('Hello App');
            expect(settings.version).toBe('1.2.3');
            expect(settings.release).toBe('1');
        });

        await it('reads metadata from gjsify.flatpak when gjsify.ship omits it', async () => {
            const { settings, metadata } = resolveShipSettings(
                input({
                    ship: {},
                    flatpak: {
                        appId: 'org.example.FromFlatpak',
                        summary: 'Summary from the flatpak block',
                        categories: ['Development'],
                    },
                }),
            );
            expect(settings.appId).toBe('org.example.FromFlatpak');
            expect(settings.summary).toBe('Summary from the flatpak block');
            expect(metadata.categories).toStrictEqual(['Development']);
            // Categories drive the deb section and the rpm group.
            expect(settings.section).toBe('devel');
            expect(settings.group).toBe('Development/Tools');
        });

        await it('lets gjsify.ship override the flatpak block key by key', async () => {
            const { settings } = resolveShipSettings(
                input({
                    ship: { appId: 'org.example.Hello', summary: 'From ship' },
                    flatpak: { appId: 'org.example.Other', summary: 'From flatpak' },
                }),
            );
            expect(settings.appId).toBe('org.example.Hello');
            expect(settings.summary).toBe('From ship');
        });

        await it('warns rather than fails when a GUI app ships no icon', async () => {
            const { warnings } = resolveShipSettings(input({ discovered: { ...input().discovered, iconFiles: [] } }));
            expect(warnings.join('\n')).toContain('no icon found');
        });

        await it('refuses to invent an application id', async () => {
            expect(() => resolveShipSettings(input({ ship: {} }))).toThrow('no application id');
        });

        await it('refuses to invent a licence', async () => {
            expect(() =>
                resolveShipSettings(input({ pkg: { name: 'a-b', version: '1.0.0', author: 'D <d@e.org>' } })),
            ).toThrow('no licence');
        });

        await it('refuses to invent a maintainer', async () => {
            expect(() =>
                resolveShipSettings(input({ pkg: { name: 'a-b', version: '1.0.0', license: 'MIT' } })),
            ).toThrow('no maintainer');
        });

        await it('falls back to the AppStream developer for the maintainer', async () => {
            const { settings } = resolveShipSettings(
                input({
                    pkg: { name: 'a-b', version: '1.0.0', license: 'MIT' },
                    ship: {
                        appId: 'org.example.Hello',
                        developer: { id: 'org.example', name: 'Dev', email: 'd@e.org' },
                    },
                }),
            );
            expect(settings.maintainer).toBe('Dev <d@e.org>');
        });

        await it('drops the url from an npm author shorthand', async () => {
            const { settings } = resolveShipSettings(
                input({ pkg: { ...input().pkg, author: 'Dev <dev@example.org> (https://example.org)' } }),
            );
            expect(settings.maintainer).toBe('Dev <dev@example.org>');
        });
    });

    await describe('deriveBinaryName', async () => {
        await it('strips the npm scope and folds the rest to a dpkg-legal name', async () => {
            expect(deriveBinaryName('@gjsify/Hello_World')).toBe('hello-world');
        });

        await it('refuses a name that cannot become a legal package name', async () => {
            expect(() => deriveBinaryName('@scope/_')).toThrow('cannot derive a package name');
            expect(() => deriveBinaryName(undefined)).toThrow('no package name');
        });
    });

    await describe('normaliseVersion', async () => {
        await it('converts a semver prerelease into one both dpkg and rpm order correctly', async () => {
            // `1.2.0-rc.1` read by dpkg is upstream 1.2.0 revision rc.1, which
            // sorts AFTER 1.2.0 — the opposite of what semver means.
            expect(normaliseVersion('1.2.0-rc.1').version).toBe('1.2.0~rc.1');
            expect(normaliseVersion('v2.0.0').version).toBe('2.0.0');
        });

        await it('drops build metadata and says so', async () => {
            const result = normaliseVersion('1.0.0+build.7');
            expect(result.version).toBe('1.0.0');
            expect(result.warnings.join('')).toContain('build metadata');
        });

        await it('refuses a version no package manager can order', async () => {
            expect(() => normaliseVersion('not-a-version')).toThrow('not a usable package version');
        });
    });

    await describe('resolveShipApp', async () => {
        await it('defaults to gjs, and to the project field when one is declared', async () => {
            // An undeclared target is the common case for a GJS app and it means
            // GJS — never the host runtime this command happens to run under.
            expect(resolveShipApp({ layoutOs: 'linux' }).app).toBe('gjs');
            expect(resolveShipApp({ project: 'node', layoutOs: 'linux' }).app).toBe('node');
            expect(resolveShipApp({ project: 'node', layoutOs: 'darwin' }).key).toBe('gjsify.app');
        });

        await it('lets ONE target override the project default and leaves the others alone', async () => {
            // The split ADR 0024 § 4 argues for: GJS on Linux from the
            // distribution, Node where no relocatable GJS exists. Before #1486
            // saying the second half said the first half too.
            const perTarget = { darwin: 'node', win32: 'node' } as const;
            expect(resolveShipApp({ project: 'gjs', perTarget, layoutOs: 'linux' }).app).toBe('gjs');
            expect(resolveShipApp({ project: 'gjs', perTarget, layoutOs: 'darwin' }).app).toBe('node');
            expect(resolveShipApp({ project: 'gjs', perTarget, layoutOs: 'win32' }).app).toBe('node');
        });

        await it('reports which key answered, so the override is never silent', async () => {
            const overridden = resolveShipApp({ project: 'gjs', perTarget: { win32: 'node' }, layoutOs: 'win32' });
            expect(overridden.key).toBe('gjsify.ship.app.win32');
            expect(overridden.overridden).toBe(true);
            const inherited = resolveShipApp({ project: 'gjs', perTarget: { win32: 'node' }, layoutOs: 'linux' });
            expect(inherited.key).toBe('gjsify.app');
            expect(inherited.overridden).toBe(false);
        });

        await it('refuses a runtime that cannot be packaged, and names the key that carried it', async () => {
            // A browser bundle has no process to launch and a NativeScript app
            // ships as an APK/IPA. WHICH key said so matters now that two can:
            // "this project declares" no longer locates the value to edit.
            expect(() => resolveShipApp({ project: 'browser', layoutOs: 'linux' })).toThrow(
                '`gjsify.app` is "browser"',
            );
            // The cast is the POINT, not a workaround: this value arrives from a
            // JSON config file that TypeScript never sees, so the type is a
            // statement about our callers and the refusal is the only real check.
            const fromJson = { darwin: 'browser' } as unknown as ShipAppOptions;
            expect(() => resolveShipApp({ project: 'gjs', perTarget: fromJson, layoutOs: 'darwin' })).toThrow(
                '`gjsify.ship.app.darwin` is "browser"',
            );
            // And an unshippable PROJECT default is not reached when the target
            // overrides it: what ships is what the target says.
            expect(
                resolveShipApp({ project: 'nativescript', perTarget: { darwin: 'node' }, layoutOs: 'darwin' }).app,
            ).toBe('node');
        });

        await it('refuses a key it does not read, on the run that does not read it either', async () => {
            // THE SILENT ONE. `windows` is the `gjsify ship <os>` POSITIONAL's
            // spelling, so a runtime under it resolves to nothing, that target
            // quietly keeps `gjsify.app`, and the author reads the unchanged output
            // as gjsify not supporting the split — with every gate green.
            const misKeyed = { windows: 'node' } as unknown as ShipAppOptions;
            expect(() => resolveShipApp({ project: 'gjs', perTarget: misKeyed, layoutOs: 'win32' })).toThrow(
                '`gjsify.ship.app.windows` is not an OS',
            );
            // The WHOLE table is checked, not this run's key: `gjsify ship linux`
            // is the run most likely to be sitting in front of the typo, and a
            // check that only fires on the mis-keyed OS never fires at all.
            expect(() => resolveShipApp({ project: 'gjs', perTarget: misKeyed, layoutOs: 'linux' })).toThrow(
                '`gjsify.ship.app.windows` is not an OS',
            );
        });
    });

    await describe('descriptionParagraphs', async () => {
        await it('splits a string on blank lines and flattens bullet blocks', async () => {
            expect(descriptionParagraphs('One line.\n\nAnother\nparagraph.')).toStrictEqual([
                'One line.',
                'Another paragraph.',
            ]);
            expect(descriptionParagraphs([{ p: 'Intro' }, { ul: ['first', { item: 'second' }] }])).toStrictEqual([
                'Intro',
                '* first',
                '* second',
            ]);
        });

        await it('takes a bare string in the array as one paragraph', async () => {
            // What a person writes when they mean a paragraph. It used to reach `'p' in block` and
            // throw a raw TypeError naming neither the field nor the fix — from a config file, so
            // the message was the user's only clue.
            expect(descriptionParagraphs(['One   paragraph.', { p: 'And a block.' }])).toStrictEqual([
                'One paragraph.',
                'And a block.',
            ]);
            // Empty strings contribute nothing rather than an empty paragraph, which deb renders
            // as a stray ` .` line.
            expect(descriptionParagraphs(['', '   ', 'Kept.'])).toStrictEqual(['Kept.']);
        });
    });
};
