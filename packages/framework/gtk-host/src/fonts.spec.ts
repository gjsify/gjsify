// Registering shipped faces, against the real default font map.
//
// THE DISCRIMINATOR IS THE POINT, because "the family resolved" is exactly what a substitution
// looks like: Pango answers a missing family with the default sans and reports nothing. So the
// same face file is put OUTSIDE the font directory first and the family must still be absent, then
// inside it and the family must appear — same bytes, same process, only the directory differs.
// ADR 0038 § W5 is the Windows form of the same argument.
//
// Ordering is load-bearing here and the tests are written to depend on it: `add_font_file` mutates
// a process-global font map and there is no unregister, so every negative assertion runs before
// the registration that would invalidate it.

import { describe, expect, it } from '@gjsify/unit';

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

import { initFonts, isUnsupportedByFontMap } from './fonts.js';

/**
 * A real face whose family is on no host, borrowed from the showcase exactly as
 * `tests/e2e/ship-layout` borrows it and for the same reason (ADR 0038): a zero-byte placeholder
 * would prove the directory walk and nothing about a face reaching the font map.
 */
const FACE_RELATIVE = 'showcases/dom/excalibur-jelly-jumper/src/assets/fonts/Round9x13.ttf';
const FACE_FAMILY = 'Round9x13';

/** A family that cannot exist, so "substituted" and "registered" cannot look alike. */
const INVENTED_FAMILY = 'ZzzNoSuchFamilyQx';

/** Walk up from the working directory until the showcase face is in reach. */
function findFaceSource(): string | undefined {
    let dir: Gio.File | null = Gio.File.new_for_path(GLib.get_current_dir());
    for (let up = 0; up < 8 && dir !== null; up++) {
        const candidate = dir.resolve_relative_path(FACE_RELATIVE);
        if (candidate.query_exists(null)) return candidate.get_path() ?? undefined;
        dir = dir.get_parent();
    }
    return undefined;
}

const families = (): string[] =>
    PangoCairo.FontMap.get_default()
        .list_families()
        .map((f) => f.get_name());

/**
 * Pixel size of a two-glyph layout in `family` — the metric half of the discriminator.
 *
 * Calling this RESOLVES the family on `map` and caches the result, so where it is called is part
 * of what each test means (see the ordering suite).
 */
function layoutSize(family: string, map: Pango.FontMap = PangoCairo.FontMap.get_default()): string {
    const description = new Pango.FontDescription();
    description.set_family(family);
    description.set_size(40 * Pango.SCALE);
    const layout = Pango.Layout.new(map.create_context());
    layout.set_font_description(description);
    layout.set_text('Wg', -1);
    return layout.get_pixel_size().join('x');
}

function makeTempDir(tag: string): string {
    return GLib.dir_make_tmp(`gjsify-gtk-host-${tag}-XXXXXX`);
}

/**
 * The reported reason is the GError's `message`, not a stringified GError.
 *
 * `GLib.Error` is NOT `instanceof Error` under GJS (measured, gjs 1.88.1), so the ordinary
 * narrowing misses every error this module actually sees and degrades the reason to
 * `String(error)` — which is not obviously broken, only domain-prefixed
 * (`"Gio.IOErrorEnum: Operation not supported"` against `"Operation not supported"`). Asserted on
 * the SHAPE rather than on Pango's wording, which differs per OS.
 */
function expectCleanGErrorMessage(message: string | undefined): void {
    expect((message ?? '').length).toBeGreaterThan(0);
    expect(message).not.toMatch(/^G(Lib|io)\.[A-Za-z]+: /);
}

function copyFace(source: string, intoDir: string, leaf: string): string {
    const dest = GLib.build_filenamev([intoDir, leaf]);
    Gio.File.new_for_path(source).copy(Gio.File.new_for_path(dest), Gio.FileCopyFlags.OVERWRITE, null, null);
    return dest;
}

