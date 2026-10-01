// `@gjsify/utils/font-map` — the registration and the fontconfig fallback, on the real font map.
//
// WHAT IS HERE AND WHAT IS NOT, and why the split falls where it does. Everything in this file runs on
// every platform. The property that only a CoreText map exhibits — declining a face outright, and the
// fontconfig fallback that rescues it — is measured where it can be observed, in `@gjsify/gtk-host`'s
// `fonts.spec.ts` and in `dom-elements`' `font-face.spec.ts`. What belongs HERE is the decision logic,
// and there are now two of those decisions. One is `isUnsupportedByFontMap`: ADR 0038 § Amendment says
// of that function that keying it on the error rather than on `process.platform` "becomes checkable
// from a Linux runner — a synthesised `GLib.Error` in the Gio domain exercises it, where a platform
// read could only ever be asserted on macOS". This file is that runner, and it is the whole reason the
// function has no OS branch in it. The other is `fontMapServesFamily`, the reading that tells a face a
// map TOOK from one it can SERVE, which no single leg can produce on demand and which is therefore held
// through its probe seam for the same reason: the comparison is where the decision lives, so that is
// what is asserted.
//
// The synthesised error and the synthesised probe are the point rather than a shortcut: the real
// decline needs a CoreText map and the real poison needs a fontconfig map that was asked before the face
// arrived, so a test waiting for either would assert nothing on every other platform and the absence of
// an OS branch in both functions would be untested everywhere but the host that motivated the design.

import { describe, expect, it } from '@gjsify/unit';

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
// Type position only — the probe signatures below are typed against it, and nothing here reads a
// Pango member at value.
import type Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

import {
    CAIRO_FONT_TYPE_FT,
    fontErrorMessage,
    fontMapFamilies,
    fontMapHasFamily,
    fontMapServesFamily,
    isUnsupportedByFontMap,
    registerFontFaces,
} from './font-map.js';

/** `CAIRO_FONT_TYPE_FT` as cairo's header spells it — a second constant, so the literal can drift visibly. */
const CAIRO_FONT_TYPE_FT_HEADER_VALUE = 1;

/** A family that cannot exist, so "registered" and "substituted" cannot look alike. */
const INVENTED_FAMILY = 'ZzzNoSuchFamilyQx';

/** A second one, because a control that is accidentally real makes every family look served. */
const INVENTED_FAMILY_TWO = 'ZzzAlsoNoSuchFamilyQx';

/** The showcase face's family. */
const FACE_FAMILY = 'Round9x13';

/**
 * Can the map of the backend THIS PROCESS compiled in accept runtime registration?
 *
 * MEASURED by making the call and reading the ERROR, never by asking `process.platform` — the same
 * discipline `isUnsupportedByFontMap` exists for, and for the same reason: the backend is whichever
 * pango was COMPILED IN plus `PANGOCAIRO_BACKEND`, so a platform string is not the question. Any
 * OTHER GError is a broken PROBE rather than an unsupported map, and is thrown rather than tolerated:
 * a face this suite could not open would silently turn every gated assertion below into a tolerated
 * xfail. On a SCRATCH map, so the probe cannot contaminate the default map.
 */
function probeRegistrationSupport(face: string | undefined): boolean {
    if (face === undefined) return false;
    try {
        PangoCairo.FontMap.new().add_font_file(face);
        return true;
    } catch (error) {
        if (isUnsupportedByFontMap(error)) return false;
        throw error;
    }
}

/**
 * Why the registration-backed assertions cannot hold where they are marked expected-failing: the map
 * of the backend this process compiled in implements no `add_font_file` vfunc, so
 * `pango_font_map_add_font_file()` falls through to Pango's base implementation and answers
 * `G_IO_ERROR_NOT_SUPPORTED`. That is the CoreText map on macOS (ADR 0038 § Amendment 2), and it is
 * the reason `initFonts()` falls back to a fontconfig map there rather than registering on it — which
 * is asserted in `@gjsify/gtk-host`'s `fonts.spec.ts` and `@gjsify/dom-elements`' `font-face.spec.ts`,
 * the two suites that own the end-to-end discriminator.
 */
