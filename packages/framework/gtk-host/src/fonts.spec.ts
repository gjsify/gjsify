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

import { describe, expect, it, on } from '@gjsify/unit';

import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

import {
    adwaitaUiFontAvailability,
    applyUiFontPolicy,
    type FontFaceFailure,
    initFonts,
    type InitFontsResult,
    isUnsupportedByFontMap,
    matchFontFamily,
    uiFontBaseline,
} from './fonts.js';
import { ADWAITA_UI_FONT_FAMILY, GNOME_UI_FONT_POINT_SIZE, UI_FONT_POLICIES } from './ui-font.js';
import { GTK_HOSTS } from './testing/gate.mjs';

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

/** What ONE source contributed, which is what every assertion in this file is actually about. */
interface Accounted {
    readonly registered: readonly string[];
    readonly declined: readonly string[];
    readonly failed: readonly FontFaceFailure[];
}

/** No source of that origin was resolved, so it contributed nothing. */
const NOTHING: Accounted = { registered: [], declined: [], failed: [] };

/**
 * What the APPLICATION's directory — the one each test below stages — contributed.
 *
 * THE READ THAT TURNED RED ON 0.51.0, and the reason these assertions no longer touch
 * `result.registered` at all. `initFonts` resolves TWO sources (`font-dir.ts`): the application's
 * own faces, and the GTK runtime bundle's GNOME UI typeface, which `@gjsify/node-gi`'s loader
 * names through `GJSIFY_GTK_RUNTIME_FONT_DIR` whenever the process runs on a batteries-included
 * bundle. The flat `registered`/`declined`/`failed` lists span both. So on the legs that pair this
 * checkout with a PUBLISHED bundle, every count here moved the moment that bundle started carrying
 * the Adwaita faces — six of them — and each of these tests started measuring a number it has no
 * business knowing: 0 became 6, one staged path became seven paths.
 *
 * Pinning the new number would be worse than the bug, because the seventh face would break it
 * again and it would still be asserting nothing about the directory the test staged. Asking the
 * source THIS TEST created what it contributed is the question each assertion was always making.
 */
