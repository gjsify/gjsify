// `@gjsify/utils/font-map` — the registration and the fontconfig fallback, on the real font map.
//
// WHAT IS HERE AND WHAT IS NOT, and why the split falls where it does. Everything in this file runs on
// every platform. The property that only a CoreText map exhibits — declining a face outright, and the
// fontconfig fallback that rescues it — is measured where it can be observed, in `@gjsify/gtk-host`'s
// `fonts.spec.ts` and in `dom-elements`' `font-face.spec.ts`. What belongs HERE is the decision logic,
// and the one piece of it that can be exercised everywhere is `isUnsupportedByFontMap`: ADR 0038 §
// Amendment says of that function that keying it on the error rather than on `process.platform`
// "becomes checkable from a Linux runner — a synthesised `GLib.Error` in the Gio domain exercises it,
// where a platform read could only ever be asserted on macOS". This file is that runner, and it is the
// whole reason the function has no OS branch in it.
//
// The synthesised error is the point rather than a shortcut: the real decline needs a CoreText map, so
// a test waiting for one would assert nothing on every other platform and the absence of an OS branch
// would be untested everywhere but the host that motivated the design.

import { describe, expect, it } from '@gjsify/unit';

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

import {
    CAIRO_FONT_TYPE_FT,
    fontErrorMessage,
    fontMapFamilies,
    fontMapHasFamily,
    isUnsupportedByFontMap,
    registerFontFaces,
} from './font-map.js';

/** `CAIRO_FONT_TYPE_FT` as cairo's header spells it — a second constant, so the literal can drift visibly. */
const CAIRO_FONT_TYPE_FT_HEADER_VALUE = 1;

/** A family that cannot exist, so "registered" and "substituted" cannot look alike. */
const INVENTED_FAMILY = 'ZzzNoSuchFamilyQx';

/**
 * A GError in the Gio domain, which is what `add_font_file` raises on a map that implements no
 * `add_font_file` vfunc (ADR 0038 § Amendment 2, § W1-W5).
 */
function gioError(code: number, message: string): unknown {
    return GLib.Error.new_literal(Gio.io_error_quark(), code, message);
}

/** A scratch directory, plus a path inside it. `build_filenamev`, never a template literal. */
function scratchFile(leaf: string): { dir: Gio.File; path: string } {
    // `GLib.get_tmp_dir()` answers `/var/folders/…/T/` WITH a trailing separator on macOS and `/tmp`
    // without one on Linux, so `${tmp}/name` produces a DOUBLED separator there and the path a caller
    // is handed stops matching the path that comes back — structurally invisible on Linux, where the
    // two spellings coincide.
    const dir = Gio.File.new_for_path(GLib.dir_make_tmp('gjsify-font-map-XXXXXX'));
    return { dir, path: GLib.build_filenamev([dir.get_path() ?? GLib.get_tmp_dir(), leaf]) };
}

/** Remove a flat directory and its entries; these fixtures never nest. */
function removeTree(dir: Gio.File): void {
    const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (let info = children.next_file(null); info !== null; info = children.next_file(null)) {
        children.get_child(info).delete(null);
    }
    dir.delete(null);
}

/** Walk up from the working directory until the showcase face is in reach. */
function findFaceSource(): string | undefined {
    let dir: Gio.File | null = Gio.File.new_for_path(GLib.get_current_dir());
    for (let up = 0; up < 8 && dir !== null; up++) {
        const candidate = dir.resolve_relative_path(
            'showcases/dom/excalibur-jelly-jumper/src/assets/fonts/Round9x13.ttf',
        );
        if (candidate.query_exists(null)) return candidate.get_path() ?? undefined;
        dir = dir.get_parent();
    }
    return undefined;
}

