// The font-directory decision — pure TypeScript, so it runs with no font map, no display and no
// GI at all. That is the point of the split: `initFonts` cannot be exercised on a host whose Pango
// declines runtime registration, and the PRECEDENCE it depends on can be exercised everywhere.

import { describe, expect, it } from '@gjsify/unit';

import { FONT_FACE_EXTENSIONS, isFontFace, resolveFontDir, resolveFontSources } from './font-dir.js';

export default async () => {
    await describe('resolveFontDir', async () => {
        await it('answers undefined when nothing names a directory', async () => {
            // The ORDINARY case, and the reason it must be quiet rather than a warning: the
            // `gjsify ship` launcher exports GJSIFY_FONT_DIR only when it actually staged a face,
            // so an unset variable means "this application ships none", not "something is wrong".
            expect(resolveFontDir({ env: {} })).toBeUndefined();
            expect(resolveFontDir()).toBeUndefined();
        });

        await it('reads GJSIFY_FONT_DIR', async () => {
            expect(resolveFontDir({ env: { GJSIFY_FONT_DIR: '/opt/app/share/fonts/org.example.App' } })).toBe(
                '/opt/app/share/fonts/org.example.App',
            );
        });

        await it('lets an explicit option win over the environment', async () => {
            // A dev tree runs from `data/fonts` while a launcher-set variable may still be in the
            // environment from a previous `gjsify ship` install of the same app.
            expect(resolveFontDir({ fontDir: 'data/fonts', env: { GJSIFY_FONT_DIR: '/usr/share/fonts/x' } })).toBe(
                'data/fonts',
            );
        });

        await it('treats an empty or blank value as unset, never as the current directory', async () => {
            // The incident this guards is `resolveLocaleDir`'s one variable over: a wrapper script
            // that exports the variable unconditionally hands over `''`, and enumerating `''` reads
            // the CWD — so the same app would register whatever faces sit beside it when started
            // from a source tree and none when started from anywhere else.
            expect(resolveFontDir({ env: { GJSIFY_FONT_DIR: '' } })).toBeUndefined();
            expect(resolveFontDir({ env: { GJSIFY_FONT_DIR: '   ' } })).toBeUndefined();
            expect(resolveFontDir({ fontDir: '', env: { GJSIFY_FONT_DIR: '/real/dir' } })).toBe('/real/dir');
        });

        await it('trims, so a launcher line with a stray space still names the directory', async () => {
            expect(resolveFontDir({ env: { GJSIFY_FONT_DIR: '  /opt/app/fonts  ' } })).toBe('/opt/app/fonts');
        });
    });

    await describe('resolveFontSources', async () => {
        await it('finds the RUNTIME bundle faces with no application directory at all', async () => {
            // The Windows shape the whole mechanism exists for: the app ships no face of its own,
            // and the GNOME UI typeface still has to reach the font map — because on that host
            // nothing installed it and pangowin32 reads no fontconfig path.
            expect(resolveFontSources({ env: { GJSIFY_GTK_RUNTIME_FONT_DIR: '/app/gtk/share/fonts' } })).toStrictEqual([
                { dir: '/app/gtk/share/fonts', origin: 'runtime' },
            ]);
        });

        await it('registers BOTH, runtime first', async () => {
            // Two sources answering two different questions: the platform's typeface and this
            // application's brand face. An app must never have to choose between them, which is
            // why they are separate variables rather than one contested one.
            expect(
                resolveFontSources({
                    env: {
                        GJSIFY_GTK_RUNTIME_FONT_DIR: '/app/gtk/share/fonts',
                        GJSIFY_FONT_DIR: '/app/share/fonts/org.example.App',
                    },
                }),
            ).toStrictEqual([
                { dir: '/app/gtk/share/fonts', origin: 'runtime' },
                { dir: '/app/share/fonts/org.example.App', origin: 'app' },
            ]);
        });

        await it('collapses two variables naming ONE directory', async () => {
            // `add_font_file` has no unregister and a doubled call is a doubled walk over the
            // same faces; a dev tree that points both at the same place must not pay for it.
            expect(
                resolveFontSources({
                    env: { GJSIFY_GTK_RUNTIME_FONT_DIR: '/fonts', GJSIFY_FONT_DIR: '/fonts' },
                }),
            ).toStrictEqual([{ dir: '/fonts', origin: 'runtime' }]);
        });

        await it('is empty when nothing names a directory, and treats "" as unset', async () => {
            // The Linux shape, and the ordinary one: no bundle is active, so nothing is named and
            // `initFonts` never touches Pango. An empty value must not read as the CURRENT
            // directory — a font map that depends on the caller's cwd is the silent-substitution
            // class this exists against.
            expect(resolveFontSources({ env: {} })).toStrictEqual([]);
            expect(
                resolveFontSources({ env: { GJSIFY_GTK_RUNTIME_FONT_DIR: '  ', GJSIFY_FONT_DIR: '' } }),
            ).toStrictEqual([]);
        });

        await it('lets explicit options win over both variables', async () => {
            expect(
                resolveFontSources({
                    runtimeFontDir: 'tmp/bundle-fonts',
                    fontDir: 'data/fonts',
                    env: { GJSIFY_GTK_RUNTIME_FONT_DIR: '/app/gtk/share/fonts', GJSIFY_FONT_DIR: '/usr/share/x' },
                }),
            ).toStrictEqual([
                { dir: 'tmp/bundle-fonts', origin: 'runtime' },
                { dir: 'data/fonts', origin: 'app' },
            ]);
        });
    });

    await describe('isFontFace', async () => {
        await it('accepts exactly the four desktop faces `gjsify ship` stages', async () => {
            expect([...FONT_FACE_EXTENSIONS]).toStrictEqual(['.ttf', '.otf', '.ttc', '.otc']);
            for (const ext of FONT_FACE_EXTENSIONS) expect(isFontFace(`Brand${ext}`)).toBe(true);
        });

        await it('is case-insensitive', async () => {
            // `BRAND.TTF` is an ordinary name on the case-preserving filesystems macOS and Windows
            // have; a lowercase-only test drops it and the app renders in a substituted family.
            expect(isFontFace('BRAND.TTF')).toBe(true);
            expect(isFontFace('Brand.OtF')).toBe(true);
        });

        await it('refuses the web-font wrappers the writer refuses by name', async () => {
            // Whether FreeType opens one is a BUILD option of whichever FreeType the shipped
            // artifact loads, so a reader that accepted them would succeed on the packaging host
            // and substitute on the target.
            for (const name of ['Brand.woff', 'Brand.woff2', 'Brand.eot']) expect(isFontFace(name)).toBe(false);
        });

        await it('ignores the strays a font directory legitimately carries', async () => {
            for (const name of ['OFL.txt', 'README.md', 'fonts.dir', '.keep']) expect(isFontFace(name)).toBe(false);
        });

        await it('matches on the extension, not on the name containing it', async () => {
            expect(isFontFace('ttf')).toBe(false);
            expect(isFontFace('my.ttf.bak')).toBe(false);
        });
    });
};
