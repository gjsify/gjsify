// SPDX-License-Identifier: MIT
// The dependency derivation, and the refusal that is its whole point.
//
// The reference implementation this design comes from returns `[]` for a GI
// namespace its table does not know. That produces a package which installs
// cleanly and dies on first launch with a dynamic-linker error — on the user's
// machine, after the download, reading like an application bug. So the case
// worth testing hardest here is the one that must FAIL.

import { describe, expect, it } from '@gjsify/unit';

import {
    deriveDepends,
    formatDebDepend,
    knownNamespaces,
    parseDepend,
    warnAboutGjsFloor,
    warnAboutNodeFloor,
} from './depends.js';
import { resolveFormats } from './formats.js';
import { LAYOUTS } from './layout.js';
import { parseGiSpecifier, scanGiNamespaces, scanGiRequirements } from './gi-namespaces.js';
// The shim that WRITES the optional marker, imported rather than restated: the
// reader's job is to recognise the shape its sibling emits, and a copy of that
// shape in a test is a copy that keeps agreeing with itself.
import { giOptionalShimSource, giOptionalNodeShimSource } from '@gjsify/rolldown-plugin-gjsify';

const base = { hasIcons: true, hasSchemas: false, interpreter: 'gjs' as const, extra: [] };

export default async () => {
    await describe('deriveDepends', async () => {
        await it('needs no distro package for a typelib the payload carries', async () => {
            // `Gwebgl` has no `gir1.2-…` anywhere: it arrives as an npm prebuild. Without this the
            // check fails every project that uses gjsify's WebGL bridge.
            const { requires } = deriveDepends('deb', {
                namespaces: ['Gtk-4.0', 'Gwebgl-0.1'],
                hasIcons: true,
                hasSchemas: false,
                interpreter: 'gjs' as const,
                extra: [],
                bundledTypelibs: ['/p/gi/Gwebgl-0.1.typelib', '/p/gi/libgwebgl.so'],
            });
            expect(requires.some((d) => d.includes('gwebgl'))).toBe(false);
            expect(requires.some((d) => d.includes('gtk-4'))).toBe(true);
        });

        await it('still fails for a namespace nothing ships and nothing maps', async () => {
            // The exemption is derived from the STAGED FILES. Shipping one typelib must not excuse a
            // different namespace — that would turn the check into a way of silencing itself.
            expect(() =>
                deriveDepends('deb', {
                    namespaces: ['Totally-1.0'],
                    hasIcons: true,
                    hasSchemas: false,
                    interpreter: 'gjs' as const,
                    extra: [],
                    bundledTypelibs: ['/p/gi/Gwebgl-0.1.typelib'],
                }),
            ).toThrow('no deb package is known');
        });

        await it('maps namespaces to the package that ships the typelib, per format', async () => {
            const namespaces = ['Gtk-4.0', 'Adw-1', 'Gio-2.0'];
            expect(deriveDepends('deb', { ...base, namespaces }).requires).toStrictEqual([
                'gjs >= 1.86',
                'gir1.2-adw-1',
                'gir1.2-glib-2.0',
                'gir1.2-gtk-4.0',
                'hicolor-icon-theme',
            ]);
            expect(deriveDepends('rpm', { ...base, namespaces }).requires).toStrictEqual([
                'gjs >= 1.86',
                'libadwaita',
                'glib2',
                'gtk4',
                'hicolor-icon-theme',
            ]);
        });

        await it('collapses namespaces that share one package', async () => {
            const { requires } = deriveDepends('rpm', { ...base, namespaces: ['Gtk-4.0', 'Gdk-4.0', 'Gsk-4.0'] });
            expect(requires.filter((entry) => entry === 'gtk4').length).toBe(1);
        });

        await it('resolves an unpinned specifier when the table has exactly one version', async () => {
            expect(deriveDepends('rpm', { ...base, namespaces: ['Gtk'] }).requires).toContain('gtk4');
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
                deriveDepends('deb', { ...base, namespaces: ['GjsifyHttpSoupBridge-1.0', 'Gtk-4.0'] }).requires,
            ).toStrictEqual(['gjs >= 1.86', 'gir1.2-gtk-4.0', 'hicolor-icon-theme']);
            // Anchored on the PascalCase the bridge builds emit, so a real
            // system namespace that merely starts with those letters still has
            // to be mapped.
            expect(() => deriveDepends('deb', { ...base, namespaces: ['Gjsifyish-1.0'] })).toThrow('gi://Gjsifyish');
        });

        await it('accepts a namespace once the project supplies the row', async () => {
            const { requires } = deriveDepends('deb', {
                ...base,
                namespaces: ['Nautilus-3.0'],
                typelibPackages: { 'Nautilus-3.0': { deb: 'gir1.2-nautilus-3.0', rpm: 'nautilus' } },
            });
            expect(requires).toContain('gir1.2-nautilus-3.0');
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
            expect(deriveDepends('rpm', { ...base, namespaces: [], hasSchemas: true }).requires).toContain('glib2');
            expect(deriveDepends('deb', { ...base, namespaces: [], hasSchemas: true }).requires).toContain(
                'libglib2.0-bin',
            );
            expect(deriveDepends('deb', { ...base, namespaces: [] }).requires).not.toContain('libglib2.0-bin');
        });

        await it('appends the configured extras last, deduplicated', async () => {
            expect(deriveDepends('rpm', { ...base, namespaces: [], extra: ['gtk4', 'dconf'] }).requires).toStrictEqual([
                'gjs >= 1.86',
                'hicolor-icon-theme',
                'gtk4',
                'dconf',
            ]);
        });

        await it('honours a lowered GJS floor', async () => {
            expect(deriveDepends('deb', { ...base, namespaces: [], minGjsVersion: '1.82' }).requires[0]).toBe(
                'gjs >= 1.82',
            );
        });

        await it('spells the Node dependency differently per format, because the names differ', async () => {
            // ⚠️ THE WHOLE POINT OF THIS TEST. `Requires: nodejs >= 24` is a
            // silent NO-OP on Fedora: measured with `dnf repoquery` on F44,
            // `--whatprovides 'nodejs >= 24'` answers nodejs22-1:22.23.1,
            // because the virtual `nodejs` Provide carries Epoch 1 and a bare
            // `>= 24` desugars to `0:24`. `nodejs(engine)` has no epoch.
            expect(deriveDepends('rpm', { ...base, namespaces: [], interpreter: 'node' }).requires).toContain(
                'nodejs(engine) >= 24',
            );
            expect(deriveDepends('deb', { ...base, namespaces: [], interpreter: 'node' }).requires).toContain(
                'nodejs >= 24',
            );
            // The rpm spelling must never leak into a Debian `Depends:` — the
            // failure `SCHEMA_COMPILER_PACKAGE`'s header records, one row over.
            expect(deriveDepends('deb', { ...base, namespaces: [], interpreter: 'node' }).requires).not.toContain(
                'nodejs(engine) >= 24',
            );
        });

        await it('declares exactly ONE interpreter, never both', async () => {
            // THE REGRESSION THIS PINS. The first cut seeded `gjs >= …`
            // unconditionally and appended `nodejs >= …` from a payload
            // heuristic, so a package could declare both — and a `>= 24` floor is
            // unsatisfiable on every current DEB stable, which turns a working
            // GJS package into one apt refuses everywhere.
            const gjs = deriveDepends('rpm', { ...base, namespaces: [] }).requires;
            expect(gjs[0]).toBe('gjs >= 1.86');
            expect(gjs.some((d) => d.startsWith('nodejs'))).toBe(false);

            const node = deriveDepends('rpm', { ...base, namespaces: [], interpreter: 'node' }).requires;
            expect(node[0]).toBe('nodejs(engine) >= 24');
            expect(node.some((d) => d.startsWith('gjs'))).toBe(false);
        });

        await it('honours a lowered Node floor', async () => {
            expect(
                deriveDepends('deb', { ...base, namespaces: [], interpreter: 'node', minNodeVersion: '20' }).requires,
            ).toContain('nodejs >= 20');
        });

        await it('keeps the emitted bound parseable by both packers', async () => {
            // `nodejs(engine)` contains parentheses, and `parseDepend` splits on
            // whitespace around the relation — so the rpm name survives as ONE
            // token. If it did not, the rpm header would carry a dependency on a
            // package called `nodejs(engine`.
            expect(parseDepend('nodejs(engine) >= 24')).toStrictEqual({
                name: 'nodejs(engine)',
                relation: '>=',
                version: '24',
            });
            expect(formatDebDepend('nodejs >= 24')).toBe('nodejs (>= 24)');
        });

        await it("knows every namespace this repo's own showcases import", async () => {
            for (const namespace of ['Gtk-4.0', 'Adw-1', 'GLib-2.0', 'Gio-2.0', 'GObject-2.0', 'GtkSource-5']) {
                expect(knownNamespaces()).toContain(namespace);
            }
        });

        // ── hard vs optional (ADR 0086) ────────────────────────────────────

        await it('puts an optional typelib in Recommends, never in Depends', async () => {
            // THE POINT OF THE SPLIT. `&optional` means the app has a degrade path,
            // and a hard `Depends:` turns that declaration into the opposite: apt
            // REFUSES to install the package without the typelib, so the feature
            // the author made optional decides whether the app exists on the
            // machine.
            const derived = deriveDepends('deb', {
                ...base,
                namespaces: ['Gtk-4.0', 'Notify-0.7'],
                optionalNamespaces: ['Notify-0.7'],
            });
            expect(derived.requires).toContain('gir1.2-gtk-4.0');
            expect(derived.requires).not.toContain('gir1.2-notify-0.7');
            expect(derived.recommends).toStrictEqual(['gir1.2-notify-0.7']);
        });

        await it('maps the optional half per format, like the hard half', async () => {
            const derived = deriveDepends('rpm', {
                ...base,
                namespaces: ['Gtk-4.0', 'Notify-0.7'],
                optionalNamespaces: ['Notify-0.7'],
            });
            expect(derived.requires).toContain('gtk4');
            expect(derived.requires).not.toContain('libnotify');
            expect(derived.recommends).toStrictEqual(['libnotify']);
        });

        await it('never names a package in both lists', async () => {
            // A namespace imported both ways is a HARD dependency — one importer
            // asked for it unguarded — and dpkg would reject a package whose
            // `Depends:` and `Recommends:` disagree about the same name.
            const derived = deriveDepends('deb', {
                ...base,
                namespaces: ['Gtk-4.0', 'Gdk-4.0', 'Notify-0.7'],
                optionalNamespaces: ['Gdk-4.0', 'Notify-0.7'],
            });
            expect(derived.requires).toContain('gir1.2-gtk-4.0');
            expect(derived.recommends).not.toContain('gir1.2-gtk-4.0');
            expect(derived.recommends).toStrictEqual(['gir1.2-notify-0.7']);
        });

        await it('does not fail the build for an optional namespace nothing maps', async () => {
            // THE ASYMMETRY, and it is deliberate. An unmapped HARD namespace
            // fails the build because a package with a silent dependency dies on
            // the user's machine after the download. An unmapped OPTIONAL one
            // cannot: the app runs without the typelib by declaration, so there
            // is nothing to be wrong about — it is REPORTED instead.
            const derived = deriveDepends('deb', {
                ...base,
                namespaces: ['Nautilus-3.0'],
                optionalNamespaces: ['Nautilus-3.0'],
            });
            expect(derived.requires).toStrictEqual(['gjs >= 1.86', 'hicolor-icon-theme']);
            expect(derived.recommends).toStrictEqual([]);
            expect(derived.unmappedOptional).toStrictEqual(['Nautilus-3.0']);
            // And the same namespace, hard, still refuses — the optional list must
            // not become a hatch that turns the check off.
            expect(() => deriveDepends('deb', { ...base, namespaces: ['Nautilus-3.0'] })).toThrow('gi://Nautilus');
        });

        await it('recommends an optional namespace the project did map', async () => {
            const derived = deriveDepends('deb', {
                ...base,
                namespaces: ['Nautilus-3.0'],
                optionalNamespaces: ['Nautilus-3.0'],
                typelibPackages: { 'Nautilus-3.0': { deb: 'gir1.2-nautilus-3.0', rpm: 'nautilus' } },
            });
            expect(derived.recommends).toStrictEqual(['gir1.2-nautilus-3.0']);
            expect(derived.unmappedOptional).toStrictEqual([]);
        });

        await it('recommends nothing when the bundle marks nothing optional', async () => {
            // The stage-manifest path: a stage written before the split carries no
            // `optionalNamespaces`, and the safe reading of that is "everything is
            // hard" — today's behaviour, over-declaring rather than dropping a
            // requirement the app cannot start without.
            const derived = deriveDepends('deb', { ...base, namespaces: ['Gtk-4.0', 'Notify-0.7'] });
            expect(derived.recommends).toStrictEqual([]);
            expect(derived.requires).toContain('gir1.2-notify-0.7');
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

    await describe('warnAboutNodeFloor', async () => {
        await it('warns for deb, where the default floor excludes every current stable/LTS', async () => {
            // Debian 13 trixie 20, Ubuntu 24.04 LTS 18, Ubuntu 26.04 LTS 22 —
            // measured 2026-08-28. This fires far more often than its GJS
            // sibling, which is the honest consequence of a `>= 24` default and
            // the reason the warning exists rather than a lowered floor.
            expect(warnAboutNodeFloor('deb', '24').join('')).toContain('not satisfiable on any current DEB');
            expect(warnAboutNodeFloor('deb', '26').length).toBe(1);
        });

        await it('is quiet for a floor a released suite actually satisfies', async () => {
            // Ubuntu 26.04 LTS ships 22, which is the newest any current
            // stable/LTS carries — so 22 and below are satisfiable somewhere.
            expect(warnAboutNodeFloor('deb', '22').length).toBe(0);
            expect(warnAboutNodeFloor('deb', '20').length).toBe(0);
        });

        await it('says nothing for rpm, where nodejs24 is parallel-installable from the base repo', async () => {
            expect(warnAboutNodeFloor('rpm', '24').length).toBe(0);
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
            expect(resolveFormats(['rpm,deb', 'deb'], LAYOUTS.linux).map((format) => format.id)).toStrictEqual([
                'deb',
                'rpm',
            ]);
        });

        await it('refuses an unknown target and an empty one', async () => {
            expect(() => resolveFormats(['snap'], LAYOUTS.linux)).toThrow('unknown target');
            // An empty list would stage the payload, pack nothing and exit 0.
            expect(() => resolveFormats([], LAYOUTS.linux)).toThrow('named no format');
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

        await it('finds the namespaces a --app node bundle carries', async () => {
            // `gjsGiNodePlugin` rewrites every `gi://` into this shim, so a node
            // bundle carries NO `gi://` specifier and the scanner that read only
            // that form derived an EMPTY dependency set: the package installed
            // and died at its first GI call. Verbatim from the emitted shim,
            // including the `require` the bundle keeps external.
            const shim = [
                `import { createRequire } from 'node:module';`,
                `const require = createRequire(import.meta.url);`,
                `let cached;`,
                `function load() {`,
                `  if (cached === undefined) {`,
                `    cached = require('@gjsify/node-gi/gi').requireGi("Gtk", "4.0");`,
                `  }`,
                `  return cached;`,
                `}`,
            ].join('\n');
            expect(scanGiNamespaces(shim)).toStrictEqual(['Gtk-4.0']);
        });

        await it('finds them in the bundle a real `gjsify build --app node` writes', async () => {
            // VERBATIM from `gjsify build src/app.ts --app node` on a two-import
            // app, both spellings, and this is the case a hand-written shim cannot
            // stand in for. TWO shims in one bundle means two `require` bindings,
            // so the second is renamed even without `--minify` — which is the
            // DEFAULT, and there the loader is called `n` and the arguments are
            // template literals. A reader keyed on the identifier `require` answers
            // `[]` here, which is a legal answer, so the artifact ships with no
            // typelib `Depends:` and nothing says a word.
            const unminified = [
                `import { createRequire } from "node:module";`,
                `const require$1 = createRequire(import.meta.url);`,
                `let cached$1;`,
                `function load$1() {`,
                `	if (cached$1 === void 0) cached$1 = require$1("@gjsify/node-gi/gi").requireGi("Gtk", "4.0");`,
                `	return cached$1;`,
                `}`,
            ].join('\n');
            const minified =
                'import{createRequire as e}from"node:module";var t=Object.defineProperty,' +
                '__name=(e,n)=>t(e,`name`,{value:n,configurable:!0});const n=e(import.meta.url);let r;' +
                'function load$1(){return r===void 0&&(r=n(`@gjsify/node-gi/gi`).requireGi(`Gtk`,`4.0`)),r}';
            expect(scanGiNamespaces(unminified)).toStrictEqual(['Gtk-4.0']);
            expect(scanGiNamespaces(minified)).toStrictEqual(['Gtk-4.0']);
        });

        await it('finds requireGi through every binding node-gi exports it under', async () => {
            // A hand-written node-gi application does not go through the shim,
            // and `requireGi` is both the named and the DEFAULT export
            // (`packages/node-gi/node-gi/gi.d.ts`), so all three spellings reach
            // the same function and all three must derive the same dependency.
            const named = `import { requireGi } from '@gjsify/node-gi/gi';\nconst Gtk = requireGi('Gtk', '4.0');`;
            const renamed = `import { requireGi as gi } from '@gjsify/node-gi/gi';\nconst A = gi('Adw', '1');`;
            const asDefault = `import gi from '@gjsify/node-gi/gi';\nconst S = gi('Soup', '3.0');`;
            const namespace = `import * as gi from '@gjsify/node-gi/gi';\nconst G = gi.requireGi('GLib');`;
            expect(scanGiNamespaces(named)).toStrictEqual(['Gtk-4.0']);
            expect(scanGiNamespaces(renamed)).toStrictEqual(['Adw-1']);
            expect(scanGiNamespaces(asDefault)).toStrictEqual(['Soup-3.0']);
            expect(scanGiNamespaces(namespace)).toStrictEqual(['GLib']);
        });

        await it("does not read a minified callback that borrowed the namespace import's name", async () => {
            // MEASURED on `gjsify build --app node` output. The minifier gives an
            // `import * as gi` and a callback PARAMETER the same short name in
            // different scopes, and this reader has no scope analysis — so a flat
            // set of bindings read `e(`Zzqfoo`)` as a namespace, and `deriveDepends`
            // then refused to package a correct project. A module namespace object
            // is not callable at all, which is what makes the split exact rather
            // than a heuristic.
            const minified =
                'import*as e from"@gjsify/node-gi/gi";const t=e.requireGi(`Gtk`,`4.0`);' +
                'function render(e,n){return e(n)+e(`Zzqfoo`)}';
            expect(scanGiNamespaces(minified)).toStrictEqual(['Gtk-4.0']);
        });

        await it('does not read a foreign requireGi, because over-approximating fails the build', async () => {
            // BINDING-TRACED, not name-matched. An unmapped namespace is a build
            // failure, so a method that merely shares the name would make a
            // correct project unpackageable — the same asymmetry the `gi://`
            // string case below is about.
            expect(
                scanGiNamespaces(`import { requireGi } from 'somewhere-else';\nrequireGi('Gtk', '4.0');`),
            ).toStrictEqual([]);
            expect(scanGiNamespaces(`plugins.requireGi('Gtk', '4.0');`)).toStrictEqual([]);
        });

        await it('parses a specifier with and without a version', async () => {
            expect(parseGiSpecifier('gi://Gtk?version=4.0')).toBe('Gtk-4.0');
            expect(parseGiSpecifier('gi://Gtk')).toBe('Gtk');
            expect(parseGiSpecifier('node:fs')).toBe(null);
        });

        await it('still reports an optional namespace among the namespaces', async () => {
            // `namespaces` is the union, unchanged: an optional namespace IS
            // imported, and every reader that only asks "what does this bundle
            // load" keeps its answer.
            const scanned = scanGiRequirements(
                `${giOptionalShimSource('gi://Notify?version=0.7', 'Notify', '0.7')}\nimport Gtk from "gi://Gtk?version=4.0";\nconsole.log(Gtk);\n`,
            );
            expect(scanned.namespaces).toStrictEqual(['Gtk-4.0', 'Notify-0.7']);
            expect(scanned.optional).toStrictEqual(['Notify-0.7']);
        });

        await it('reads the marker the --app gjs shim emits', async () => {
            // VERBATIM from the plugin that writes it, so this fails when the shim
            // changes shape rather than when the reader drifts from a copy of it.
            const scanned = scanGiRequirements(giOptionalShimSource('gi://Soup?version=3.0', 'Soup', '3.0'));
            expect(scanned.namespaces).toStrictEqual(['Soup-3.0']);
            expect(scanned.optional).toStrictEqual(['Soup-3.0']);
        });

        await it('reads the marker in a MINIFIED bundle, where the strings are template literals', async () => {
            // Minify is the build's default and rewrites `"Soup"` to `` `Soup` ``,
            // the exact rewriting `staticStringValue` exists for — which is why the
            // reader goes through it instead of comparing the emitted text.
            const minified = giOptionalShimSource('gi://Soup?version=3.0', 'Soup', '3.0').replaceAll('"', '`');
            expect(scanGiRequirements(minified).optional).toStrictEqual(['Soup-3.0']);
        });

        await it('reads the marker the --app node shim emits, which has no gi:// specifier at all', async () => {
            // The node bundle carries `requireGi("Soup","3.0")` and NO `gi://`
            // specifier, so this is the shape `ship` must classify for a node
            // artifact — the case the gjs arm alone answers `[]` to.
            const scanned = scanGiRequirements(giOptionalNodeShimSource('Soup', '3.0'));
            expect(scanned.namespaces).toStrictEqual(['Soup-3.0']);
            expect(scanned.optional).toStrictEqual(['Soup-3.0']);
        });

        await it('does NOT treat an unflagged dynamic import as optional', async () => {
            // THE DISCRIMINATOR, and the reason the reader is not a shape test. An
            // app may write `await import("gi://Soup?version=3.0")` itself with no
            // flag; reading that shape as optional would move a package the host
            // must provide out of `Depends:` — the failure this chain exists to
            // prevent, reached from the other direction.
            const scanned = scanGiRequirements('try { await import("gi://Soup?version=3.0"); } catch { }\n');
            expect(scanned.namespaces).toStrictEqual(['Soup-3.0']);
            expect(scanned.optional).toStrictEqual([]);
        });

        await it('reads no marker out of a foreign globalThis call', async () => {
            // The KEY is matched, not the callee: an app's own
            // `globalThis[Symbol.for("app.events")].emit("Soup","3.0")` must not
            // become an optional GI dependency, for the same reason a foreign
            // `requireGi` is not read — over-approximating fails the build.
            const foreign =
                'globalThis[Symbol.for("app.events")].emit("Soup", "3.0");\nconst m = await import("gi://Soup?version=3.0");\n';
            expect(scanGiRequirements(foreign).optional).toStrictEqual([]);
        });

        await it('lets the marker only SHRINK the namespace list, never invent one', async () => {
            // A hand-planted marker must not smuggle a namespace past the
            // unmapped-namespace check into a Recommends entry.
            const planted = 'globalThis[Symbol.for("gjsify.optionalGi")]?.("Ghost", "1.0");';
            const scanned = scanGiRequirements(planted);
            expect(scanned.namespaces).toStrictEqual([]);
            expect(scanned.optional).toStrictEqual([]);
        });
    });
};