export default async () => {
    await describe('CAIRO_FONT_TYPE_FT', async () => {
        await it('is the value cairo spells for its fontconfig backend', async () => {
            // The literal's only risk is drifting from the header it stands in for, and a test that
            // repeated the same expression would not catch it.
            expect(CAIRO_FONT_TYPE_FT).toBe(CAIRO_FONT_TYPE_FT_HEADER_VALUE);
        });
    });

    await describe('isUnsupportedByFontMap', async () => {
        await it('answers true for the Gio NOT_SUPPORTED a CoreText map raises', async () => {
            expect(isUnsupportedByFontMap(gioError(Gio.IOErrorEnum.NOT_SUPPORTED, 'Operation not supported'))).toBe(
                true,
            );
        });

        await it('answers false for a Gio error of any other code', async () => {
            // A file FreeType cannot open answers NOT_FOUND, and routing that to `declined` would
            // report a broken file as a map that cannot register — which is how a mistyped path turns
            // into an absence nobody can explain.
            expect(isUnsupportedByFontMap(gioError(Gio.IOErrorEnum.NOT_FOUND, 'No such file'))).toBe(false);
            expect(isUnsupportedByFontMap(gioError(Gio.IOErrorEnum.PERMISSION_DENIED, 'Denied'))).toBe(false);
        });

        await it('answers false for the same number in a different domain', async () => {
            // `matches()` is the answer, the CODE is not: a GError carrying NOT_SUPPORTED's number in
            // another domain is not a decline, and a comparison against the enum would get this wrong.
            const other = GLib.Error.new_literal(GLib.quark_from_string('gjsify-font-map-spec'), 2, 'nope');
            expect(isUnsupportedByFontMap(other)).toBe(false);
        });

        await it('answers false for a plain Error, which carries no domain at all', async () => {
            expect(isUnsupportedByFontMap(new Error('Operation not supported'))).toBe(false);
        });
    });

    await describe('fontErrorMessage', async () => {
        await it('reports a GError as its message rather than as a stringified GError', async () => {
            // `GLib.Error` is NOT `instanceof Error` under GJS — measured on gjs 1.88.1 — so an
            // `instanceof Error` narrowing degrades every diagnostic over it to `String(error)`, which
            // is not obviously broken, only domain-prefixed.
            const message = fontErrorMessage(gioError(Gio.IOErrorEnum.NOT_FOUND, 'No such file or directory'));
            expect(message).toBe('No such file or directory');
            expect(message).not.toMatch(/^Gio\.[A-Za-z]+: /);
        });

        await it('reports a plain Error as its message', async () => {
            expect(fontErrorMessage(new Error('plain'))).toBe('plain');
        });
    });

    await describe('reading a font map', async () => {
        await it('names families the map holds and answers `absent` for one that cannot exist', async () => {
            // The discriminator every other assertion leans on. Asked of Pango rather than derived
            // from a list, because `get_family` is what a `fillText` in `family` actually resolves
            // against.
            const map = PangoCairo.FontMap.get_default();
            const families = fontMapFamilies(map);
            expect(families.length).toBeGreaterThan(0);
            expect(fontMapHasFamily(map, INVENTED_FAMILY)).toBe(false);
        });
    });

    await describe('registerFontFaces — nothing to register', async () => {
        await it('answers with the map in force, and accounts for no face', async () => {
            const registration = registerFontFaces([]);
            expect(registration.available).toBe(true);
            expect(registration.map).not.toBeNull();
            expect(registration.registered.length).toBe(0);
            expect(registration.declined.length).toBe(0);
            expect(registration.failed.length).toBe(0);
            expect(registration.fontconfigFallback).toBe(false);
        });
    });

    await describe('registerFontFaces — a file that is not a font', async () => {
        await it('reports it as failed with a readable reason, and never throws', async () => {
            // Total by contract: an application must not die over a decorative face. Reported rather
            // than swallowed for the reason ADR 0038 exists — the alternative is an application that
            // renders in the wrong typeface and says nothing at all.
            const { dir, path } = scratchFile('NotAFont.ttf');
            GLib.file_set_contents(path, 'this is not an sfnt file');

            const registration = registerFontFaces([path]);
            expect(registration.available).toBe(true);
            expect(registration.registered.length).toBe(0);
            // NEVER `declined`: a file no map can open is a failure whatever the map, and `declined`
            // carries the opposite meaning — "somebody else already activated this face".
            expect(registration.declined.length).toBe(0);
            expect(registration.failed.length).toBe(1);
            expect(registration.failed[0]?.path).toBe(path);
            expect(registration.failed[0]?.message.length).toBeGreaterThan(0);
            removeTree(dir);
        });
    });

    await describe('registerFontFaces — a real face', async () => {
        // The showcase's `Round9x13` and not a system font, for the reason ADR 0038 § Amendment 4
        // gives: no operating system ships it, so no OS update can retire the control the way one that
        // grew `Tamil Sangam MN` retired the script-based one.
        const source = findFaceSource();

        await it('has the showcase face in reach', async () => {
            // Fails rather than skips, as `tests/e2e/ship-layout` does: without the file every
            // assertion below would run over an empty set and pass having proved nothing.
            expect(source).toBeDefined();
        });

        if (source !== undefined) {
            await it('accounts for it exactly once, and puts the family on the map that answered', async () => {
                const { dir, path } = scratchFile('Round9x13.ttf');
                Gio.File.new_for_path(source).copy(
                    Gio.File.new_for_path(path),
                    Gio.FileCopyFlags.OVERWRITE,
                    null,
                    null,
                );

                const registration = registerFontFaces([path]);
                // The whole accounting rather than one arm of it: WHERE the face lands is a property
                // of the map, not of this function. A CoreText map declines and a fontconfig fallback
                // may then adopt one, while an fc or win32 map registers directly (ADR 0038 § W4,
                // § Amendment 5), and a test pinned to either arm would be red on the other platform.
                expect(registration.registered.length + registration.declined.length).toBe(1);
                expect(registration.failed.length).toBe(0);

                // And the family is on the map that answered — the property a caller needs and the one
                // a `true` return value does not give. (The Windows optical-size rename is why the
                // NAME is asked for and not inferred: the same bytes can register as `Merriweather`
                // under fontconfig and `Merriweather 18pt` under gvsbuild's reader, § W1-W5.)
                if (registration.map !== undefined && registration.registered.length === 1) {
                    expect(fontMapHasFamily(registration.map, 'Round9x13')).toBe(true);
                }
                removeTree(dir);
            });
        }
    });
};
