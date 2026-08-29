// SPDX-License-Identifier: MIT
// What a non-Linux layout carries that only a Linux package makes work.
//
// `linuxInstallDependent` had one caller, zero tests, and a comment claiming its
// rules "cannot drift" from `cacheRefreshCommands`. That claim was measured false:
// pointing one rule at a directory matching nothing silently dropped a file from
// the warning `gjsify ship` prints, and the e2e suite stayed green at exit 0 —
// because it re-derived the expected set from its own regular expression and never
// called this function. The prose was the mechanism, which is to say there was
// none.
//
// Two things replace it. `SHARE` is one constant the four call sites import, so
// the compiler holds them together; and the rule is EXHAUSTIVE rather than an
// allow-list, so a directory nobody classified is reported instead of passing.
// These tests are the second half of that: they call the function.

import { describe, expect, it } from '@gjsify/unit';

import { linuxInstallDependent } from './payload.js';
import { SHARE } from './share-dirs.js';

const at = (...paths: string[]) => paths.map((path) => ({ path }));
const paths = (entries: readonly { path: string }[]) => entries.map((entry) => entry.path);

export default async () => {
    await describe('linuxInstallDependent', async () => {
        await it('names every share/ directory whose Linux correctness is an install step', () => {
            const carried = linuxInstallDependent(
                at(
                    `${SHARE.schemas}/org.example.App.gschema.xml`,
                    `${SHARE.mime}/org.example.App.xml`,
                    `${SHARE.icons}/scalable/apps/org.example.App.svg`,
                    `${SHARE.applications}/org.example.App.desktop`,
                    `${SHARE.metainfo}/org.example.App.metainfo.xml`,
                ),
            );
            expect(carried.length).toBe(5);
            // The schema comes FIRST and is the only `aborts`: every launcher
            // exports XDG_DATA_DIRS at the staged `share/`, so a schema directory
            // with no `gschemas.compiled` makes `g_settings_new()` abort. The
            // other four merely do nothing, and ranking all five alike buried it.
            expect(carried[0]?.path).toBe(`${SHARE.schemas}/org.example.App.gschema.xml`);
            expect(carried[0]?.verdict).toBe('aborts');
            expect(carried.filter((entry) => entry.verdict === 'aborts').length).toBe(1);
            expect(carried.filter((entry) => entry.verdict === 'inert').length).toBe(4);
        });

        await it('reports a share/ directory nothing classifies, instead of passing it', () => {
            // The direction the allow-list version got wrong. A D-Bus service file
            // added through `gjsify.ship.extraFiles` is meaningful on Linux only
            // because the package installs it into a system prefix; the closed
            // list said "carries 5 file(s)" for a payload carrying six.
            const carried = linuxInstallDependent(at('share/dbus-1/services/org.example.App.service'));
            expect(carried.length).toBe(1);
            expect(carried[0]?.verdict).toBe('unknown');
            expect(carried[0]?.why).toContain('nothing here classifies');
        });

        await it('lets the one genuinely portable directory through', () => {
            // A `.mo` is read straight off disk by `bindtextdomain`, with no
            // install step anywhere, and every layout's launcher hands over its
            // directory. That is what makes the inverse rule usable rather than
            // a warning on every file.
            expect(linuxInstallDependent(at(`${SHARE.locale}/de/LC_MESSAGES/app.mo`))).toStrictEqual([]);
        });

        await it('ignores everything outside share/', () => {
            expect(linuxInstallDependent(at('bin/app', 'lib/app/gjs.js', 'lib/app/gi/x.typelib'))).toStrictEqual([]);
        });

        await it('respects directory boundaries', () => {
            // `share/mimetypes/` is not inside `share/mime/`, and a `startsWith`
            // on the bare name would say it is — then classify it with the wrong
            // rule and print the wrong reason.
            const carried = linuxInstallDependent(at('share/mimetypes/x.xml'));
            expect(paths(carried)).toStrictEqual(['share/mimetypes/x.xml']);
            expect(carried[0]?.verdict).toBe('unknown');
        });
    });
};