/**
 * Does a font map of the backend this process compiled in accept runtime registration?
 *
 * MEASURED, and measured the same way `initFonts` decides: by making the call and reading the
 * ERROR, never by asking `process.platform`. `pangocairo-fontmap.c` picks the first backend
 * COMPILED IN (coretext → win32 → fc) rather than one per platform, and `PANGOCAIRO_BACKEND`
 * overrides that on a single host — so the platform name is not the question. A CoreText map
 * implements no `add_font_file` vfunc and the base implementation answers
 * `G_IO_ERROR_NOT_SUPPORTED`; an fc or win32 map registers the face.
 *
 * On a SCRATCH map, so the probe cannot contaminate the default map the discriminator below reads
 * (verified: registering into a `PangoCairo.FontMap.new()` leaves the default untouched).
 */
function probeRegistrationSupport(face: string | undefined): boolean {
    if (face === undefined) return false;
    try {
        PangoCairo.FontMap.new().add_font_file(face);
        return true;
    } catch (error) {
        if (isUnsupportedByFontMap(error)) return false;
        // Any other GError is a broken PROBE, not an unsupported map — a face this suite could
        // not open would silently turn every gated assertion below into a tolerated xfail.
        throw error;
    }
}

/** Why the registration assertions cannot hold where they are marked expected-failing. */
const NO_REGISTRATION_REASON =
    'this process resolved a font map that implements no `add_font_file` vfunc — on macOS ' +
    "PangoCairoCoreTextFontMap, where `pango_font_map_add_font_file()` falls through to Pango's " +
    'base implementation and answers G_IO_ERROR_NOT_SUPPORTED. Nothing can register a face at ' +
    'runtime there, and nothing needs to: a shipped `.app` activates its own faces declaratively ' +
    'through `ATSApplicationFontsPath` before any of its code runs (ADR 0038 § 3), which is why ' +
    '`initFonts` reports these as DECLINED rather than failed. Retires itself if Pango ever ' +
    'implements the vfunc on CoreText, or on any host where PANGOCAIRO_BACKEND selects fc.';

/** Remove a flat directory and its entries — these fixtures never nest. */
function removeTree(dir: string): void {
    const file = Gio.File.new_for_path(dir);
    const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    for (let info = children.next_file(null); info !== null; info = children.next_file(null)) {
        children.get_child(info).delete(null);
    }
    file.delete(null);
}

