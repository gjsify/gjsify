// SPDX-License-Identifier: MIT
// The Debian changelog this writer renders — the file whose absence was the last
// error-severity lintian tag a `gjsify ship` `.deb` carried.
//
// Two things are worth pinning here rather than in the e2e. The TRAILER's spacing is
// the usual way this file is got wrong and lintian reports it as a parse error over
// the whole file, so it is asserted as bytes. And the Markdown reader has to survive
// what `release-it`'s conventional-changelog preset actually writes, which is not a
// tidy list of sentences.

import { describe, expect, it } from '@gjsify/unit';

import { changelogEntriesFor, renderDebianChangelog, rfc822 } from './changelog.js';
import type { PackSettings } from './types.js';

function settings(overrides: Partial<PackSettings> = {}): PackSettings {
    return {
        binaryName: 'hello',
        appId: 'org.example.Hello',
        name: 'Hello',
        version: '0.47.0',
        release: '1',
        maintainer: 'Dev <dev@example.org>',
        summary: 'A demo',
        description: ['A demo'],
        license: 'MIT',
        section: 'utils',
        group: 'Applications/System',
        extraDepends: { deb: [], rpm: [] },
        typelibPackages: {},
        app: 'gjs',
        minGjsVersion: '1.86',
        minNodeVersion: '24',
        flatpak: {
            runtime: 'org.gnome.Platform',
            runtimeVersion: '49',
            sdk: 'org.gnome.Sdk',
            finishArgs: [],
            cleanup: [],
        },
        ...overrides,
    } as PackSettings;
}

/** What `release-it`'s preset writes, links and all. */
const REAL = [
    '# Changelog',
    '',
    '## [0.47.0](https://github.com/gjsify/gjsify/compare/v0.46.0...v0.47.0) (2026-09-03)',
    '',
    '### Features',
    '',
    '* **gtk-host:** register shipped fonts at startup ([#1510](https://github.com/gjsify/gjsify/issues/1510)) ([a01680b](https://github.com/gjsify/gjsify/commit/a01680b))',
    '',
    '### Bug Fixes',
    '',
    '* **cli:** read back what publish just PUT ([#1509](https://github.com/gjsify/gjsify/issues/1509))',
    '',
    '## [0.46.0](https://github.com/gjsify/gjsify/compare/v0.45.0...v0.46.0) (2026-09-03)',
    '',
    '### Features',
    '',
    '* **adwaita:** one portable menu model',
    '',
].join('\n');

export default async () => {
    await describe('rfc822', async () => {
        await it('spells the date the way Policy § 4.4 asks, in UTC', async () => {
            // Month and day names come from a table here rather than from
            // `toLocaleString`, which answers in the host's locale — a package built
            // under `LANG=de_DE` would otherwise carry `Sa, 05 Sep`.
            expect(rfc822(1_788_611_696)).toBe('Sat, 05 Sep 2026 12:34:56 +0000');
            expect(rfc822(0)).toBe('Thu, 01 Jan 1970 00:00:00 +0000');
        });
    });

    await describe('changelogEntriesFor', async () => {
        await it('takes one version`s bullets and stops at the next release', async () => {
            expect(changelogEntriesFor('0.47.0', REAL)).toStrictEqual([
                'gtk-host: register shipped fonts at startup (#1510) (a01680b)',
                'cli: read back what publish just PUT (#1509)',
            ]);
        });

        await it('drops the category headings rather than rendering them as changes', async () => {
            // `### Bug Fixes` is a heading, and a Debian change block is a flat list —
            // a heading rendered as a bullet reads as a change that was made.
            for (const entry of changelogEntriesFor('0.47.0', REAL)) expect(entry).not.toContain('Bug Fixes');
        });

        await it('reads a first release, which carries no compare link', async () => {
            expect(changelogEntriesFor('1.0.0', '## 1.0.0 (2026-01-01)\n\n* first\n')).toStrictEqual(['first']);
        });

        await it('answers nothing for a version the file does not name', async () => {
            // Not an error: § 4.4 requires the FILE, not a particular history, and
            // `renderDebianChangelog` says so in one line instead.
            expect(changelogEntriesFor('9.9.9', REAL)).toStrictEqual([]);
            // `0.4.0` must not match the `0.47.0` heading — the version is escaped and
            // anchored, so a dot is a dot.
            expect(changelogEntriesFor('0.4.0', REAL)).toStrictEqual([]);
        });
    });

    await describe('renderDebianChangelog', async () => {
        await it('writes one entry, with the trailer spaced the way dpkg parses it', async () => {
            const text = renderDebianChangelog(settings(), REAL, 1_788_611_696);
            expect(text).toBe(
                'hello (0.47.0-1) unstable; urgency=medium\n' +
                    '\n' +
                    '  * gtk-host: register shipped fonts at startup (#1510) (a01680b)\n' +
                    '  * cli: read back what publish just PUT (#1509)\n' +
                    '\n' +
                    ' -- Dev <dev@example.org>  Sat, 05 Sep 2026 12:34:56 +0000\n',
            );
        });

        await it('wraps a long change so lintian`s 80-column tag stays silent', async () => {
            // MEASURED on lintian 2.117 against gjsify's own package: a conventional
            // subject plus its scope, its PR link and its `closes` list runs past 80 and
            // raised `debian-changelog-line-too-long` on line 4 of the first changelog
            // this writer ever produced.
            const long =
                '## 1.0.0 (2026-01-01)\n\n* iframe: depend on the win32 WebKit backend so that a ' +
                'downloaded application keeps working ([#1501](https://x/1)), closes [#1494](https://x/2)\n';
            const text = renderDebianChangelog(settings({ version: '1.0.0' }), long, 0);
            const body = text.split('\n').filter((line) => line.startsWith('  '));
            expect(body.length > 1).toBe(true);
            for (const line of body) expect(line.length <= 80).toBe(true);
            // Continuation lines are indented under the bullet text, never at the
            // bullet's own column, where they would read as a second change.
            expect(body[1]?.startsWith('    ')).toBe(true);
            expect(body.join(' ').replace(/\s+/g, ' ').trim()).toBe(
                '* iframe: depend on the win32 WebKit backend so that a downloaded application ' +
                    'keeps working (#1501), closes #1494',
            );
        });

        await it('carries the package version including its Debian revision', async () => {
            // It has to equal the control file's `Version:`, which `deb.ts` writes as
            // `<version>-<release>`; a changelog naming a different version is what
            // lintian reads as a mismatched entry.
            expect(renderDebianChangelog(settings({ release: '3' }), undefined, 0)).toContain('hello (0.47.0-3) ');
        });

        await it('says so in one line when the project names no changes', async () => {
            expect(renderDebianChangelog(settings({ homepage: 'https://example.org' }), undefined, 0)).toContain(
                '  * Release 0.47.0. See https://example.org for the upstream changes.\n',
            );
            expect(renderDebianChangelog(settings(), 'nothing about this version\n', 0)).toContain(
                '  * Release 0.47.0.\n',
            );
        });
    });
};
