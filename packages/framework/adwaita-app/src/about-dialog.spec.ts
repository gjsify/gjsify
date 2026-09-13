// @gjsify/adwaita-app — About-dialog-from-AppStream tests. GJS + a GTK runtime, no display.
//
// THIS SUITE RUNS THE WINDOWS PATH ON LINUX, ON PURPOSE. `createAboutDialog` only assembles
// the dialog by hand where `Adw.AboutDialog.new_from_appdata()` is missing, which is the win32
// GTK runtime and nowhere else (gvsbuild's `#ifndef G_OS_WIN32` patch — gjsify/gjsify#1662).
// Calling the public entry point on a machine that HAS the constructor would therefore prove
// nothing about the branch that ships to Windows, so `buildAboutDialogFromAppdata` is exported
// and `forceParsedAppdata` exists: what runs below is the same code, byte for byte, that a
// Windows user's About dialog is drawn from.
//
// What it does NOT prove: that libadwaita's own reading of the same document agrees field for
// field. The Linux libadwaita here is 1.9.3, which parses through the full `appstream` library
// rather than the `ministream` that `appdata.ts` ports, and holding a GResource fixture against
// it would need `glib-compile-resources`, which this package treats as optional. The claim made
// here is the narrower one: the fields land where upstream's documented list says they land.
//
// NO DISPLAY REQUIRED: `Gtk.init_check()` returns false on a headless runner and every
// assertion below reads a property off a constructed dialog, never a rendered one.

import { describe, expect, it } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    buildAboutDialogFromAppdata,
    createAboutDialog,
    hasAppdataConstructor,
    licenseTypeFor,
} from './about-dialog.js';

// GTK has to be initialised before a widget type exists; `init_check` is the form that
// survives having no display, where `init()` would abort.
Gtk.init_check();

const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>org.example.Notes</id>
  <project_license>MPL-2.0</project_license>
  <name>Notes</name>
  <name xml:lang="de">Notizen</name>
  <summary>Take notes</summary>
  <developer id="org.example">
    <name translate="no">Example Collective</name>
    <name xml:lang="de">Beispiel-Kollektiv</name>
  </developer>
  <url type="homepage">https://example.org/notes</url>
  <url type="bugtracker">https://example.org/notes/issues</url>
  <url type="help">https://example.org/notes/docs</url>
  <releases>
    <release version="2.1.0" date="2026-08-01">
      <description><p>Faster startup.</p></description>
    </release>
  </releases>