export default async () => {
    await describe('initFonts — nothing to do', async () => {
        await it('does nothing, quietly, when no directory is named', async () => {
            // `gjsify ship` exports GJSIFY_FONT_DIR only when it staged a face, so this is the
            // ordinary case for every application that ships none.
            const result = initFonts({ fontDir: '' });
            expect(result.dir).toBeUndefined();
            expect(result.registered.length).toBe(0);
            expect(result.declined.length).toBe(0);
            expect(result.failed.length).toBe(0);
        });

        await it('reports a named directory that cannot be read, rather than swallowing it', async () => {
            // A variable that IS set names a payload promising faces; a directory that is not
            // there means it did not deliver them, which is the silent-substitution case.
            // `GLib.build_filenamev`, never a template literal: `GLib.get_tmp_dir()` answers
            // `/var/folders/…/T/` WITH a trailing separator on macOS and `/tmp` without one on
            // Linux, so `${tmp}/name` produces a DOUBLED separator there. `Gio.File` normalises
            // that away, so the path `initFonts` reports back differed from the string this test
            // handed it — measured on the darwin leg of `gtk-os-suites.yml`, and structurally
            // invisible on Linux, where the two spellings coincide.
            const missing = GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-gtk-host-absent-${Date.now()}`]);
            const result = initFonts({ fontDir: missing });
            expect(result.dir).toBe(missing);
            expect(result.registered.length).toBe(0);
            expect(result.failed.length).toBe(1);
            // Against Gio's own spelling of the same path, so this compares what the walk
            // REPORTS with what the walk was GIVEN, not with a second hand-built string.
            expect(result.failed[0]?.path).toBe(Gio.File.new_for_path(missing).get_path());
            expectCleanGErrorMessage(result.failed[0]?.message);
        });

        await it('ignores the strays a font directory legitimately carries', async () => {
            const dir = makeTempDir('strays');
            GLib.file_set_contents(GLib.build_filenamev([dir, 'OFL.txt']), 'the license, not a face');
            GLib.file_set_contents(GLib.build_filenamev([dir, 'README.md']), 'notes');
            const result = initFonts({ fontDir: dir });
            expect(result.registered.length).toBe(0);
            expect(result.failed.length).toBe(0);
            removeTree(dir);
        });

        await it('never silently drops a face that will not open, and never throws', async () => {
            // Total, like `installDevtools`: an application must not die over a decorative face —
            // but it must not lose one silently either, which is the whole of ADR 0038. WHICH
            // bucket it lands in is the map's answer, and a map that declines every registration
            // never opens the file at all, so there is no parse failure for it to report.
            const dir = makeTempDir('broken');
            const broken = GLib.build_filenamev([dir, 'Broken.ttf']);
            GLib.file_set_contents(broken, 'not a font at all');
            const result = initFonts({ fontDir: dir });
            expect(result.registered.length).toBe(0);
            expect([...result.failed.map((f) => f.path), ...result.declined]).toStrictEqual([broken]);
            for (const failure of result.failed) expectCleanGErrorMessage(failure.message);
            removeTree(dir);
        });
    });

    await describe('initFonts — the directory decides, and the family proves it', async () => {
        const source = findFaceSource();
        const REGISTRATION_SUPPORTED = probeRegistrationSupport(source);

        await it('has the showcase face in reach', async () => {
            // Fails rather than skips, exactly as `tests/e2e/ship-layout` does: without the face
            // every assertion below would run over an empty set and pass having proved nothing.
            expect(source).toBeDefined();
        });

        if (source === undefined) return;

        const outside = makeTempDir('outside');
        const inside = makeTempDir('inside');
        const empty = makeTempDir('empty');

        await it('does not know the family before anything is registered', async () => {
            expect(families()).not.toContain(FACE_FAMILY);
        });

        await it('leaves a face OUTSIDE the font directory invisible to Pango', async () => {
            // The negative half of the discriminator. The file exists, it is a real face, and it
            // is one `initFonts` would take — it is simply not in the directory it was given.
            copyFace(source, outside, 'Round9x13.ttf');
            const result = initFonts({ fontDir: empty });
            expect(result.dir).toBe(empty);
            expect(result.registered.length).toBe(0);
            expect(result.failed.length).toBe(0);
            expect(families()).not.toContain(FACE_FAMILY);
        });

        // The half of the contract that holds on EVERY font map, and the reason these are plain
        // `it()`s while the four below are gated: what `initFonts` promises unconditionally is
        // that it FINDS the staged face and accounts for it — a face is never silently dropped,
        // and a map declining to register one is not a failure to report.
        await it('finds the staged face and accounts for it, on any font map', async () => {
            const staged = copyFace(source, inside, 'Round9x13.ttf');
            const result = initFonts({ fontDir: inside });
            expect(result.dir).toBe(inside);
            expect([...result.registered, ...result.declined]).toStrictEqual([staged]);
            expect(result.failed.length).toBe(0);
        });

        await it('routes it to `declined` exactly when the map declines, never to `failed`', async () => {
            // The macOS half stated as an assertion rather than as an excuse: on a CoreText map
            // every staged face lands in `declined`, and calling that a FAILURE would make a
            // correct `.app` — whose faces `ATSApplicationFontsPath` already activated — print a
            // warning per face about a substitution that is not happening.
            const result = initFonts({ fontDir: inside });
            expect(result.declined.length).toBe(REGISTRATION_SUPPORTED ? 0 : 1);
            expect(result.registered.length).toBe(REGISTRATION_SUPPORTED ? 1 : 0);
            expect(result.failed.length).toBe(0);
        });

        await it.failing(
            'puts the family on the map a widget renders through',
            async () => {
                expect(families()).toContain(FACE_FAMILY);
                expect(PangoCairo.FontMap.get_default().get_family(FACE_FAMILY)).not.toBeNull();
            },
            NO_REGISTRATION_REASON,
            { when: !REGISTRATION_SUPPORTED },
        );

        await it.failing(
            'measures the family DIFFERENTLY from an invented one',
            async () => {
                // The assertion that makes the one above a finding rather than a call that
                // returned true: different metrics are a different FACE, not a substitution. This
                // is also the FIRST time this process asks the default map to resolve
                // `FACE_FAMILY`, and that is deliberate — see the ordering suite below.
                expect(layoutSize(FACE_FAMILY)).not.toBe(layoutSize(INVENTED_FAMILY));
            },
            NO_REGISTRATION_REASON,
            { when: !REGISTRATION_SUPPORTED },
        );

        await it('cleans up its fixtures', async () => {
            for (const dir of [outside, inside, empty]) removeTree(dir);
            for (const dir of [outside, inside, empty]) {
                expect(Gio.File.new_for_path(dir).query_exists(null)).toBe(false);
            }
        });
    });

    await describe('registration is not retroactive, which is why initFonts belongs at startup', async () => {
        const source = findFaceSource();
        if (source === undefined) return;
        const REGISTRATION_SUPPORTED = probeRegistrationSupport(source);

        await it.failing(
            'leaves a family that was already resolved on its substitute',
            async () => {
                // MEASURED, and it turns "call this at startup" from a style note into a contract.
                // A `PangoCairoFcFontMap` caches the fontset it resolved for a description, and
                // `add_font_file` does NOT invalidate that cache: the family joins `list_families()`
                // while a layout asking for it keeps measuring the FALLBACK. So an application that
                // lays out text before calling `initFonts` gets the substituted typeface for the life
                // of the process, with the family visibly present — which reads as "the font is
                // installed and Pango is ignoring it".
                //
                // On a SCRATCH map (`PangoCairo.FontMap.new()`), not the default one: asking the
                // default map to resolve the family here would populate the very cache the suite above
                // depends on being cold, and these two facts cannot both be measured on one map in one
                // process. Verified isolated — registering into this map leaves the default untouched.
                const scratch = PangoCairo.FontMap.new();
                const before = layoutSize(FACE_FAMILY, scratch);
                expect(before).toBe(layoutSize(INVENTED_FAMILY, scratch));

                const dir = makeTempDir('ordering');
                scratch.add_font_file(copyFace(source, dir, 'Round9x13.ttf'));

                expect(scratch.list_families().map((f) => f.get_name())).toContain(FACE_FAMILY);
                expect(layoutSize(FACE_FAMILY, scratch)).toBe(before);
                removeTree(dir);
            },
            // A map that registers NOTHING has no post-registration state that could be stale, so
            // there is no cache-invalidation question to answer there — `add_font_file` throws
            // before the first assertion. The ordering rule this documents still binds every
            // caller; it is only unobservable where registration itself is.
            NO_REGISTRATION_REASON,
            { when: !REGISTRATION_SUPPORTED },
        );
    });

    await describe('isUnsupportedByFontMap — the macOS branch, checked from anywhere', async () => {
        // The one behaviour no leg in this repository can produce for real: a CoreText font map
        // implements no `add_font_file` vfunc, so the base implementation answers
        // G_IO_ERROR_NOT_SUPPORTED. Keying on the ERROR rather than on `process.platform` is what
        // makes it checkable here at all — a platform string could only be asserted on macOS.
        await it('recognises the answer a font map with no runtime registration gives', async () => {
            const error = GLib.Error.new_literal(
                Gio.io_error_quark(),
                Gio.IOErrorEnum.NOT_SUPPORTED,
                'Operation not supported',
            );
            expect(isUnsupportedByFontMap(error)).toBe(true);
        });

        await it('does not swallow any other GError', async () => {
            // The failure a bad face actually produces here is a GLib.FileError, and it must be
            // reported: treating every GError as "this map does not do registration" would hide
            // exactly the missing typeface the mechanism exists to surface.
            const sameDomain = GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.FAILED, 'nope');
            const otherDomain = GLib.Error.new_literal(GLib.file_error_quark(), GLib.FileError.NOENT, 'no such file');
            expect(isUnsupportedByFontMap(sameDomain)).toBe(false);
            expect(isUnsupportedByFontMap(otherDomain)).toBe(false);
        });

        await it('does not treat a plain JS error as a declining font map', async () => {
            expect(isUnsupportedByFontMap(new Error('boom'))).toBe(false);
            expect(isUnsupportedByFontMap(undefined)).toBe(false);
        });
    });
};
