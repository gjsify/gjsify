// SPDX-License-Identifier: MIT
// The dependency derivation, and the refusal that is its whole point.
//
// The reference implementation this design comes from returns `[]` for a GI
// namespace its table does not know. That produces a package which installs
// cleanly and dies on first launch with a dynamic-linker error — on the user's
// machine, after the download, reading like an application bug. So the case
// worth testing hardest here is the one that must FAIL.

import { describe, expect, it } from '@gjsify/unit';

import { deriveDepends, formatDebDepend, knownNamespaces, parseDepend, warnAboutGjsFloor } from './depends.js';
import { resolveFormats } from './formats.js';
import { parseGiSpecifier, scanGiNamespaces } from './gi-namespaces.js';

const base = { hasIcons: true, hasSchemas: false, extra: [] };

export default async () => {
    await describe('deriveDepends', async () => {
        await it('needs no distro package for a typelib the payload carries', async () => {
            // `Gwebgl` has no `gir1.2-…` anywhere: it arrives as an npm prebuild. Without this the
            // check fails every project that uses gjsify's WebGL bridge.
            const depends = deriveDepends('deb', {
                namespaces: ['Gtk-4.0', 'Gwebgl-0.1'],
                hasIcons: true,
                hasSchemas: false,
                extra: [],
                bundledTypelibs: ['/p/gi/Gwebgl-0.1.typelib', '/p/gi/libgwebgl.so'],
            });
            expect(depends.some((d) => d.includes('gwebgl'))).toBe(false);
            expect(depends.some((d) => d.includes('gtk-4'))).toBe(true);
        });

        await it('still fails for a namespace nothing ships and nothing maps', async () => {
            // The exemption is derived from the STAGED FILES. Shipping one typelib must not excuse a
            // different namespace — that would turn the check into a way of silencing itself.
            expect(() =>
                deriveDepends('deb', {
                    namespaces: ['Totally-1.0'],
                    hasIcons: true,
                    hasSchemas: false,
                    extra: [],
                    bundledTypelibs: ['/p/gi/Gwebgl-0.1.typelib'],
                }),
            ).toThrow('no deb package is known');
        });

        await it('maps namespaces to the package that ships the typelib, per format', async () => {
            const namespaces = ['Gtk-4.0', 'Adw-1', 'Gio-2.0'];
            expect(deriveDepends('deb', { ...base, namespaces })).toStrictEqual([
                'gjs >= 1.86',
                'gir1.2-adw-1',
                'gir1.2-glib-2.0',
                'gir1.2-gtk-4.0',
                'hicolor-icon-theme',
            ]);
            expect(deriveDepends('rpm', { ...base, namespaces })).toStrictEqual([
                'gjs >= 1.86',
                'libadwaita',
                'glib2',
                'gtk4',
                'hicolor-icon-theme',
            ]);
        });

        await it('collapses namespaces that share one package', async () => {
            const depends = deriveDepends('rpm', { ...base, namespaces: ['Gtk-4.0', 'Gdk-4.0', 'Gsk-4.0'] });
            expect(depends.filter((entry) => entry === 'gtk4').length).toBe(1);
        });

        await it('resolves an unpinned specifier when the table has exactly one version', async () => {
            expect(deriveDepends('rpm', { ...base, namespaces: ['Gtk'] })).toContain('gtk4');
        });

        await it('FAILS on a namespace it cannot map, naming it and the escape hatch', async () => {
            expect(() => deriveDepends('deb', { ...base, namespaces: ['Gst', 'Nautilus-3.0'] })).toThrow(
                'gi://Nautilus',
            );
            expect(() => deriveDepends('deb', { ...base, namespaces: ['Nautilus-3.0'] })).toThrow('typelibPackages');
        });

        await it('skips a typelib the payload itself carries, rather than demanding a package for it', async () => {
            // `@gjsify/http`'s server imports `gi://GjsifyHttpSoupBridge`, which
            // reaches every bundle built on it. No distribution ships that
            // typelib and none can — the file is inside the tarball being built
            // — so the unmapped-namespace failure is the wrong answer here, and
            // until this it made `gjsify ship` throw for every such project.
            expect(
                deriveDepends('deb', { ...base, namespaces: ['GjsifyHttpSoupBridge-1.0', 'Gtk-4.0'] }),
            ).toStrictEqual(['gjs >= 1.86', 'gir1.2-gtk-4.0', 'hicolor-icon-theme']);
            // Anchored on the PascalCase the bridge builds emit, so a real
            // system namespace that merely starts with those letters still has
            // to be mapped.
            expect(() => deriveDepends('deb', { ...base, namespaces: ['Gjsifyish-1.0'] })).toThrow('gi://Gjsifyish');
        });

        await it('accepts a namespace once the project supplies the row', async () => {
            const depends = deriveDepends('deb', {
                ...base,
                namespaces: ['Nautilus-3.0'],
                typelibPackages: { 'Nautilus-3.0': { deb: 'gir1.2-nautilus-3.0', rpm: 'nautilus' } },
            });
            expect(depends).toContain('gir1.2-nautilus-3.0');
        });

        await it('does NOT let free-form `depends` silence an unmapped namespace', async () => {
            // A hatch that turns the check off is how the check stops meaning
            // anything — `depends` is for things that are not typelibs.
            expect(() =>
                deriveDepends('deb', { ...base, namespaces: ['Nautilus-3.0'], extra: ['gir1.2-nautilus-3.0'] }),
            ).toThrow('gi://Nautilus');
        });

        await it('depends on the package that ships glib-compile-schemas, per format', async () => {
            // NOT `gsettings-desktop-schemas`, which ships GNOME's own schemas
            // and cannot compile ours. On Debian the tool is in a package no
            // `gir1.2-*` pulls in, so naming the wrong one means the postinst's
            // `command -v` guard skips, the schema is never compiled, and the
            // first `Gio.Settings.new()` aborts the app.
            expect(deriveDepends('rpm', { ...base, namespaces: [], hasSchemas: true })).toContain('glib2');
            expect(deriveDepends('deb', { ...base, namespaces: [], hasSchemas: true })).toContain('libglib2.0-bin');
            expect(deriveDepends('deb', { ...base, namespaces: [] })).not.toContain('libglib2.0-bin');
        });

        await it('appends the configured extras last, deduplicated', async () => {
            expect(deriveDepends('rpm', { ...base, namespaces: [], extra: ['gtk4', 'dconf'] })).toStrictEqual([
                'gjs >= 1.86',
                'hicolor-icon-theme',
                'gtk4',
                'dconf',
            ]);
        });

        await it('honours a lowered GJS floor', async () => {
            expect(deriveDepends('deb', { ...base, namespaces: [], minGjsVersion: '1.82' })[0]).toBe('gjs >= 1.82');
        });

        await it("knows every namespace this repo's own showcases import", async () => {
            for (const namespace of ['Gtk-4.0', 'Adw-1', 'GLib-2.0', 'Gio-2.0', 'GObject-2.0', 'GtkSource-5']) {
                expect(knownNamespaces()).toContain(namespace);
            }
        });
    });

    await describe('warnAboutGjsFloor', async () => {
        await it('warns for deb when no released Debian can satisfy the floor', async () => {
            expect(warnAboutGjsFloor('deb', '1.86').join('')).toContain('not satisfiable on Debian stable');
            expect(warnAboutGjsFloor('deb', '1.82').length).toBe(0);
            expect(warnAboutGjsFloor('deb', '1.88.1').length).toBe(0);
            // Only the floor forky ACTUALLY satisfies is quiet: a `>= 1.88.1`
            // test also silenced 1.90 and 2.0, the floors no Debian will meet
            // for years.
            expect(warnAboutGjsFloor('deb', '1.90').length).toBe(1);
            expect(warnAboutGjsFloor('deb', '2.0').length).toBe(1);
        });

        await it('says nothing for rpm, where the floor is met', async () => {
            expect(warnAboutGjsFloor('rpm', '1.86').length).toBe(0);
        });
    });

    await describe('parseDepend / formatDebDepend', async () => {
        await it("parses a bound and spells it dpkg's way", async () => {
            expect(parseDepend('gjs >= 1.86')).toStrictEqual({ name: 'gjs', relation: '>=', version: '1.86' });
            expect(formatDebDepend('gjs >= 1.86')).toBe('gjs (>= 1.86)');
            expect(formatDebDepend('gtk4')).toBe('gtk4');
        });

        await it('spells strict inequality `<<` / `>>`, never the deprecated aliases', async () => {
            // Bare `<` and `>` are deprecated dpkg aliases for `<=` and `>=`,
            // so emitting them means the opposite of how they read.
            expect(formatDebDepend('foo > 1.0')).toBe('foo (>> 1.0)');
            expect(formatDebDepend('foo < 1.0')).toBe('foo (<< 1.0)');
        });
    });

    await describe('resolveFormats', async () => {
        await it('splits, deduplicates and sorts', async () => {
            expect(resolveFormats(['rpm,deb', 'deb']).map((format) => format.id)).toStrictEqual(['deb', 'rpm']);
        });

        await it('refuses an unknown target and an empty one', async () => {
            expect(() => resolveFormats(['snap'])).toThrow('unknown target');
            // An empty list would stage the payload, pack nothing and exit 0.
            expect(() => resolveFormats([])).toThrow('named no format');
        });
    });

    await describe('scanGiNamespaces', async () => {
        await it('finds static and dynamic imports, minified or not', async () => {
            const source = [
                `import Gtk from "gi://Gtk?version=4.0";`,
                `import Adw from'gi://Adw?version=1';`,
                `const G = await import("gi://GLib?version=2.0");`,
            ].join('\n');
            expect(scanGiNamespaces(source)).toStrictEqual(['Adw-1', 'GLib-2.0', 'Gtk-4.0']);
        });

        await it('finds a BARE side-effect import', async () => {
            // `@gjsify/fetch` puts exactly this at the top of every bundle that
            // pulls it, and the first version of the scanner — which required
            // `from` or `import(` — returned nothing for it. The package would
            // have shipped without libsoup, installed, and died at the first
            // request.
            expect(scanGiNamespaces('import"gi://Soup?version=3.0";')).toStrictEqual(['Soup-3.0']);
        });

        await it('finds the shapes a MINIFIED bundle actually emits', async () => {
            // Verbatim from a real `gjsify build --app gjs` output: no space
            // after `from`, and the dynamic import rewritten to a TEMPLATE
            // LITERAL. A quote-only pattern silently dropped the second one,
            // which would have shipped a package missing that dependency.
            const minified =
                'import e from"gi://Gtk?version=4.0";import t from"gi://Adw?version=1";' +
                'const n=await import(`gi://GLib?version=2.0`);function main(){return[e,t,n]}';
            expect(scanGiNamespaces(minified)).toStrictEqual(['Adw-1', 'GLib-2.0', 'Gtk-4.0']);
        });

        await it('skips a specifier built at runtime, which has no static answer', async () => {
            expect(scanGiNamespaces('const m = await import(`gi://${ns}?version=1.0`);')).toStrictEqual([]);
        });

        await it('ignores a gi:// spelling inside a string, even one containing `from`', async () => {
            // Over-approximating is not harmless: an unmapped namespace is a
            // BUILD FAILURE, so a mention in a diagnostic message would make a
            // correct project unbuildable. The regex version matched this one.
            expect(scanGiNamespaces(`throw new Error("gi://Nautilus is not supported");`)).toStrictEqual([]);
            expect(
                scanGiNamespaces(`throw new Error("cannot import from 'gi://Nautilus?version=3.0'");`),
            ).toStrictEqual([]);
        });

        await it('parses a specifier with and without a version', async () => {
            expect(parseGiSpecifier('gi://Gtk?version=4.0')).toBe('Gtk-4.0');
            expect(parseGiSpecifier('gi://Gtk')).toBe('Gtk');
            expect(parseGiSpecifier('node:fs')).toBe(null);
        });
    });
};
