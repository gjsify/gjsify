// The icon THEME: a name, the compiled subset behind it, and the door for the rest.
//
// The interesting assertion in here is not that `'list-add-symbolic'` resolves — it is
// the one that says WHICH document it resolves to. `check-adwaita-icon-masks.mjs`' own
// header records what happens without such a check: the browser storybook drew
// `view-grid` where its GTK twin drew `view-paged-symbolic`, because the right name
// resolved to nothing, a different name was substituted, and the only witness was prose.
// A per-name assertion list would have the same weakness — a substituted entry gets a
// matching assertion written beside it. So the glyph is asserted STRUCTURALLY instead,
// against the export whose camelCase name the key derives, which is the same derivation
// the web pillar's map follows: two renderers agreeing about `list-add-symbolic` becomes
// a property of the map rather than a thing somebody remembered to keep true.
//
// `@gjsify/adwaita-icons` is star-imported here, all 644 glyphs of it, and that is fine
// where it would not be in `icon-theme.ts`: a spec is a FIXTURE and buys no shipped byte.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { describe, expect, it } from '@gjsify/unit';

import { normalizeIconName } from '@gjsify/adwaita-core';
import * as actionIcons from '@gjsify/adwaita-icons/actions';
import * as categoryIcons from '@gjsify/adwaita-icons/categories';
import * as deviceIcons from '@gjsify/adwaita-icons/devices';
import * as emoteIcons from '@gjsify/adwaita-icons/emotes';
import * as legacyIcons from '@gjsify/adwaita-icons/legacy';
import * as mimetypeIcons from '@gjsify/adwaita-icons/mimetypes';
import * as placeIcons from '@gjsify/adwaita-icons/places';
import * as statusIcons from '@gjsify/adwaita-icons/status';
import * as uiIcons from '@gjsify/adwaita-icons/ui';

import {
    ICON_FALLBACK_NAME,
    compiledIconNames,
    iconValueKind,
    isIconAvailable,
    registerIcon,
    registeredIconNames,
    resolveIconSource,
    unregisterIcon,
} from './widgets/icon-theme.js';

/** Every glyph the workspace ships, by export name — the oracle for the subset. */
const ALL_GLYPHS: Record<string, string> = {
    ...actionIcons,
    ...categoryIcons,
    ...deviceIcons,
    ...emoteIcons,
    ...legacyIcons,
    ...mimetypeIcons,
    ...placeIcons,
    ...statusIcons,
    ...uiIcons,
};

/** `list-add` → `listAddSymbolic`, the generator's own rule (adwaita-icons/scripts). */
function exportNameFor(icon: string): string {
    return `${icon.replace(/-([a-z0-9])/g, (_all, char: string) => char.toUpperCase())}Symbolic`;
}

/** A document that is unmistakably not a glyph anything ships. */
const OWN_SVG = '<svg viewBox="0 0 16 16"><path d="M1 1 h14 v14 h-14 z"/></svg>';