const NO_REGISTRATION_REASON =
    'the font map of the backend this process compiled in implements no `add_font_file` vfunc — on ' +
    'macOS `PangoCairoCoreTextFontMap`, where `pango_font_map_add_font_file()` falls through to ' +
    "Pango's base implementation and answers G_IO_ERROR_NOT_SUPPORTED (ADR 0038 § Amendment 2). These " +
    'assertions register a real face to have something to measure, so they retire themselves if Pango ' +
    'ever implements the vfunc there, or wherever `PANGOCAIRO_BACKEND` selects another backend.';

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

    // THE DECISION, HELD FROM A HOST THAT CANNOT PRODUCE THE POISON.
    //
    // The condition `fontMapServesFamily` exists to catch needs a fontconfig map that resolved a
    // family to the fallback and then had the face registered on it — reachable on a Linux leg and on
    // a Mac with `PANGOCAIRO_BACKEND=fontconfig`, and on neither of the other two CI hosts. So what
    // is asserted here is the COMPARISON, through the probe seam, which is where the decision
    // actually lives: whether it is a comparison against a control family at all, which family it
    // compares against, and that it reads the map it was handed. Same reasoning as the synthesised
    // GError above, one level up: a platform-gated assertion of this would prove nothing anywhere
    // except the host that motivated it.
    await describe('fontMapServesFamily — the decision, through the probe', async () => {
        await it('answers "not served" when the map measures the family exactly as it measures the control', async () => {
            // THE CASE THIS FUNCTION EXISTS FOR. A map that took a face and cannot serve it measures
            // the requested family identically to a family that does not exist — that identity IS the
            // substitution, and a check keyed on `get_family` answers `true` here.
            const poisoned = (): string => '86x66';
            expect(fontMapServesFamily(PangoCairo.FontMap.get_default(), FACE_FAMILY, poisoned)).toBe(false);
        });

        await it('answers "served" when the two readings differ', async () => {
            // The other arm, and it is not the complement by construction: a probe that returns
            // something new on every call satisfies it, which is what "distinct from the control"
            // means and the reason the control has to be read rather than assumed.
            const distinct = (_map: Pango.FontMap, family: string): string => `${family} 66x50`;
            expect(fontMapServesFamily(PangoCairo.FontMap.get_default(), FACE_FAMILY, distinct)).toBe(true);
        });

        await it('compares against a family that CANNOT exist, not against the family it was handed', async () => {
            // A control that accidentally resolved would make EVERY family look served and turn the
            // classifier into a rubber stamp — so the control is not a constant the caller may pass but
            // a name the function picks, and it is picked to be one no font map holds.
            const asked: string[] = [];
            fontMapServesFamily(PangoCairo.FontMap.get_default(), FACE_FAMILY, (_map, family) => {
                asked.push(family);
                return family === FACE_FAMILY ? '66x50' : '86x66';
            });
            expect(asked).toContain(FACE_FAMILY);
            expect(asked.filter((family) => family !== FACE_FAMILY).length).toBeGreaterThan(0);
            expect(fontMapHasFamily(PangoCairo.FontMap.get_default(), asked[1] ?? INVENTED_FAMILY)).toBe(false);
        });

        await it('reads the map it was handed, and no other', async () => {
            // The map is a parameter rather than a lookup because the whole claim is about a MAP
            // INSTANCE: the fc map's negative resolution is cached per instance, so a decision taken
            // against the process default would answer for a map the caller never registered on. A
            // fresh map is the remedy, which makes that substitution the bug rather than a detail.
            const scratch = PangoCairo.FontMap.new();
            const seen: unknown[] = [];
            const record = (map: Pango.FontMap): string => {
                seen.push(map);
                return '86x66';
            };
            fontMapServesFamily(scratch, FACE_FAMILY, record);
            expect(seen.length).toBeGreaterThan(0);
            for (const map of seen) expect(map).toBe(scratch);
        });
    });

    await describe('fontMapServesFamily — on the real map, every host', async () => {
        const source = findFaceSource();

        await it('answers "not served" for a family no map holds', async () => {
            // PORTABLE, and load-bearing rather than a smoke test: it asserts that the CONTROL reads
            // as substituted on this host. Measured here under both backends (86x66 on the fc map,
            // 80x55 on CoreText), and the risk it rules out is the one that would make every other
            // assertion in this file pass for the wrong reason — a control that resolved to something
            // real would report every family as served.
            const map = PangoCairo.FontMap.get_default();
            expect(fontMapHasFamily(map, INVENTED_FAMILY)).toBe(false);
            expect(fontMapServesFamily(map, INVENTED_FAMILY)).toBe(false);
        });

        await it('reads two families that cannot exist alike, so the answer is not one spelling', async () => {
            // The negative control for the control. If two invented families measured differently the
            // comparison would be deciding on the SPELLING rather than on the typeface, and the
            // real-map assertions in the two font specs would be measuring Pango's name matching.
            expect(fontMapServesFamily(PangoCairo.FontMap.get_default(), INVENTED_FAMILY_TWO)).toBe(false);
        });

        // The remedy's premise, where a face can be registered at all: a map that was never asked
        // about the family holds no cached answer for it, so the same registration that leaves an
        // already-asked map serving the fallback serves the face here. This is what makes a FRESH map
        // the invalidation — asserted on a SCRATCH map, because registering on the default one would
        // both contaminate the suites above and make the result order-dependent.
        await it.failing(
            'serves a family on a map that was never asked about it',
            async () => {
                const scratch = PangoCairo.FontMap.new();
                expect(fontMapHasFamily(scratch, FACE_FAMILY)).toBe(false);
                scratch.add_font_file(source as string);
                // The map holds it, which is the claim a name check makes and the one that was already
                // true of the broken case — so the assertion is the reading, not the name.
                expect(fontMapHasFamily(scratch, FACE_FAMILY)).toBe(true);
                expect(fontMapServesFamily(scratch, FACE_FAMILY)).toBe(true);
                // And the default map never saw any of it.
                expect(fontMapHasFamily(PangoCairo.FontMap.get_default(), FACE_FAMILY)).toBe(false);
            },
            NO_REGISTRATION_REASON,
            { when: !probeRegistrationSupport(source) },
        );
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
                // AND NOTHING IS LEFT UNSERVED. The fourth bucket is the one a face can land in while
                // still counting as `registered`, so on the ordinary path it has to be empty — the
                // product reports a rescue there only when it attempted one.
                expect(registration.unreachable.length).toBe(0);

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
