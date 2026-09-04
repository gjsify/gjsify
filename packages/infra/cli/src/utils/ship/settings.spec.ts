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
    resolveShipBundle,
    resolveShipSettings,
    type SettingsInput,
} from './settings.js';
import type { ConfigDataShip, ShipAppOptions } from '../../types/config-data.js';
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
            fontFiles: [],
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

    await describe('resolveShipBundle', async () => {
        await it('keeps every single-host project on gjsify.main', async () => {
            // Fall-through, not requirement: the table is what a two-host project
            // needs, and nothing about it is mandatory for one host.
            expect(resolveShipBundle({ pkg: { main: 'dist/app.js' }, ship: {}, layoutOs: 'linux' })).toStrictEqual({
                declared: 'dist/app.js',
                key: 'main',
                overridden: false,
                foreign: [],
            });
            const gjsifyMain = { main: 'lib/index.js', gjsify: { main: 'dist/app.gjs.mjs' } };
            const resolved = resolveShipBundle({ pkg: gjsifyMain, ship: {}, layoutOs: 'linux' });
            expect(resolved.declared).toBe('dist/app.gjs.mjs');
            expect(resolved.key).toBe('gjsify.main');
        });

        await it('gives each target its own entry, and names the key that answered', async () => {
            // The pair `gjsify.ship.app` makes necessary: that key moves the
            // launcher to `node`, and before #1545 nothing moved the payload with
            // it — so the `.app` shipped the GJS bundle and died on first import.
            const ship = { bundle: { darwin: 'dist/app.node.mjs', win32: 'dist/app.node.mjs' } };
            const darwin = resolveShipBundle({
                pkg: { gjsify: { main: 'dist/app.gjs.mjs' } },
                ship,
                layoutOs: 'darwin',
            });
            expect(darwin.declared).toBe('dist/app.node.mjs');
            expect(darwin.key).toBe('gjsify.ship.bundle.darwin');
            expect(darwin.overridden).toBe(true);
            const linux = resolveShipBundle({ pkg: { gjsify: { main: 'dist/app.gjs.mjs' } }, ship, layoutOs: 'linux' });
            expect(linux.declared).toBe('dist/app.gjs.mjs');
            expect(linux.key).toBe('gjsify.main');
            expect(linux.overridden).toBe(false);
        });

        await it('reads a plain string as one entry for every target', async () => {
            const ship = { bundle: 'dist/app.gjs.mjs' };
            expect(resolveShipBundle({ pkg: {}, ship, layoutOs: 'darwin' }).key).toBe('gjsify.ship.bundle');
            expect(resolveShipBundle({ pkg: {}, ship, layoutOs: 'darwin' }).foreign).toStrictEqual([]);
        });

        await it("names the OTHER targets' entries, which this payload must not carry", async () => {
            // Both bundles are built into ONE directory and `discoverPayload`
            // stages that directory whole, so without this list each artifact
            // carries the other's bundle — on macOS inside the signed `.app`.
            const ship = { bundle: { linux: 'dist/app.gjs.mjs', darwin: 'dist/app.node.mjs' } };
            expect(resolveShipBundle({ pkg: {}, ship, layoutOs: 'darwin' }).foreign).toStrictEqual([
                'dist/app.gjs.mjs',
            ]);
            // One file named for two targets is one file: dropping it would strip
            // the entry the artifact runs.
            const shared = { bundle: { linux: 'dist/app.mjs', darwin: 'dist/app.mjs' } };
            expect(resolveShipBundle({ pkg: {}, ship: shared, layoutOs: 'darwin' }).foreign).toStrictEqual([]);
        });

        await it("names the FALL-THROUGH entry too, which is #1545's own project shape", async () => {
            // Only darwin declares an entry; linux and win32 both resolve
            // `gjsify.main`. Reading the table alone would call darwin's payload
            // clean and leave the GJS bundle inside the signed `.app` — the exact
            // artifact the issue was filed about, minus the launcher.
            const pkg = { gjsify: { main: 'dist/app.gjs.mjs' } };
            const ship = { bundle: { darwin: 'dist/app.node.mjs' } };
            expect(resolveShipBundle({ pkg, ship, layoutOs: 'darwin' }).foreign).toStrictEqual(['dist/app.gjs.mjs']);
            // …and the targets that kept the fall-through have nothing to drop:
            // darwin's entry is theirs to exclude, once.
            expect(resolveShipBundle({ pkg, ship, layoutOs: 'linux' }).foreign).toStrictEqual(['dist/app.node.mjs']);
            // A project with no table at all resolves one entry everywhere.
            expect(resolveShipBundle({ pkg, ship: {}, layoutOs: 'darwin' }).foreign).toStrictEqual([]);
        });

        await it('refuses a key it does not read, on the run that does not read it either', async () => {
            // Same silence as `gjsify.ship.app.windows`, one key over: the target
            // keeps `gjsify.main` and every gate stays green.
            const misKeyed = { bundle: { windows: 'dist/app.node.mjs' } } as unknown as ConfigDataShip;
            expect(() => resolveShipBundle({ pkg: {}, ship: misKeyed, layoutOs: 'win32' })).toThrow(
                '`gjsify.ship.bundle.windows` is not an OS',
            );
            expect(() => resolveShipBundle({ pkg: {}, ship: misKeyed, layoutOs: 'linux' })).toThrow(
                '`gjsify.ship.bundle.windows` is not an OS',
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