export default async () => {
    await describe('iconValueKind (which of the two doors a value came through)', async () => {
        for (const [value, kind] of [
            ['', 'empty'],
            ['list-add-symbolic', 'name'],
            ['list-add', 'name'],
            ['<svg viewBox="0 0 16 16"></svg>', 'source'],
            // A prolog and a DOCTYPE are legitimate ahead of the root element in an icon
            // read off a file, and the leading newline with them.
            ['<?xml version="1.0"?><svg></svg>', 'source'],
            ['\n  <svg></svg>', 'source'],
            // Neither: reported as a NAME, so resolution draws `image-missing` rather
            // than handing an un-parseable string to the rasteriser, which draws nothing
            // and says nothing. `org.gnome.Builder` is the real-world instance — a
            // reverse-DNS application icon is not one CSS token.
            ['two words', 'name'],
            ['org.gnome.Builder', 'name'],
        ] as const) {
            await it(`${JSON.stringify(value)} → ${kind}`, () => {
                expect(iconValueKind(value)).toBe(kind);
            });
        }

        await it('reads a nullish value as empty rather than throwing', () => {
            expect(iconValueKind(null)).toBe('empty');
            expect(iconValueKind(undefined)).toBe('empty');
        });
    });

    await describe('the compiled subset', async () => {
        await it('carries the fallback name, or an unresolvable name draws nothing', () => {
            // The one entry that is load-bearing by CONSTRUCTION: `resolveIconSource`
            // substitutes it, so a subset without it would resolve every unknown name to
            // `undefined` — the invisible failure this whole area exists to have ended.
            expect(compiledIconNames().includes(ICON_FALLBACK_NAME)).toBe(true);
        });

        await it('is spelled the way normalizeIconName spells a name', () => {
            // A key with a `-symbolic` suffix, or with a character that is not one CSS
            // token, is a key no caller can ever reach: `resolveIconSource` looks up the
            // NORMALIZED name. The renderers share that one function, which is what makes
            // `list-add-symbolic` mean the same thing on both.
            const unreachable = compiledIconNames().filter((name) => normalizeIconName(name) !== name);
            expect(unreachable).toStrictEqual([]);
        });

        await it('draws every name from the export that name derives', () => {
            // THE ANTI-SUBSTITUTION ARM. A key whose glyph is some other icon resolves,
            // reports available, and draws the wrong picture — see this file's header for
            // the measured instance of exactly that on the web renderer.
            const wrong = compiledIconNames().filter((name) => {
                const expected = ALL_GLYPHS[exportNameFor(name)];
                return expected === undefined || resolveIconSource(name) !== expected;
            });
            expect(wrong).toStrictEqual([]);
        });

        await it('resolves each of its names to a real symbolic document', () => {
            const broken = compiledIconNames().filter((name) => !resolveIconSource(name).includes('<svg'));
            expect(broken).toStrictEqual([]);
        });
    });

    await describe('resolveIconSource', async () => {
        await it('resolves a name with and without the -symbolic suffix identically', () => {
            expect(resolveIconSource('list-add-symbolic')).toBe(ALL_GLYPHS.listAddSymbolic);
            expect(resolveIconSource('list-add')).toBe(ALL_GLYPHS.listAddSymbolic);
        });

        await it('passes SVG SOURCE through untouched — the door that was already open', () => {
            expect(resolveIconSource(OWN_SVG)).toBe(OWN_SVG);
            // Including a glyph the subset does not carry, which is the case the door is
            // FOR: a consumer with their own icon set never needed a release.
            expect(resolveIconSource(ALL_GLYPHS.weatherClearSymbolic)).toBe(ALL_GLYPHS.weatherClearSymbolic);
        });

        await it('leaves an empty icon empty, so a widget takes its own absent path', () => {
            // NOT `image-missing`: libadwaita's answer to a NULL `icon-name` is the
            // widget's own fallback (an avatar shows the person glyph, a status page
            // collapses the image), and substituting here would take that away.
            expect(resolveIconSource('')).toBe('');
            expect(resolveIconSource(null)).toBe('');
            expect(resolveIconSource(undefined)).toBe('');
        });

        await it('draws image-missing for a name it cannot resolve', () => {
            const missing = resolveIconSource('no-such-glyph-symbolic');
            expect(missing).toBe(resolveIconSource(ICON_FALLBACK_NAME));
            expect(missing.includes('<svg')).toBe(true);
        });

        await it('draws image-missing for a string that is neither a name nor a document', () => {
            expect(resolveIconSource('not an svg')).toBe(resolveIconSource(ICON_FALLBACK_NAME));
        });
    });

    await describe('registerIcon (the door for a glyph outside the subset)', async () => {
        await it('makes an unresolvable name resolvable, and unregister takes it back', () => {
            expect(isIconAvailable('weather-clear-symbolic')).toBe(false);
            registerIcon('weather-clear-symbolic', ALL_GLYPHS.weatherClearSymbolic as string);
            expect(isIconAvailable('weather-clear-symbolic')).toBe(true);
            expect(resolveIconSource('weather-clear-symbolic')).toBe(ALL_GLYPHS.weatherClearSymbolic);
            // Registered under the NORMALIZED name, so both spellings reach it.
            expect(resolveIconSource('weather-clear')).toBe(ALL_GLYPHS.weatherClearSymbolic);
            expect(registeredIconNames().includes('weather-clear')).toBe(true);

            expect(unregisterIcon('weather-clear-symbolic')).toBe(true);
            expect(isIconAvailable('weather-clear-symbolic')).toBe(false);
            expect(resolveIconSource('weather-clear-symbolic')).toBe(resolveIconSource(ICON_FALLBACK_NAME));
        });

        await it('replaces a glyph the subset already compiles, then gives it back', () => {
            const compiled = resolveIconSource('list-add-symbolic');
            registerIcon('list-add-symbolic', OWN_SVG);
            expect(resolveIconSource('list-add-symbolic')).toBe(OWN_SVG);
            unregisterIcon('list-add-symbolic');
            expect(resolveIconSource('list-add-symbolic')).toBe(compiled);
        });

        await it('THROWS on a name that could never be looked up', () => {
            // Rather than registering nothing: this is an explicit call, and a
            // registration that quietly did not happen is the failure mode the whole
            // module exists to remove. A widget setter takes the other verdict — there
            // the name came from markup, and `image-missing` is proportionate.
            for (const name of ['', 'two words', 'org.gnome.Builder']) {
                expect(() => registerIcon(name, OWN_SVG)).toThrow();
            }
        });

        await it('THROWS on a second argument that is not an SVG document', () => {
            // The measured hazard on the web side: a percent-encoded non-document makes a
            // well-formed mask that masks NOTHING, an icon strictly worse than an
            // unregistered one, while availability reports true. Here it would hand the
            // rasteriser a string with no path data — invisible, silent, and now refused.
            for (const glyph of ['', 'list-add-symbolic', 'not an svg', '<div>x</div>']) {
                expect(() => registerIcon('probe-symbolic', glyph)).toThrow();
            }
            expect(isIconAvailable('probe-symbolic')).toBe(false);
        });
    });

    await describe('isIconAvailable', async () => {
        await it('answers for the subset, and refuses what it cannot draw', () => {
            expect(isIconAvailable('list-add-symbolic')).toBe(true);
            expect(isIconAvailable('list-add')).toBe(true);
            expect(isIconAvailable('no-such-glyph-symbolic')).toBe(false);
            // An unusable name is not available under any spelling, and neither is the
            // empty one — `resolveIconSource` has a different answer for each, and this
            // one must not report `true` for either.
            expect(isIconAvailable('two words')).toBe(false);
            expect(isIconAvailable('')).toBe(false);
            expect(isIconAvailable(null)).toBe(false);
        });
    });
};
