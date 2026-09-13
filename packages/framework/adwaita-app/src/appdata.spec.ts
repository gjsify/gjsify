// @gjsify/adwaita-app — AppStream field reader tests.
// Runs on GJS + Node (pure parsing, explicit locale — no platform imports).
//
// THE ARM THAT NO PLATFORM RUN WOULD COVER. `parseAppdata` feeds the About dialog ONLY where
// `Adw.AboutDialog.new_from_appdata()` is missing, which is Windows and nowhere else. Every
// Linux and macOS run — CI included — takes the upstream constructor and never enters this
// code. So the fixture below is a whole, realistic metainfo document rather than a snippet
// per field: a restructured `<developer>` block or a moved `<releases>` list can empty the
// About dialog on one platform while the other two stay perfectly green.

import { describe, expect, it } from '@gjsify/unit';
import { appdataLocale, localeScore, parseAppdata } from './appdata.js';

/**
 * A complete metainfo document, partially translated on purpose.
 *
 * The `<developer><name>` beside the component's own `<name>`, the `<url>` kind nothing reads
 * (`donation`), the `<screenshots>` subtree and the second release are all load-bearing: each
 * one is a place a field could be read from by accident.
 */
const METAINFO = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2026 The Example Collective -->
<component type="desktop-application">
  <id>org.example.Notes</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0-or-later</project_license>
  <name>Notes</name>
  <name xml:lang="de">Notizen</name>
  <name xml:lang="fr">Notes rapides</name>
  <summary>Take notes</summary>
  <summary xml:lang="de">Notizen machen</summary>
  <developer id="org.example">
    <name translate="no">Example Collective</name>
    <name xml:lang="de">Beispiel-Kollektiv</name>
  </developer>
  <launchable type="desktop-id">org.example.Notes.desktop</launchable>
  <url type="homepage">https://example.org/notes</url>
  <url type="bugtracker">https://example.org/notes/issues</url>
  <url type="help">https://example.org/notes/docs</url>
  <url type="donation">https://example.org/donate</url>
  <screenshots>
    <screenshot type="default">
      <caption>The main window</caption>
      <image>https://example.org/1.png</image>
    </screenshot>
  </screenshots>
  <releases>
    <release version="2.1.0" date="2026-08-01">
      <description>
        <p>Faster startup &amp; a calmer sidebar.</p>
        <p xml:lang="de">Schnellerer Start &amp; eine ruhigere Seitenleiste.</p>
        <ul>
          <li>Search is now <em>incremental</em>.</li>
          <li xml:lang="de">Die Suche ist jetzt <em>inkrementell</em>.</li>
          <li>Fixed <code>--export</code> on empty notebooks.</li>
        </ul>
      </description>
    </release>
    <release version="2.0.0" date="2026-05-04">
      <description>
        <p>The rewrite.</p>
      </description>
    </release>
  </releases>