</component>
`;

/**
 * The same document with no translations at all.
 *
 * `createAboutDialog` resolves translations against the PROCESS locale, exactly as the
 * upstream constructor does — there is deliberately no `locale` option, since one would make
 * the same call mean different things on Windows and on Linux. So an end-to-end assertion on
 * `applicationName` against the translated fixture passes or fails by whatever `LANG` the
 * runner happens to have: it read "Notizen" on the German workstation it was written on.
 */
const METAINFO_UNTRANSLATED = METAINFO.replace(/\n\s*<name xml:lang="de">[^<]*<\/name>/g, '');

/** The metainfo written to a real file, so the file-source path is exercised as a file. */
function metainfoFile(contents: string): string {
    const dir = GLib.Dir.make_tmp('gjsify-about-XXXXXX');
    const path = GLib.build_filenamev([dir, 'org.example.Notes.metainfo.xml']);
    GLib.file_set_contents(path, contents);
    return path;
}

/**
 * Every SPDX id libadwaita maps, transcribed from `gtk_license_info` and `license_aliases`
 * a SECOND time on purpose.
 *
 * A test that imported the module's own table would agree with it by construction and could
 * only ever pass. Both halves are read off `adw-about-dialog.c`, so a disagreement means one
 * transcription is wrong — which is the only way a typo in a licence row is ever found, given
 * that the row is exercised on Windows alone.
 */
const SPDX_LICENSES: [string, Gtk.License][] = [
    ['GPL-2.0-or-later', Gtk.License.GPL_2_0],
    ['GPL-3.0-or-later', Gtk.License.GPL_3_0],
    ['LGPL-2.1-or-later', Gtk.License.LGPL_2_1],
    ['LGPL-3.0-or-later', Gtk.License.LGPL_3_0],
    ['BSD-2-Clause', Gtk.License.BSD],
    ['MIT', Gtk.License.MIT_X11],
    ['Artistic-2.0', Gtk.License.ARTISTIC],
    ['GPL-2.0-only', Gtk.License.GPL_2_0_ONLY],
    ['GPL-3.0-only', Gtk.License.GPL_3_0_ONLY],
    ['LGPL-2.1-only', Gtk.License.LGPL_2_1_ONLY],
    ['LGPL-3.0-only', Gtk.License.LGPL_3_0_ONLY],
    ['AGPL-3.0-or-later', Gtk.License.AGPL_3_0],
    ['AGPL-3.0-only', Gtk.License.AGPL_3_0_ONLY],
    ['BSD-3-Clause', Gtk.License.BSD_3],
    ['Apache-2.0', Gtk.License.APACHE_2_0],
    ['MPL-2.0', Gtk.License.MPL_2_0],
    ['0BSD', Gtk.License['0BSD']],
    ['GPL-2.0', Gtk.License.GPL_2_0_ONLY],
    ['GPL-3.0', Gtk.License.GPL_3_0_ONLY],
];

export default async () => {
    await describe('licenseTypeFor', async () => {
        await it('maps every SPDX id libadwaita knows, aliases included', () => {
            for (const [spdxId, expected] of SPDX_LICENSES) {
                expect(licenseTypeFor(spdxId)).toBe(expected);
            }
            expect(SPDX_LICENSES.length).toBe(19);
        });

        // Upstream sets CUSTOM and no licence text. Filling the text with the raw SPDX id
        // would be more helpful and would show a licence line on Windows that Linux does not.
        await it('answers an unknown id with CUSTOM and leaves the licence text empty', () => {
            expect(licenseTypeFor('WTFPL')).toBe(Gtk.License.CUSTOM);
            expect(licenseTypeFor('')).toBe(Gtk.License.CUSTOM);
            const dialog = buildAboutDialogFromAppdata(
                '<component><id>x</id><project_license>WTFPL</project_license></component>',
            );
            expect(dialog.licenseType).toBe(Gtk.License.CUSTOM);
            expect(dialog.license).toBe('');
        });
    });

    await describe('hasAppdataConstructor', async () => {
        await it('finds the constructor in a GTK runtime that has it', () => {
            // Linux and both darwin bundles do; this asserts the question is asked correctly,
            // not that the platform is Linux.
            expect(hasAppdataConstructor()).toBe(true);
            expect(hasAppdataConstructor(Adw)).toBe(true);
        });

        // The win32 shape as GJS reports it: the class resolves, the static is simply absent.
        await it('reports a namespace whose class lacks the static', () => {
            expect(hasAppdataConstructor({ AboutDialog: {} })).toBe(false);
            expect(hasAppdataConstructor({ AboutDialog: { new: () => ({}) } })).toBe(false);
            expect(hasAppdataConstructor({ AboutDialog: undefined })).toBe(false);
            expect(hasAppdataConstructor({})).toBe(false);
            expect(hasAppdataConstructor(null)).toBe(false);
            // NOT `hasAppdataConstructor(undefined)`: that is the default parameter, so it
            // asks about the real `Adw` and answers `true` here. Deliberate — the argument
            // exists to substitute a namespace, never to mean "no namespace".
            expect(hasAppdataConstructor(undefined)).toBe(true);
        });

        // The win32 shape as node-gi reports it, which is the literal #1662 measurement:
        // `Adw.AboutDialog.new_from_appdata -> THREW: no static method`. A lookup that only
        // compared against `undefined` would let that throw escape into the caller.
        await it('reports a namespace whose lookup throws instead of answering', () => {
            const throwing = {
                get AboutDialog(): unknown {
                    throw new TypeError("no static method 'new_from_appdata'");
                },
            };
            expect(hasAppdataConstructor(throwing)).toBe(false);

            const throwingStatic = {
                AboutDialog: {
                    get new_from_appdata(): unknown {
                        throw new TypeError("no static method 'new_from_appdata'");
                    },
                },
            };
            expect(hasAppdataConstructor(throwingStatic)).toBe(false);
        });
    });

    await describe('buildAboutDialogFromAppdata', async () => {
        await it('sets exactly the properties the upstream constructor sets', () => {
            const dialog = buildAboutDialogFromAppdata(METAINFO, { locale: 'C' });
            expect(dialog.applicationIcon).toBe('org.example.Notes');
            expect(dialog.applicationName).toBe('Notes');
            expect(dialog.developerName).toBe('Example Collective');
            expect(dialog.version).toBe('2.1.0');
            expect(dialog.website).toBe('https://example.org/notes');
            expect(dialog.issueUrl).toBe('https://example.org/notes/issues');
            expect(dialog.supportUrl).toBe('https://example.org/notes/docs');
            expect(dialog.licenseType).toBe(Gtk.License.MPL_2_0);
        });

        // AppStream's `<summary>` is not `Adw.AboutDialog:comments` and upstream never treats
        // it as one. Neither is `copyright` or `translator-credits` anywhere in the metainfo.
        // Inventing any of them would put text in the Windows dialog that Linux does not show.
        await it('leaves the properties upstream does not touch alone', () => {
            const dialog = buildAboutDialogFromAppdata(METAINFO);
            expect(dialog.comments).toBe('');
            expect(dialog.copyright).toBe('');
            expect(dialog.translatorCredits).toBe('');
            expect(dialog.license).toBe('');
        });

        await it('localises the dialog the way the upstream constructor does', () => {
            const dialog = buildAboutDialogFromAppdata(METAINFO, { locale: 'de-DE' });
            expect(dialog.applicationName).toBe('Notizen');
            expect(dialog.developerName).toBe('Beispiel-Kollektiv');
        });

        await it('fills the release notes and the version they belong to', () => {
            const dialog = buildAboutDialogFromAppdata(METAINFO, { releaseNotesVersion: '2.1.0' });
            expect(dialog.releaseNotesVersion).toBe('2.1.0');
            expect(dialog.releaseNotes).toBe('<p>Faster startup.</p>\n');
        });

        await it('leaves the release notes empty when no version asks for them', () => {
            const dialog = buildAboutDialogFromAppdata(METAINFO);
            expect(dialog.releaseNotes).toBe('');
            expect(dialog.releaseNotesVersion).toBe('');
        });
    });

    await describe('createAboutDialog', async () => {
        await it('reads the metainfo from a file when asked to skip the constructor', () => {
            const dialog = createAboutDialog({
                appdataPath: metainfoFile(METAINFO_UNTRANSLATED),
                forceParsedAppdata: true,
            });
            expect(dialog.applicationName).toBe('Notes');
            expect(dialog.licenseType).toBe(Gtk.License.MPL_2_0);
        });

        // A `gjsify ship` artifact may carry the metainfo beside the bundle rather than inside
        // a GResource. Upstream's constructor cannot read that at all, so an app packaged that
        // way would have no About dialog on ANY platform.
        await it('falls back from an unregistered resource to the file beside it', () => {
            const dialog = createAboutDialog({
                appdataResource: '/org/example/Nowhere/metainfo.xml',
                appdataPath: metainfoFile(METAINFO_UNTRANSLATED),
            });
            expect(dialog.applicationName).toBe('Notes');
            expect(dialog.version).toBe('2.1.0');
        });

        // THE POINT OF THE PRECEDING TEST IS THAT THE PROCESS IS STILL ALIVE, and this one
        // says so on its own. libadwaita reports a resource it cannot read with `g_error()`,
        // which ABORTS — a mistyped resource path would kill the application the moment the
        // user opens About, with no exception for any `catch` to see. `createAboutDialog`
        // asks `Gio.resources_get_info` first, so an unregistered resource becomes a dialog
        // built from whatever else answered.
        //
        // MEASURED by deleting that guard: this suite died at the previous test with
        // `Adwaita-ERROR **: Could not parse metadata file: The resource at
        // "/org/example/Nowhere/metainfo.xml" does not exist`, `gjs exited with signal
        // SIGTERM`, 11 of 22 tests reported and the remaining 11 never run. So the arm here
        // does not go RED when the guard goes — it takes the whole run with it, which is the
        // shape every `g_error()` regression has.
        await it('survives a resource path that does not resolve', () => {
            const dialog = createAboutDialog({ appdataResource: '/nonexistent/metainfo.xml' });
            expect(dialog).toBeInstanceOf(Adw.AboutDialog);
            expect(dialog.applicationName).toBe('');
        });

        await it('returns an empty dialog rather than throwing when nothing answers', () => {
            const dialog = createAboutDialog();
            expect(dialog).toBeInstanceOf(Adw.AboutDialog);
            expect(dialog.applicationName).toBe('');
        });

        // The overrides are applied AFTER the branch, so the same options mean the same thing
        // whether libadwaita or `appdata.ts` read the document.
        await it('lets an explicit version and icon win over the metainfo', () => {
            const dialog = createAboutDialog({
                appdataPath: metainfoFile(METAINFO_UNTRANSLATED),
                forceParsedAppdata: true,
                version: '3.0.0-rc1',
                applicationIcon: 'org.example.Notes-Devel',
            });
            expect(dialog.version).toBe('3.0.0-rc1');
            expect(dialog.applicationIcon).toBe('org.example.Notes-Devel');
            // Everything else still comes from the document.
            expect(dialog.applicationName).toBe('Notes');
        });
    });
};