function appFaces(result: InitFontsResult): Accounted {
    return result.sources.find((source) => source.origin === 'app') ?? NOTHING;
}

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
        await it('does nothing for the application when no directory is named', async () => {
            // `gjsify ship` exports GJSIFY_FONT_DIR only when it staged a face, so this is the
            // ordinary case for every application that ships none.
            //
            // `families` is deliberately NOT asserted here. With nothing staged and nothing asked
            // about, this call takes the early return and reports `[]` no matter what the diff
            // below it does — so an assertion here could not fail, and the one test that CAN hold
            // the diff's guard is the sibling below, which reaches it by naming a family.
            const result = initFonts({ fontDir: '' });
            expect(result.dir).toBeUndefined();
            // No APPLICATION source was resolved at all — the claim this test makes, and the one
            // that stays true on a host whose runtime bundle names a font directory of its own.
            expect(result.sources.some((source) => source.origin === 'app')).toBe(false);
            const mine = appFaces(result);
            expect(mine.registered.length).toBe(0);
            expect(mine.declined.length).toBe(0);
            expect(mine.failed.length).toBe(0);
            expect(result.matches.length).toBe(0);
        });

        await it('still answers `expectedFamilies` when it staged nothing', async () => {
            // The macOS shape, where the `.app` activated the directory declaratively before any
            // of this code ran: nothing to register, and "is the family this application asks for
            // actually here" is still a fair question. The invented family is the discriminator —
            // a check that answered `exact` for everything would satisfy the first line alone.
            const before = families();
            const result = initFonts({ fontDir: '', expectedFamilies: [INVENTED_FAMILY] });
            expect(result.matches.length).toBe(1);
            expect(result.matches[0]?.kind).toBe('absent');
            expect(result.matches[0]?.family).toBeUndefined();
            // And `families` credits this call with nothing that was already on the map. Reading
            // the map to answer the question above means there is an `after`, and where no
            // directory was resolved there is no `before` — subtracting one from the other would
            // credit this call with every family on the host, which is the opposite of what it
            // reports. Stated as the relation rather than as `length === 0`, because a host whose
            // runtime bundle names a font directory resolves a source here and may genuinely gain
            // a family through it.
            for (const family of result.families) expect(before).not.toContain(family);
            expect(result.dir).toBeUndefined();
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
            const mine = appFaces(result);
            expect(result.dir).toBe(missing);
            expect(mine.registered.length).toBe(0);
            expect(mine.failed.length).toBe(1);
            // Against Gio's own spelling of the same path, so this compares what the walk
            // REPORTS with what the walk was GIVEN, not with a second hand-built string.
            expect(mine.failed[0]?.path).toBe(Gio.File.new_for_path(missing).get_path());
            expectCleanGErrorMessage(mine.failed[0]?.message);
        });

        await it('ignores the strays a font directory legitimately carries', async () => {
            const dir = makeTempDir('strays');
            GLib.file_set_contents(GLib.build_filenamev([dir, 'OFL.txt']), 'the license, not a face');
            GLib.file_set_contents(GLib.build_filenamev([dir, 'README.md']), 'notes');
            const mine = appFaces(initFonts({ fontDir: dir }));
            expect(mine.registered.length).toBe(0);
            expect(mine.failed.length).toBe(0);
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
            const mine = appFaces(initFonts({ fontDir: dir }));
            expect(mine.registered.length).toBe(0);
            expect([...mine.failed.map((f) => f.path), ...mine.declined]).toStrictEqual([broken]);
            for (const failure of mine.failed) expectCleanGErrorMessage(failure.message);
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
            const mine = appFaces(result);
            expect(result.dir).toBe(empty);
            expect(mine.registered.length).toBe(0);
            expect(mine.failed.length).toBe(0);
            expect(families()).not.toContain(FACE_FAMILY);
        });

        // The half of the contract that holds on EVERY font map, and the reason these are plain
        // `it()`s while the four below are gated: what `initFonts` promises unconditionally is
        // that it FINDS the staged face and accounts for it — a face is never silently dropped,
        // and a map declining to register one is not a failure to report.
        await it('finds the staged face and accounts for it, on any font map', async () => {
            const staged = copyFace(source, inside, 'Round9x13.ttf');
            const result = initFonts({ fontDir: inside });
            const mine = appFaces(result);
            expect(result.dir).toBe(inside);
            expect([...mine.registered, ...mine.declined]).toStrictEqual([staged]);
            expect(mine.failed.length).toBe(0);
        });

        await it('routes it to `declined` exactly when the map declines, never to `failed`', async () => {
            // The macOS half stated as an assertion rather than as an excuse: on a CoreText map
            // every staged face lands in `declined`, and calling that a FAILURE would make a
            // correct `.app` — whose faces `ATSApplicationFontsPath` already activated — print a
            // warning per face about a substitution that is not happening.
            const mine = appFaces(initFonts({ fontDir: inside }));
            expect(mine.declined.length).toBe(REGISTRATION_SUPPORTED ? 0 : 1);
            expect(mine.registered.length).toBe(REGISTRATION_SUPPORTED ? 1 : 0);
            expect(mine.failed.length).toBe(0);
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

        await it.failing(
            'reports the FAMILY NAME the registration added, not only the file',
            async () => {
                // #1542: `initFonts` reported the FILES, and a caller can act on none of them.
                // `set_family()` takes a family NAME, the name comes out of the font's naming
                // table, and which name you get depends on which font stack read it — the same
                // byte-identical face registers as `Merriweather` under fontconfig and
                // `Merriweather 18pt` under gvsbuild. Only the call that registered it is in a
                // position to take this diff.
                //
                // The face is ALREADY on the map by the time this runs (the suite above
                // registered it), so this call adds nothing and `families` is empty — which is
                // the honest answer and not the interesting one. The interesting one is a
                // registration into a map that does not have it yet, below.
                const dir = makeTempDir('familydiff');
                copyFace(source, dir, 'Round9x13.ttf');
                const before = families();
                const result = initFonts({ fontDir: dir, expectedFamilies: [FACE_FAMILY, INVENTED_FAMILY] });

                // What the call ADDED is a subset of what the map holds, always — a diff that
                // reported a name the map does not have would be arithmetic rather than a
                // measurement.
                for (const family of result.families) expect(families()).toContain(family);
                expect(before.length).toBeGreaterThan(0);

                // The actionable half, and the reason the field exists: the declared name
                // resolves, the invented one does not, and the two are told apart by NAME rather
                // than by a count that is `registered: 1, failed: 0` either way.
                //
                // The RESOLVED SPELLING is deliberately not pinned, and pinning it would
                // contradict the feature: which name a face ends up under is what differs
                // between font stacks (#1542 — one file, `Merriweather` here and
                // `Merriweather 18pt` under gvsbuild). What must hold on every host is that the
                // declared name resolves to SOMETHING the map has, and that an invented one
                // does not.
                expect(result.matches.map((match) => match.declared)).toStrictEqual([FACE_FAMILY, INVENTED_FAMILY]);
                expect(result.matches[0]?.kind).not.toBe('absent');
                expect(families()).toContain(result.matches[0]?.family);
                expect(result.matches[1]?.kind).toBe('absent');
                expect(result.matches[1]?.family).toBeUndefined();
                removeTree(dir);
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

    await describe('two sources, and the runtime bundle is never the application', async () => {
        const source = findFaceSource();

        await it('has the showcase face in reach', async () => {
            expect(source).toBeDefined();
        });

        if (source === undefined) return;

        await it("keeps the runtime bundle's faces out of the application's tally", async () => {
            // THE SHAPE THAT TURNED `main` RED AT 0.51.0, staged here instead of waited for.
            // A batteries-included GTK runtime bundle ships the GNOME UI typeface, `@gjsify/node-gi`'s
            // loader names that directory through `GJSIFY_GTK_RUNTIME_FONT_DIR`, and `initFonts`
            // registers it as a SECOND source — so the flat `registered`/`declined`/`failed` lists
            // span both directories. Nothing in this file changed; the published bundle gained six
            // faces and seven assertions that read those flat lists started measuring the bundle.
            //
            // Driven from the OPTION rather than from the environment, which is what makes this a
            // gate instead of a coincidence: the two-source shape is then exercised on every host,
            // not only on the legs that happen to run on a bundle. It is also the discriminator for
            // `appFaces` — if that helper stopped excluding anything, or excluded everything, this
            // is the assertion that goes red.
            const runtimeDir = makeTempDir('runtimefonts');
            const runtimeFace = copyFace(source, runtimeDir, 'RuntimeFace.ttf');
            const appDir = makeTempDir('appfonts');
            const appFace = copyFace(source, appDir, 'AppFace.ttf');

            const result = initFonts({ fontDir: appDir, runtimeFontDir: runtimeDir });

            // RUNTIME FIRST — the order `resolveFontSources` promises — and `dir` stays SINGULAR:
            // the APPLICATION's directory, which is what a caller asserting "my staged face was
            // found" reads.
            expect(result.sources.map((entry) => entry.origin)).toStrictEqual(['runtime', 'app']);
            expect(result.dir).toBe(appDir);

            // BOTH faces are accounted for. Dropping the runtime's would be the opposite defect,
            // and the one #1662 exists against: off Linux nothing else installs that typeface.
            expect([...result.registered, ...result.declined].sort()).toStrictEqual([appFace, runtimeFace].sort());
            expect(result.failed.length).toBe(0);

            // And each face is attributed to the directory it came from, which is the read every
            // assertion above makes instead of the flat lists.
            expect([...appFaces(result).registered, ...appFaces(result).declined]).toStrictEqual([appFace]);
            const theirs = result.sources.find((entry) => entry.origin === 'runtime');
            expect([...(theirs?.registered ?? []), ...(theirs?.declined ?? [])]).toStrictEqual([runtimeFace]);
            expect(theirs?.dir).toBe(runtimeDir);

            removeTree(appDir);
            removeTree(runtimeDir);
        });

        await it('attributes an unreadable directory to the source that named it', async () => {
            // The `failed` arm of the same split: `collectFaces` reports a directory it cannot
            // read, and that report belongs to the source whose directory it was. One live
            // directory beside one missing one, so the assertion cannot pass by both being empty.
            const runtimeDir = makeTempDir('runtimeok');
            const runtimeFace = copyFace(source, runtimeDir, 'RuntimeFace.ttf');
            const missing = GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-gtk-host-gone-${Date.now()}`]);

            const result = initFonts({ fontDir: missing, runtimeFontDir: runtimeDir });

            const mine = appFaces(result);
            expect(mine.failed.map((failure) => failure.path)).toStrictEqual([
                Gio.File.new_for_path(missing).get_path(),
            ]);
            expect(mine.registered.length).toBe(0);
            expect(mine.declined.length).toBe(0);

            const theirs = result.sources.find((entry) => entry.origin === 'runtime');
            expect(theirs?.failed.length).toBe(0);
            expect([...(theirs?.registered ?? []), ...(theirs?.declined ?? [])]).toStrictEqual([runtimeFace]);

            removeTree(runtimeDir);
        });
    });

    await describe('registering a family that was already resolved', async () => {
        const source = findFaceSource();
        if (source === undefined) return;
        const REGISTRATION_SUPPORTED = probeRegistrationSupport(source);

        await it.failing(
            'still puts it in list_families, whatever the backend does with its cache',
            async () => {
                // WHAT IS PORTABLE is the family arriving; what happens to an ALREADY-RESOLVED
                // layout is the backend's business, and the two must not be conflated. An earlier
                // revision of this test asserted the fontconfig behaviour as if it were universal
                // and failed on the win32 leg, which was right to fail:
                //   fontconfig — the fontset cached for a description survives `add_font_file`, so
                //     a layout that measured the family FIRST keeps measuring the fallback for the
                //     life of the process (measured here: 87x63 before and after, while
                //     `list_families()` gains the family).
                //   win32/DirectWrite — `add_font_file` clears the map's cache and emits `changed`
                //     (ADR 0038), so the same layout picks the real face up.
                // Hence `initFonts` is documented to run before any text is laid out: on the
                // backend that does NOT invalidate, calling it late is unrecoverable, and on the
                // one that does, calling it early costs nothing. The instruction is portable even
                // though the hazard is not.
                //
                // On a SCRATCH map (`PangoCairo.FontMap.new()`), not the default one: resolving the
                // family on the default map here would populate the very cache the discriminator
                // suite above depends on being cold. Verified isolated — registering into this map
                // leaves the default untouched.
                const scratch = PangoCairo.FontMap.new();
                expect(layoutSize(FACE_FAMILY, scratch)).toBe(layoutSize(INVENTED_FAMILY, scratch));

                const dir = makeTempDir('ordering');
                scratch.add_font_file(copyFace(source, dir, 'Round9x13.ttf'));

                expect(scratch.list_families().map((f) => f.get_name())).toContain(FACE_FAMILY);
                removeTree(dir);
            },
            // A map that registers NOTHING never reaches the assertion — `add_font_file` throws
            // first. The ordering rule still binds every caller; it is only unobservable where
            // registration itself is.
            NO_REGISTRATION_REASON,
            { when: !REGISTRATION_SUPPORTED },
        );
    });

    await describe('the family diff is a DIFF, on a map that did not have the family', async () => {
        const source = findFaceSource();
        if (source === undefined) return;
        const REGISTRATION_SUPPORTED = probeRegistrationSupport(source);

        await it.failing(
            'names the family that arrived, and names nothing when nothing arrives',
            async () => {
                // On a SCRATCH map, for the reason the ordering suite gives: the default map has
                // had this family since the discriminator suite ran, so a diff against it is
                // legitimately empty and would prove nothing. Here the family is genuinely absent
                // first, which is what makes the answer a measurement.
                //
                // `initFonts` registers into the DEFAULT map by design, so this drives the same
                // two steps by hand — `add_font_file` then the family list — and asserts the
                // relation `initFonts` computes. A scratch-map variant of `initFonts` would be a
                // second implementation, and the thing under test is the relation.
                const scratch = PangoCairo.FontMap.new();
                const before = scratch.list_families().map((f) => f.get_name());
                expect(before).not.toContain(FACE_FAMILY);
                expect(matchFontFamily(FACE_FAMILY, before).kind).toBe('absent');

                const dir = makeTempDir('freshmap');
                scratch.add_font_file(copyFace(source, dir, 'Round9x13.ttf'));

                const after = scratch.list_families().map((f) => f.get_name());
                const gained = after.filter((name) => !before.includes(name));
                expect(gained.length).toBeGreaterThan(0);
                // And the resolution FLIPS with it: absent before, resolvable after, from the
                // same declared name. That pair is what a caller needs and could not get — and
                // it is asserted as a flip rather than as a spelling, because the spelling is
                // the thing that differs per platform.
                expect(matchFontFamily(FACE_FAMILY, after).kind).not.toBe('absent');
                expect(gained).toContain(matchFontFamily(FACE_FAMILY, after).family);
                removeTree(dir);
            },
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

    // --- the three-state UI font policy, against a REAL Gtk.Settings ---------
    //
    // `ui-font.spec.ts` exercises the DECISION with no toolkit at all. This is the half that
    // cannot be decided: whether a plan actually moves `gtk-font-name`, and — the case a
    // consumer switching states in a preferences dialog depends on — whether the way BACK
    // lands on the host's own value rather than an approximation of it.
    //
    // `Gtk.init()` first, because `Gtk.Settings.get_default()` answers null before it and
    // every assertion below would then measure the null path instead of the setting.
    await on(GTK_HOSTS, async () => {
        Gtk.init();

        await describe('the UI font policy, switched at runtime on a live Gtk.Settings', async () => {
            await it("captures the host's own value BEFORE anything writes", async () => {
                // The load-bearing half. Read early it is the host's; read after a write it is
                // whatever was written, and the original is gone — GTK keeps no previous value
                // and no schema can supply it.
                const settings = Gtk.Settings.get_default();
                expect(settings).not.toBeNull();
                expect(uiFontBaseline()).toBe(settings?.gtk_font_name ?? undefined);
            });

            await it("walks all three states and comes back to the host's own value", async () => {
                const settings = Gtk.Settings.get_default();
                if (settings === null) return; // asserted above; keeps this row honest on its own
                const baseline = uiFontBaseline();
                // THE NAME THE MAP HOLDS, not the one we declare. `Adwaita Sans` is a variable
                // font with an `opsz` axis, so fontconfig reports `Adwaita Sans` and gvsbuild's
                // DirectWrite reader reports `Adwaita Sans Text` — measured, and it is why this
                // test asked for a family Windows does not have on its first run.
                const adwaitaFamily = adwaitaUiFontAvailability().match.family ?? ADWAITA_UI_FONT_FAMILY;
                const adwaitaValue = `${adwaitaFamily} ${GNOME_UI_FONT_POINT_SIZE}`;

                // THE DEGENERATE HOST, DETECTED RATHER THAN PASSED THROUGH. On a current GNOME
                // the interface font ALREADY is `Adwaita Sans 11`, so `system` and `adwaita` name
                // the same value and no round trip can tell them apart. Measured here: with the
                // baseline capture deliberately disabled, this row still went GREEN — a test that
                // cannot fail on the defect it exists for. The Windows and macOS legs, where the
                // host is `Segoe UI 9` / the Apple system font, are the ones that discriminate.
                const discriminating = baseline !== undefined && baseline !== adwaitaValue;

                // system — nothing moves. This is the state that did not exist while `size` was
                // hard-wired: applying the policy used to mean accepting 11 pt.
                const kept = applyUiFontPolicy('system');
                expect(kept.kind).toBe('kept');
                expect(settings.gtk_font_name).toBe(baseline);

                // adwaita — the GNOME face at GNOME's size, the same on every platform.
                //
                // ASSERTED ON THE SETTING, NOT ON THE `kind`, and that is a correction: the first
                // version expected `family` and failed on this very host, because a current GNOME
                // already ships `Adwaita Sans 11` — so `kept` was the right answer and the test
                // was measuring an incidental detail of the host rather than the outcome.
                const forced = applyUiFontPolicy('adwaita');
                expect(settings.gtk_font_name).toBe(adwaitaValue);
                expect(['family', 'kept']).toContain(forced.kind);

                if (discriminating) {
                    // The pair genuinely moved the setting, so the way back has something to undo.
                    expect(settings.gtk_font_name).not.toBe(baseline);
                    expect(forced.kind).toBe('family');
                }

                // THE WAY BACK, and the reason the baseline exists at all: from here the host's
                // own value is not reconstructible from anything the platform still holds.
                const back = applyUiFontPolicy('system');
                expect(settings.gtk_font_name).toBe(baseline);
                if (discriminating) {
                    expect(back.kind).toBe('restored');
                    expect(back.next).toBe(baseline);
                } else {
                    console.log(
                        `initFonts spec: this host's gtk-font-name is already "${adwaitaValue}", so system and ` +
                            'adwaita are the same value and the round trip cannot discriminate here — the decision ' +
                            'is covered host-independently by ui-font.spec.ts, and the win32/darwin legs discriminate.',
                    );
                }

                // size — family kept, size raised, and only upward.
                applyUiFontPolicy('size');
                const raised = settings.gtk_font_name ?? '';
                expect(raised.endsWith(` ${GNOME_UI_FONT_POINT_SIZE}`) || raised === baseline).toBe(true);

                // Leave the process on the host's own setting: this mutates display-wide state
                // that later suites in the same run read.
                applyUiFontPolicy('system');
                expect(settings.gtk_font_name).toBe(baseline);
            });

            await it("THE WAY BACK is real: a forced value is undone to the host's own", async () => {
                // HOST-INDEPENDENT BY CONSTRUCTION, which the row above cannot be: on a current
                // GNOME the host is already `Adwaita Sans 11`, so `adwaita` moves nothing and the
                // round trip proves nothing. Forcing an INVENTED family guarantees the setting
                // moves on every host, so the restore has something real to undo — the same
                // discriminator this file already uses for a font family that must not resolve.
                //
                // This is the row that fails when the baseline is broken. Measured: with
                // `captureUiFontBaseline()` replaced by `undefined`, `system` becomes a no-op and
                // the setting stays on the probe value.
                const settings = Gtk.Settings.get_default();
                if (settings === null) return;
                const baseline = uiFontBaseline();
                expect(baseline).not.toBeUndefined();

                applyUiFontPolicy({ policy: 'adwaita', family: 'ZzzRoundTripProbe' });
                expect(settings.gtk_font_name).toBe(`ZzzRoundTripProbe ${GNOME_UI_FONT_POINT_SIZE}`);
                expect(settings.gtk_font_name).not.toBe(baseline);

                const back = applyUiFontPolicy('system');
                expect(back.kind).toBe('restored');
                expect(back.next).toBe(baseline);
                expect(settings.gtk_font_name).toBe(baseline);
            });

            await it('re-applying a state writes nothing the second time', async () => {
                // No write means no `gtk-font-name` notify, so a consumer can apply its stored
                // policy on every startup without churning the setting or the widgets bound to it.
                applyUiFontPolicy('adwaita');
                expect(applyUiFontPolicy('adwaita').kind).toBe('kept');
                expect(applyUiFontPolicy('adwaita').next).toBeUndefined();
                applyUiFontPolicy('system');
            });

            await it('says whether the adwaita state can honestly be offered', async () => {
                // The question a preferences dialog has to ask BEFORE it offers the option:
                // forcing `Adwaita Sans 11` where that family never arrived trades one
                // substitution for another, with a setting that then lies about what it did.
                const availability = adwaitaUiFontAvailability();
                expect(availability.family).toBe(ADWAITA_UI_FONT_FAMILY);
                expect(availability.available).toBe(availability.match.kind !== 'absent');
                // An invented family must answer `absent`, or the probe says yes to everything
                // and a consumer would offer the option on every host.
                expect(adwaitaUiFontAvailability('ZzzNoSuchFamilyQx').available).toBe(false);
                expect(adwaitaUiFontAvailability('ZzzNoSuchFamilyQx').match.kind).toBe('absent');
            });

            await it('offers exactly the three states, and every one of them applies', async () => {
                // A state in the list that no consumer can apply would be a dialog entry that
                // does nothing; this walks the exported list rather than three literals.
                for (const policy of UI_FONT_POLICIES) {
                    expect(typeof applyUiFontPolicy(policy).kind).toBe('string');
                }
                applyUiFontPolicy('system');
            });
        });
    });
};