</component>
`;

export default async () => {
    await describe('localeScore', async () => {
        await it('counts matching BCP-47 segments', () => {
            expect(localeScore('de-DE', 'de-DE')).toBe(2);
            expect(localeScore('de-DE', 'de')).toBe(1);
            expect(localeScore('de', 'de-DE')).toBe(1);
            expect(localeScore('C', 'C')).toBe(1);
        });

        // Crediting the matching prefix would let a Swiss German string outrank the
        // untranslated one for an Austrian user — a wrong answer instead of no answer.
        await it('scores a mismatch inside a segment as no match at all', () => {
            expect(localeScore('de-DE', 'de-AT')).toBe(0);
            expect(localeScore('de', 'fr')).toBe(0);
            expect(localeScore('de-DE', '')).toBe(0);
        });
    });

    await describe('appdataLocale', async () => {
        await it('takes the most specific language name, without the encoding', () => {
            expect(appdataLocale(['de_DE.UTF-8', 'de_DE', 'de', 'C'])).toBe('de-DE');
            expect(appdataLocale(['de_DE', 'de', 'C'], { LANG: 'fr_FR.UTF-8' })).toBe('de-DE');
        });

        // GLib answers a bare `de` in some configurations even under `LANG=de_AT`, and a
        // region-specific translation has to keep winning there.
        await it('borrows the region from LANG when the language name has none', () => {
            expect(appdataLocale(['de', 'C'], { LANG: 'de_AT.UTF-8' })).toBe('de-AT');
            expect(appdataLocale(['de', 'C'], { LANG: 'C' })).toBe('de');
            expect(appdataLocale(['de', 'C'])).toBe('de');
        });

        await it('turns an @variant into a script subtag and falls back to C', () => {
            expect(appdataLocale(['sr@cyrillic'])).toBe('sr-Cyrl');
            expect(appdataLocale(['de_DE@euro'])).toBe('de-DE');
            expect(appdataLocale([])).toBe('C');
        });
    });

    await describe('parseAppdata', async () => {
        await it('reads every field the upstream constructor sets', () => {
            const fields = parseAppdata(METAINFO);
            expect(fields.applicationId).toBe('org.example.Notes');
            expect(fields.applicationName).toBe('Notes');
            expect(fields.developerName).toBe('Example Collective');
            expect(fields.version).toBe('2.1.0');
            expect(fields.website).toBe('https://example.org/notes');
            expect(fields.issueUrl).toBe('https://example.org/notes/issues');
            expect(fields.supportUrl).toBe('https://example.org/notes/docs');
            expect(fields.license).toBe('GPL-3.0-or-later');
        });

        // The upstream constructor is localised: a German session gets the translated name.
        // A fallback that always took the untranslated element would ship an English title to
        // every non-English user, and only on the platform where the fallback runs.
        await it('resolves a translated name and developer against the locale', () => {
            const german = parseAppdata(METAINFO, { locale: 'de-DE' });
            expect(german.applicationName).toBe('Notizen');
            expect(german.developerName).toBe('Beispiel-Kollektiv');

            const french = parseAppdata(METAINFO, { locale: 'fr-FR' });
            expect(french.applicationName).toBe('Notes rapides');
            // No French developer name exists, so the untranslated one must answer.
            expect(french.developerName).toBe('Example Collective');
        });

        await it('keeps the untranslated string for a language the document does not carry', () => {
            const spanish = parseAppdata(METAINFO, { locale: 'es-ES' });
            expect(spanish.applicationName).toBe('Notes');
            expect(spanish.developerName).toBe('Example Collective');
        });

        // `<name>` is also a child of `<developer>`. Reading it by name alone would put the
        // vendor in the dialog's title.
        await it('does not mistake a nested name for the application name', () => {
            const fields = parseAppdata('<component><developer><name>Vendor</name></developer></component>');
            expect(fields.applicationName).toBeNull();
            expect(fields.developerName).toBe('Vendor');
        });

        await it('reads the legacy developer_name, and prefers <developer> over it', () => {
            const legacy = parseAppdata('<component><developer_name>Old Vendor</developer_name></component>');
            expect(legacy.developerName).toBe('Old Vendor');

            // ministream shifts the `<developer>` score by 1024 so the modern spelling wins
            // regardless of document order or how well the legacy one matches the locale.
            const both = parseAppdata(
                '<component><developer_name xml:lang="de">Alt</developer_name>' +
                    '<developer><name>New Vendor</name></developer></component>',
                { locale: 'de-DE' },
            );
            expect(both.developerName).toBe('New Vendor');
        });

        // Document order, not just score: with the translation written FIRST, a reader that
        // only compared scores would take it (1024 either way) and hand a Spanish user the
        // German vendor name. ministream's second condition is what refuses it.
        await it('refuses a non-matching developer translation written before the source', () => {
            const xml =
                '<component><developer>' +
                '<name xml:lang="de">Beispiel-Kollektiv</name>' +
                '<name>Example Collective</name>' +
                '</developer></component>';
            expect(parseAppdata(xml, { locale: 'es-ES' }).developerName).toBe('Example Collective');
            expect(parseAppdata(xml, { locale: 'de-DE' }).developerName).toBe('Beispiel-Kollektiv');
        });

        await it('ignores a url kind it does not read', () => {
            const fields = parseAppdata(METAINFO);
            expect(fields.website).toBe('https://example.org/notes');
            expect(fields.supportUrl).toBe('https://example.org/notes/docs');
        });

        await it('reports nothing for a document with no component and for absent fields', () => {
            const none = parseAppdata('<nonsense><id>x</id></nonsense>');
            expect(none.applicationId).toBeNull();
            expect(none.applicationName).toBeNull();

            const minimal = parseAppdata('<component><id>org.example.Bare</id></component>');
            expect(minimal.applicationId).toBe('org.example.Bare');
            expect(minimal.applicationName).toBeNull();
            expect(minimal.version).toBeNull();
            expect(minimal.license).toBeNull();
            expect(minimal.releaseNotes).toBeNull();
        });

        await it('treats a present but empty element as absent', () => {
            const fields = parseAppdata('<component><id>x</id><project_license>  </project_license></component>');
            expect(fields.license).toBeNull();
        });

        await it('strips indentation from an element written across lines', () => {
            const fields = parseAppdata('<component><id>\n      org.example.Wrapped\n  </id></component>');
            expect(fields.applicationId).toBe('org.example.Wrapped');
        });

        // Upstream's rule, transcribed: `<id>` losing its `.desktop` suffix is what makes the
        // dialog's icon name match the installed icon rather than a file name.
        await it('resolves a .desktop suffix on the id the way libadwaita does', () => {
            const stripped = parseAppdata('<component><id>org.example.App.desktop</id></component>');
            expect(stripped.applicationId).toBe('org.example.App');

            const kept = parseAppdata(
                '<component><id>org.example.App.desktop</id>' +
                    '<launchable type="desktop-id">org.example.App.desktop.desktop</launchable></component>',
            );
            expect(kept.applicationId).toBe('org.example.App.desktop');
        });

        // The asymmetry is upstream's: `<id>`, `<project_license>` and `<releases>` warn about
        // a repeat and keep the first, `<url>` has no such guard and the last one overwrites.
        await it('keeps the first id and licence but the last url of a kind', () => {
            const fields = parseAppdata(
                '<component><id>first</id><id>second</id>' +
                    '<project_license>MIT</project_license><project_license>GPL-3.0-only</project_license>' +
                    '<url type="homepage">https://a.example</url>' +
                    '<url type="homepage">https://b.example</url></component>',
            );
            expect(fields.applicationId).toBe('first');
            expect(fields.license).toBe('MIT');
            expect(fields.website).toBe('https://b.example');
        });
    });

    await describe('parseAppdata release notes', async () => {
        await it('takes the version of the first release as the version', () => {
            expect(parseAppdata(METAINFO).version).toBe('2.1.0');
        });

        await it('reports no notes until a version asks for them', () => {
            expect(parseAppdata(METAINFO).releaseNotes).toBeNull();
        });

        await it('renders the named release as the markup the dialog parses', () => {
            const notes = parseAppdata(METAINFO, { releaseNotesVersion: '2.1.0' }).releaseNotes;
            expect(notes).toBe(
                '<p>Faster startup &amp; a calmer sidebar.</p>\n' +
                    '<ul>\n' +
                    '<li>Search is now <em>incremental</em>.</li>\n' +
                    '<li>Fixed <code>--export</code> on empty notebooks.</li>\n' +
                    '</ul>\n',
            );
        });

        await it('selects a release by exact string equality, never by version order', () => {
            expect(parseAppdata(METAINFO, { releaseNotesVersion: '2.0.0' }).releaseNotes).toBe('<p>The rewrite.</p>\n');
            // `2.1` is not `2.1.0`. libadwaita compares with `g_strcmp0` and reports no
            // release; guessing at a match here would show the wrong notes on Windows alone.
            expect(parseAppdata(METAINFO, { releaseNotesVersion: '2.1' }).releaseNotes).toBeNull();
            expect(parseAppdata(METAINFO, { releaseNotesVersion: '9.9.9' }).releaseNotes).toBeNull();
        });

        // AppStream interleaves translations paragraph by paragraph. A reader that picked a
        // language once and then read straight through would emit the German second paragraph
        // after the English first, in one dialog.
        await it('keeps a language whole across interleaved paragraphs and list items', () => {
            const notes = parseAppdata(METAINFO, { releaseNotesVersion: '2.1.0', locale: 'de-DE' }).releaseNotes;
            expect(notes).toBe(
                '<p>Schnellerer Start &amp; eine ruhigere Seitenleiste.</p>\n' +
                    '<ul>\n' +
                    '<li>Die Suche ist jetzt <em>inkrementell</em>.</li>\n' +
                    '</ul>\n',
            );
        });

        // A language whose only paragraph is a list item still needs the `<ul>` opened in its
        // own buffer — without it the dialog's markup parser gets a bare `</ul>` and prints a
        // parse error where the notes should be.
        await it('opens the list for a language first seen inside it', () => {
            const notes = parseAppdata(
                '<component><id>x</id><releases><release version="1.0"><description>' +
                    '<p>Only in English.</p>' +
                    '<ul><li>English item</li><li xml:lang="de">Deutscher Punkt</li></ul>' +
                    '</description></release></releases></component>',
                { releaseNotesVersion: '1.0', locale: 'de-DE' },
            );
            expect(notes.releaseNotes).toBe('<ul>\n<li>Deutscher Punkt</li>\n</ul>\n');
        });

        await it('falls back to the untranslated notes for an unknown language', () => {
            const notes = parseAppdata(METAINFO, { releaseNotesVersion: '2.0.0', locale: 'es-ES' }).releaseNotes;
            expect(notes).toBe('<p>The rewrite.</p>\n');
        });

        // The markup goes to `Adw.AboutDialog:release-notes`, which parses it. An unescaped
        // `&` or `<` from the metainfo is a parse error the dialog prints IN PLACE of the
        // notes, so escaping is not cosmetic.
        await it('escapes text and keeps only the inline tags the dialog accepts', () => {
            const notes = parseAppdata(
                '<component><id>x</id><releases><release version="1.0"><description>' +
                    '<p>a &amp; b &lt; c, <em>kept</em>, <code>kept</code>, <b>dropped</b></p>' +
                    '</description></release></releases></component>',
                { releaseNotesVersion: '1.0' },
            );
            expect(notes.releaseNotes).toBe('<p>a &amp; b &lt; c, <em>kept</em>, <code>kept</code>, </p>\n');
        });

        // A metainfo file indents its release notes. Passing that through would reach the
        // dialog as it was typed, newlines and all.
        await it('collapses the indentation a metainfo file writes around its text', () => {
            const notes = parseAppdata(
                '<component><id>x</id><releases><release version="1.0"><description>\n' +
                    '        <p>\n          One   two\n          three\n        </p>\n' +
                    '      </description></release></releases></component>',
                { releaseNotesVersion: '1.0' },
            );
            expect(notes.releaseNotes).toBe('<p>One two three </p>\n');
        });
    });
};
