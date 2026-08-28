// SPDX-License-Identifier: MIT
// What the three launcher forms do with the project's own `execArgs`.
//
// The SHAPE of each launcher is asserted against a real staged tree in
// `tests/e2e/ship-layout` — a rendered string compared with a rendered string
// proves nothing about what got written. What that suite cannot see is the
// argument path: `gjsify.ship.execArgs` is empty in every fixture, and the two
// quoting rules disagree in a way that is silent rather than loud. A `%` reaches
// `cmd.exe` as an expansion and the argument arrives EMPTY; a `'` reaches
// `/bin/sh` unquoted and the argument splits.

import { describe, expect, it } from '@gjsify/unit';

import { renderLauncher } from './launcher.js';
import { LAYOUTS } from './layout.js';
import type { ShipSettings } from './types.js';

function settings(execArgs: string[]): ShipSettings {
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
        section: 'gnome',
        group: 'Applications/System',
        kind: 'app',
        mimeTypes: [],
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        bundlePath: '/project/dist/gjs.js',
        bundleDir: '/project/dist',
        iconFiles: [],
        schemaFiles: [],
        typelibFiles: [],
        localeFiles: [],
        extraFiles: {},
        execArgs,
        outDir: 'ship',
        arch: 'x64',
        layoutOs: 'linux',
        minGjsVersion: '1.86',
        flatpak: {
            runtime: 'org.gnome.Platform',
            runtimeVersion: '50',
            sdk: 'org.gnome.Sdk',
            branch: 'stable',
            sdkExtensions: [],
            appendPath: [],
            finishArgs: [],
            cleanup: [],
        },
    };
}

export default async () => {
    await describe('ship launcher arguments', async () => {
        await it('single-quotes for /bin/sh, on both POSIX layouts', () => {
            const args = ["it's", '--flag=a b'];
            for (const layout of [LAYOUTS.linux, LAYOUTS.darwin]) {
                const rendered = renderLauncher(settings(args), 'gjs.js', layout);
                expect(rendered.includes(`'it'\\''s' '--flag=a b'`)).toBe(true);
            }
        });

        await it('double-quotes for cmd.exe', () => {
            const rendered = renderLauncher(settings(['--flag=a b']), 'gjs.js', LAYOUTS.windows);
            expect(rendered.includes('"--flag=a b"')).toBe(true);
        });

        await it('refuses an argument cmd.exe cannot carry, naming the config key', () => {
            // `%` expands at PARSE time, so `%PATH%` in an execArg does not reach
            // the app as those six characters — it reaches it as the machine's
            // PATH, or as nothing. `"` ends the quoted run with no escape that
            // reliably re-opens it. Both are wrong argv at exit 0, which is why
            // they are refused rather than escaped.
            for (const bad of ['100%', 'say "hi"', 'a!b']) {
                expect(() => renderLauncher(settings([bad]), 'gjs.js', LAYOUTS.windows)).toThrow(
                    'gjsify.ship.execArgs',
                );
            }
            // The same three are ordinary arguments on a POSIX layout.
            for (const bad of ['100%', 'say "hi"', 'a!b']) {
                expect(renderLauncher(settings([bad]), 'gjs.js', LAYOUTS.linux).includes(bad)).toBe(true);
            }
        });
    });
};
