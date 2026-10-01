// REGISTERING an application's own faces — the reading half of ADR 0038.
//
// `gjsify ship` stages `gjsify.ship.fonts` into `share/fonts/<appId>/` and its launcher exports
// `GJSIFY_FONT_DIR` at the staged directory, because only the launcher knows whether the payload
// became `/usr`, a `--prefix` tree, `/app`, `Contents/Resources` or a Windows program directory.
// This is the side that reads it. It lives in the host layer rather than in each application
// because otherwise every consumer that ships a face writes the same loop (ADR 0038 § "What this
// does NOT decide", and `status/open-todos/README.md`).
//
// WHY THE CALL EXISTS AT ALL, since two of the three operating systems reach the directory without
// it. On LINUX the stock `fonts.conf` finds the staged faces on its own — `<dir>/usr/share/fonts</dir>`
// for a `.deb`/`.rpm`, and `<dir prefix="xdg">fonts</dir>` over the `XDG_DATA_DIRS` the launcher
// sets everywhere else. On MACOS the bundle's `ATSApplicationFontsPath` has the OS activate the
// directory for this app before any of its code runs — and where there is no bundle (`gjsify run`
// on a Homebrew GTK) the call falls back to a fontconfig map (`probeFontconfigMap` in `@gjsify/utils/font-map`). WINDOWS has neither: GTK4 there is
// pangowin32, whose font map is filled exclusively by `pango_win32_dwrite_font_map_populate()`, so
// an application shipping its own face silently gets the DirectWrite system collection instead —
// measured on Windows 11 / GTK 4.22.4, in both directions (ADR 0038 § W1-W5): a `FONTCONFIG_FILE`
// naming the staged directory moves the default font map by zero families even when it is the ONLY
// configuration present, while `add_font_file` on that same map — the one a `Gtk.Label` renders
// through — moves it by one.
//
// The failure this removes is the quiet kind: `pango_font_description_set_family("Brand")` against
// a map with no such family does not throw, does not exit non-zero and writes nothing to stderr.
// Pango substitutes the default sans, the window renders and every test passes.
//
// MEASURED HERE TOO, on Fedora 44 / GJS / Pango 1.57.1 / `PangoCairoFcFontMap`, with an invented
// family as the discriminator so that "it resolved" cannot mean "it was substituted":
// `list_families()` goes 100 → 101 with the staged `Round9x13` present, `get_family` answers it,
// and a 40pt "Wg" layout measures 66x50 px against the 87x63 the invented `ZzzNoSuchFamilyQx`
// gets. Different METRICS, not merely a call that returned true.
//
// CALL IT BEFORE ANY TEXT IS LAID OUT — measured, not stylistic, and the hazard is BACKEND-SPECIFIC
// even though the instruction is not. The fc font map caches the FONTSET it resolved for a
// description and `add_font_file` does not invalidate it, so a `Pango.Layout` that measured the
// family before registration keeps measuring the fallback afterwards (87x63, not 66x50) even
// though `list_families()` now lists it and a freshly created context's `load_font` returns the
// real face: the symptom is not "no font" but a stale MEASUREMENT, which reads as "the font is
// installed and Pango is ignoring it". On win32 `add_font_file` clears the map's cache and emits
// `changed` (ADR 0038), so the same late call is recoverable there. Registering early is therefore
// free on the backend that recovers and load-bearing on the one that does not — which is why the
// rule is stated flatly while `fonts.spec.ts` asserts only the portable half.
//
// AND WHAT A LATE CALLER GETS NOW. `registerFontFaces` takes the reading itself
// (`fontMapServesFamily`) and, where a face is on the map but not served, replaces the default map the
// only way JS can invalidate one — a fresh fontconfig map, which holds no cached answer. So the rule
// above is now about not PAYING for the rescue rather than about correctness: a late call reports
// `fontconfigFallback: true`, and where no fallback is available it reports the face in `unreachable`
// and this function says so. Registering early is still right; what is withdrawn is the claim that
// skipping it renders the wrong typeface for the life of the process with nothing said.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
// The SETTING half needs the toolkit: `gtk-font-name` lives on `Gtk.Settings`, which is the one
// place a GTK program's UI font size can be moved. Pango has no equivalent — its own resolution
// and description APIs describe a layout, not the display's default.
import Gtk from 'gi://Gtk?version=4.0';
import type Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

// THE REGISTRATION HALF IS NOT HERE. Handing a face to a font map, telling a decline from a broken
// file, and falling back to a fontconfig map where the platform one implements no `add_font_file` are
// one mechanism with one owner, and a second caller needed it: `@gjsify/dom-elements`' `FontFace.load()`
// registered a Canvas face on the default map and swallowed the same decline this module rescues
// (ADR 0038 § Amendment 5). It lives in `@gjsify/utils/font-map` — the lowest package both may depend
// on, since this one is tier 3 and `dom-elements` is tier 1 — and the two exports below are RE-EXPORTS
// of it, so `/fonts` keeps the surface it published and a second copy of the fallback does not exist.
import { fontErrorMessage, fontMapFamilies, registerFontFaces, type FontFaceFailure } from '@gjsify/utils/font-map';

import { describeFontFamilyMatch, matchFontFamilies, matchFontFamily, type FontFamilyMatch } from './font-families.js';
import { isFontFace, resolveFontSources, type FontSource, type ResolveFontSourcesOptions } from './font-dir.js';
import {
    ADWAITA_UI_FONT_FAMILY,
    planUiFontPolicy,
    type PlanUiFontOptions,
    type UiFontPlan,
    type UiFontPolicy,
} from './ui-font.js';

// The resolution half of this module's subject, re-exported so a caller that has to ask "what do
// I actually put in `font-family`" reaches it from the same entry point as `initFonts` — there is
// no useful order in which somebody needs one and not the other.
export {
    describeFontFamilyMatch,
    matchFontFamilies,
    matchFontFamily,
    type FontFamilyMatch,
    type FontFamilyMatchKind,
} from './font-families.js';

// The REGISTERING half, re-exported for the same reason and because `/fonts` published it: both
// symbols are DECISIONS about how a font map answers, and a caller holding a file and a map is exactly
// the caller `initFonts` serves. Re-exported rather than re-declared, so the definitions cannot drift
// from the ones `initFonts` runs on. See `@gjsify/utils/font-map` for why they are not local.
export { CAIRO_FONT_TYPE_FT, isUnsupportedByFontMap } from '@gjsify/utils/font-map';
export type { FontFaceFailure } from '@gjsify/utils/font-map';

// The SIZE half, re-exported for the same reason: a caller reaching for "why is my GNOME app 16 %
// small on Windows" and a caller reaching for "which face backs my family" are the same person on
// two different days, and both arrive at this entry point.
export {
    ADWAITA_UI_FONT_FAMILY,
    GNOME_UI_FONT_POINT_SIZE,
    UI_FONT_POLICIES,
    planUiFont,
    planUiFontPolicy,
    type PlanUiFontOptions,
    type PlanUiFontPolicyOptions,
    type UiFontPlan,
    type UiFontPlanKind,
    type UiFontPolicy,
} from './ui-font.js';
export { resolveFontSources, type FontSource, type ResolveFontSourcesOptions } from './font-dir.js';

/**
 * Everything {@link resolveFontSources} takes except the environment, which {@link initFonts}
 * reads.
 */
export interface InitFontsOptions extends Omit<ResolveFontSourcesOptions, 'env'> {
    /**
     * Which {@link UiFontPolicy} to apply to `gtk-font-name`, or nothing at all.
     *
     * DEFAULT: NOTHING. Registering faces and rewriting the user's font setting are two different
     * acts, and only the first is unambiguously this call's business — a runtime that changes a
     * font setting nobody asked it to change is a surprise, and it would also make `system`
     * unreachable in practice, because the host's own value would already have been overwritten
     * before a consumer could choose to keep it. `size` is the RECOMMENDED value for an app
     * shipping a bundled GTK; it is a recommendation in the documentation, not a default here.
     *
     * Passing a policy still captures the baseline first, so switching back to `system` later
     * works. See {@link applyUiFontPolicy}, which is also callable on its own at any time.
     */
    readonly uiFont?: UiFontPolicy | ApplyUiFontPolicyOptions;

    /**
     * The family names this application will ASK FOR — checked against the map once registration
     * is done, and reported in {@link InitFontsResult.matches}.
     *
     * Optional, and the reason to pass it is that nothing downstream can. A `font-family`
     * declaration cannot know which file was supposed to back it, and `list_families()` alone
     * cannot say which of 84 names arrived from the staged directory; this call is the one moment
     * that has both. Every name that does not resolve is WARNED about here, which is the only
     * place a missing family is ever loud — Pango substitutes silently and the window renders.
     */
    readonly expectedFamilies?: readonly string[];
}

/**
 * A {@link FontSource} and the faces IT contributed.
 *
 * WHY THE ATTRIBUTION IS PART OF THE RESULT rather than something a caller re-derives. Since the
 * GTK runtime bundle started carrying the GNOME UI typeface there are TWO sources, and the flat
 * {@link InitFontsResult.registered}, {@link InitFontsResult.declined} and
 * {@link InitFontsResult.failed} lists span both — so "did MY staged face arrive" stopped being
 * answerable from them the day a published bundle gained a face, silently, with no caller
 * changing a line. The loop that hands each file to the font map is the only place that knows
 * which directory it came from; anything downstream is reduced to comparing path prefixes, which
 * is a guess about filesystem layout rather than a measurement.
 *
 * The same argument {@link InitFontsResult.families} makes about the family diff, one field over:
 * only the call that did the work is in a position to take the reading.
 */
export interface FontSourceOutcome extends FontSource {
    /** Faces from THIS directory now on the default font map. */
    readonly registered: readonly string[];
    /** Faces from THIS directory the font map declined — see {@link isUnsupportedByFontMap}. */
    readonly declined: readonly string[];
    /**
     * Faces from THIS directory that are on the map and that no layout can be served by — the map had
     * already resolved their family to the fallback and caches that answer. Disjoint from
     * {@link declined} and a subset of {@link registered}; `FontFaceRegistration.unreachable` in
     * `@gjsify/utils/font-map` owns the reading and the fresh-map fallback that normally clears this
     * list, so a non-empty one means that fallback was unavailable and the substitution is real.
     */
    readonly unreachable: readonly string[];
    /** Faces from THIS directory that failed otherwise, plus the directory itself if unreadable. */
    readonly failed: readonly FontFaceFailure[];
}

/** What {@link initFonts} did, so a caller that cares can assert on it. */
export interface InitFontsResult {
    /**
     * The APPLICATION's font directory that was read, or `undefined` when nothing named one.
     *
     * Unchanged in meaning since before the runtime bundle had faces of its own, which is why
     * it is still singular: a caller asserting "my staged face was found" must not start
     * answering `true` because the platform's were. {@link sources} is the full list.
     */
    readonly dir: string | undefined;
    /**
     * Every directory registered, runtime first, and what each one contributed.
     *
     * THE ONLY PLACE A FACE IS ATTRIBUTED TO A DIRECTORY. Read this, not the flat lists below,
     * whenever the question is about ONE source — "did the face I staged arrive", "did the
     * runtime bundle bring its own" — because the flat lists answer for all of them at once and
     * their counts move whenever a published bundle changes what it carries. See
     * {@link FontSourceOutcome}.
     */
    readonly sources: readonly FontSourceOutcome[];
    /**
     * What the UI-font-size policy did, or `undefined` when it did not run.
     *
     * `undefined` is the ordinary answer on Linux: no runtime bundle names a font directory
     * there, so the default leaves `gtk-font-name` alone entirely.
     */
    readonly uiFont: UiFontPlan | undefined;
    /** Faces now on the default font map, ACROSS EVERY {@link sources} entry. */
    readonly registered: readonly string[];
    /**
     * Faces the font map declined as unsupported, across every {@link sources} entry — see
     * {@link isUnsupportedByFontMap}.
     */
    readonly declined: readonly string[];
    /**
     * Faces that are on the map and that no layout can be served by, across every {@link sources}
     * entry: the map resolved their family to the fallback before the face arrived and caches that
     * answer, so registering the face changed `list_families()` and nothing else. A SUBSET of
     * {@link registered} — the face really is on the map and `get_family` answers its family — which
     * is why it is reported beside the flat lists rather than inside them.
     *
     * EMPTY wherever the fontconfig fallback took over, which is the whole point of it: then a fresh
     * map serves the faces and there is nothing left to say. Non-empty means that fallback was
     * unavailable (`PANGOCAIRO_BACKEND` pinned, no fontconfig configuration, no fc backend) and the
     * substitution will happen whatever the application does next.
     */
    readonly unreachable: readonly string[];
    /**
     * Faces that failed for any other reason, across every {@link sources} entry. Each was warned
     * about; none threw.
     */
    readonly failed: readonly FontFaceFailure[];
    /**
     * The family names the default font map GAINED across this call, sorted.
     *
     * THE FIELD #1542 IS ABOUT, and the reason it is a diff rather than a list: a caller can act
     * only on a family NAME, the name is not derivable from the file, and no caller can take this
     * measurement afterwards — `list_families()` alone cannot say which of 84 names arrived from
     * the staged directory. Only the call that registered them is in a position to know.
     *
     * NOT a file → family map, and that is a limit rather than a shortcut: Pango exposes no link
     * from a registered file back to the family it produced, and attributing families by
     * registering one file at a time would credit a family to whichever of its faces happened to
     * be registered first — five staged faces of two families would report three files as having
     * contributed nothing, which reads exactly like three failures.
     *
     * EMPTY IS NOT FAILURE, on two live paths: a map that declines runtime registration (macOS,
     * where a shipped `.app` has already activated the directory through
     * `ATSApplicationFontsPath` before any code runs) gains nothing here and is CORRECT, and a
     * face whose family the map already holds adds no new name. {@link matches} is what tells
     * those apart from nothing having worked, because it asks what the map holds NOW.
     */
    readonly families: readonly string[];
    /**
     * What each of {@link InitFontsOptions.expectedFamilies} resolves to on the map, in the order
     * declared. Empty when the caller declared none.
     *
     * This is the answer to the darwin row of #1542, where `declined: 5` is consistent BOTH with
     * everything working and with nothing working: the only thing that separates the two is what
     * the map holds afterwards, which is what a match reads.
     */
    readonly matches: readonly FontFamilyMatch[];
    /**
     * `true` when this call REPLACED the process's default font map with a fontconfig-backed one
     * so the faces could be registered at all — see `probeFontconfigMap` in `@gjsify/utils/font-map`.
     *
     * Reported because it is a whole-application consequence of one call: every widget created
     * afterwards renders through FreeType instead of the platform rasteriser. It happens only
     * where the default map DECLINED registration (a CoreText map — `gjsify run` on a Homebrew
     * GTK), the faces brought a family that map does not already hold, fontconfig has a
     * configuration of its own, and nobody pinned `PANGOCAIRO_BACKEND` (ADR 0038 § Amendment 5).
     */
    readonly fontconfigFallback: boolean;
}

/** Attributes the walk needs, and no more — a name and a type per entry. */
const ENUMERATE_ATTRIBUTES = 'standard::name,standard::type';

/**
 * Register every face in the application's shipped font directory with the default font map.
 *
 * Call it once at startup, and BEFORE any text is laid out — that ordering is load-bearing on the
 * fontconfig backend rather than tidiness: it caches the FONTSET resolved for a description and
 * `add_font_file` does not invalidate it, so a `Pango.Layout` that measured the family first keeps
 * measuring the fallback for the life of the process even though the family is then in
 * `list_families()`. win32 clears its cache instead and recovers, so registering early is free there
 * and unrecoverable-if-missed on Linux (measured both ways; `fonts.spec.ts`). Calling it late is no
 * longer SILENTLY wrong, though: `registerFontFaces` measures what it registered, replaces the default
 * map when a face turned out to be unserved, and reports what it could not rescue in
 * {@link InitFontsResult.unreachable} — see the file header for what that leaves of the rule.
 *
 * Nothing here is eager: this
 * package is the element model renderers bind to and owns no application lifecycle, and a
 * module-load side effect would decide an application's initialisation order invisibly — the same
 * reason `gjsify ship` stages the faces and names the directory instead of injecting the call.
 *
 * Total, like `installDevtools`: a face that will not open costs one stderr line and appears in
 * {@link InitFontsResult.failed}, never an exception. Taking an application down over a decorative
 * face would be worse than rendering it in a fallback — but doing so SILENTLY is the defect this
 * exists against, so it is loud and it is reported.
 *
 * Safe to call when the application ships no faces: `GJSIFY_FONT_DIR` is exported only when
 * `gjsify ship` staged one, so an unset variable is the ordinary case and does nothing quietly.
 */
export function initFonts(options: InitFontsOptions = {}): InitFontsResult {
    const requested = resolveFontSources({
        ...options,
        env: {
            GJSIFY_FONT_DIR: GLib.getenv('GJSIFY_FONT_DIR') ?? undefined,
            GJSIFY_GTK_RUNTIME_FONT_DIR: GLib.getenv('GJSIFY_GTK_RUNTIME_FONT_DIR') ?? undefined,
        },
    });
    const dir = requested.find((source) => source.origin === 'app')?.dir;

    const sources: FontSourceOutcome[] = [];
    const registered: string[] = [];
    const declined: string[] = [];
    const unreachable: string[] = [];
    const failed: FontFaceFailure[] = [];
    const expected = options.expectedFamilies ?? [];

    // Nothing staged and nothing asked about: answer without touching Pango at all. Reading the
    // default font map INSTANTIATES it, and an application that ships no faces and names no family
    // must not pay for that — neither variable is set unless something actually staged a
    // directory, so this is the ordinary case and the one this call promises to pass through
    // quietly.
    //
    // The condition is `expectedFamilies` as well as the sources, not the sources alone: "is the
    // family this application asks for actually here" is a fair question even when nothing was
    // staged, which is the macOS shape — a shipped `.app` had the OS activate the directory
    // declaratively, before any of this ran.
    if (requested.length === 0 && expected.length === 0) {
        return {
            dir,
            sources,
            uiFont: undefined,
            registered,
            declined,
            unreachable,
            failed,
            families: [],
            matches: [],
            fontconfigFallback: false,
        };
    }

    // The BEFORE half of the diff, taken only when there is something to register: a family list
    // is a walk over every family the map knows, and with no directory there is nothing to
    // attribute to this call anyway. `registerFontFaces` reports the BEFORE of ITS map, which is this
    // one until a fallback replaces it — and the replacement carries its own, because the diff has to
    // be taken on the map that ends up in force or every family the two backends merely SPELL
    // differently would be credited to this call.
    let before: readonly string[] = [];
    let fontMap: Pango.FontMap = PangoCairo.FontMap.get_default();

    // Per source, then concatenated — the flat lists are the SUM and the per-source lists are the
    // attribution, and the sum cannot be split back up afterwards without guessing at path
    // prefixes. See {@link FontSourceOutcome}.
    const outcomes = requested.map((source) => ({
        source,
        registered: [] as string[],
        declined: [] as string[],
        unreachable: [] as string[],
        failed: [] as FontFaceFailure[],
    }));

    // Whether a fallback happened is a property of the PROCESS rather than of one source: the swap
    // happens on the first source whose faces the platform map declines, and every source after it
    // registers on the map that replaced it. `some`, not `every` — and not "the last one", which
    // answers `false` for the two-source shape the runtime bundle plus an application directory make.
    let fontconfigFallback = false;

    for (const outcome of outcomes) {
        const faces: string[] = [];
        collectFaces(Gio.File.new_for_path(outcome.source.dir), faces, outcome.failed);

        // ONE CALL PER SOURCE, threading the map forward, so a source's faces are accounted to that
        // source — and so a fontconfig fallback a source triggers is the map the NEXT source registers
        // on. That is the whole of the ordering, and it is what ADR 0038 § Amendment 5 measured: a
        // CoreText map declines every face (a shipped `.app` does not care, because
        // `ATSApplicationFontsPath` activated them before this ran — but `gjsify run` on a Homebrew GTK
        // has no bundle and no `Info.plist`, so there the faces would reach nothing at all).
        const registration = registerFontFaces(faces.sort(), fontMap);
        if (before.length === 0 || registration.fontconfigFallback) before = registration.before;
        if (registration.fontconfigFallback) fontconfigFallback = true;
        if (registration.map !== undefined) fontMap = registration.map;
        outcome.registered.push(...registration.registered);
        outcome.declined.push(...registration.declined);
        outcome.unreachable.push(...registration.unreachable);
        outcome.failed.push(...registration.failed);
    }

    for (const outcome of outcomes) {
        registered.push(...outcome.registered);
        declined.push(...outcome.declined);
        unreachable.push(...outcome.unreachable);
        failed.push(...outcome.failed);
        sources.push({
            ...outcome.source,
            registered: outcome.registered,
            declined: outcome.declined,
            unreachable: outcome.unreachable,
            failed: outcome.failed,
        });
    }

    // AFTER, and it is read once for both questions. `families` is what this call added;
    // `matches` is what the caller's own names resolve to on the map as it now stands — which is
    // deliberately NOT restricted to the diff, because a family the platform activated
    // declaratively is on the map and did not arrive here.
    //
    // The diff is taken ONLY where a BEFORE was taken, and the guard is load-bearing rather than
    // tidy: with no font directory named there is no `before`, so subtracting an empty list from
    // a live one would report every family on the host as having been added by a call that
    // registered nothing — a field whose whole purpose is to say what THIS call contributed.
    const after = fontMapFamilies(fontMap);
    const families = requested.length === 0 ? [] : after.filter((name) => !before.includes(name)).sort();
    const matches = matchFontFamilies(expected, after);

    // THE SETTING, after the faces. Registering a typeface and rewriting `gtk-font-name` are two
    // different acts and only the first is unambiguously this call's business, so nothing happens
    // here unless a policy was asked for — see `InitFontsOptions.uiFont`.
    //
    // The BASELINE is captured either way, and that is the load-bearing half: it is the only
    // moment this process is guaranteed to see the host's own value before anything overwrites
    // it, and `system` is not expressible afterwards. Capturing costs one property read.
    captureUiFontBaseline();
    const uiFont = options.uiFont === undefined ? undefined : applyUiFontPolicy(options.uiFont);

    for (const failure of failed) {
        console.warn(
            `initFonts: ${failure.path} could not be read as an application font (${failure.message}). ` +
                'Text asking for a family this application ships will render in a substituted one.',
        );
    }

    // THE OTHER SILENT SUBSTITUTION, and the one that renders a window in the RIGHT family name and
    // the WRONG typeface: the font map holds the family — `matches` below will call it `exact`, and
    // #1542's diff will list it — while every layout keeps measuring the fallback, because the map had
    // already resolved that family before the face arrived and caches the answer. Reported here rather
    // than left to `matches`, which cannot see it by construction. Where the fontconfig fallback took
    // over this list is empty, so what is being said here is that no map in this process can serve the
    // face at all.
    for (const path of unreachable) {
        console.warn(
            `initFonts: ${path} is registered and its family is on the font map, but text asking for it ` +
                'will still render substituted: the font map had already resolved that family to the ' +
                'fallback and the cached answer cannot be invalidated. Call initFonts() before any text ' +
                'is laid out.',
        );
    }

    // The loud line #1542 asked for, and the reason it is a warning rather than a throw: the
    // report `registered: 5, declined: 0, failed: 0` was ACCURATE while the declared family was
    // absent from the map and Pango substituted Tahoma. A result that says nothing failed while
    // the font is unusable is worse than no result. `optical` is warned about too — it is the
    // case that renders a window and is still wrong, because the name the application wrote
    // resolves to nothing.
    for (const match of matches) {
        if (match.kind === 'exact') continue;
        console.warn(`initFonts: ${describeFontFamilyMatch(match)}`);
    }

    return {
        dir,
        sources,
        uiFont,
        registered,
        declined,
        unreachable,
        failed,
        families,
        matches,
        fontconfigFallback,
    };
}

/** Everything {@link planUiFontPolicy} takes except what this module supplies itself. */
export interface ApplyUiFontPolicyOptions extends PlanUiFontOptions {
    readonly policy: UiFontPolicy;
    /**
     * The settings object to act on. Defaults to `Gtk.Settings.get_default()`.
     *
     * A seam, not a knob: the null arm below is the one a real consumer hit, and on a host with a
     * display there is no way to reach it through the default — `get_default()` never answers null
     * once GTK is up. Passing `null` explicitly is how the test for it exists at all.
     */
    readonly settings?: Gtk.Settings | null;
}

// THE BASELINE: `gtk-font-name` as this process first saw it.
//
// Module-level, captured once, never overwritten — because after the first write the host's own
// value is gone. GTK keeps no previous value, Windows has no GSettings to re-read, and on Linux
// the setting a session actually applied may itself be an override of the schema default, so a
// "restore" that read the schema would put back something the user never had. The only correct
// source is what was observed BEFORE anyone wrote, which means capturing is a separate act from
// applying and has to happen first.
//
// `undefined` after capture is a real answer (a host whose `gtk-font-name` is unset), which is
// why the flag is separate from the value rather than encoded as "undefined means uncaptured".
let baselineCaptured = false;
let baselineValue: string | undefined;

/**
 * Record `gtk-font-name` as it stands, if it has not been recorded yet. Idempotent.
 *
 * Safe before `Gtk.init()`: `Gtk.Settings.get_default()` answers null there and nothing is
 * captured, so a later call still gets the first REAL value rather than pinning a null.
 */
function captureUiFontBaseline(): string | undefined {
    if (baselineCaptured) return baselineValue;
    const settings = Gtk.Settings.get_default();
    if (settings === null) return undefined;
    baselineValue = settings.gtk_font_name ?? undefined;
    baselineCaptured = true;
    return baselineValue;
}

/**
 * `gtk-font-name` as this process first found it — what the `system` policy restores.
 *
 * READING IT CAPTURES IT, which is the point: the value is only correct if it is taken before
 * anything writes. A consumer that wants to show the host's own font in a preferences dialog
 * therefore gets the right answer by asking early, and `initFonts()` asks at startup.
 *
 * `undefined` means either "not captured yet, and the toolkit is not initialised" or "this host's
 * `gtk-font-name` is genuinely unset". Both lead to the same correct behaviour under `system`:
 * leave the setting alone.
 */
export function uiFontBaseline(): string | undefined {
    return captureUiFontBaseline();
}

/**
 * Apply one of the three {@link UiFontPolicy} states to `gtk-font-name`.
 *
 * The writing half of `ui-font.ts`, and the function a preferences dialog calls when the user
 * changes the setting — including the way BACK: `system` restores the baseline this module
 * captured before the first write, which is why switching `adwaita` → `system` at runtime
 * returns the host's own `Segoe UI 9` rather than an approximation of it.
 *
 * `Gtk.Settings.get_default()` answers null before `Gtk.init()`. That is not an error to throw
 * over — a program may register its faces before it initialises the toolkit — but it is NOT the
 * same answer as "the policy ran and had nothing to do", and reporting it as `unparsed` said it
 * was. A consumer that called this at module scope got a plan indistinguishable from a host that
 * needed no correction, so its setting silently did nothing: measured in Learn6502 0.8.0, where
 * `ui-font: policy=size -> unparsed (unchanged)` was printed on macOS and on Windows — the one
 * platform whose 16 px against GNOME's 19 is the reason the policy exists. It now reports
 * `uninitialised` and says so once, because a caller that is too early can only find out from
 * here.
 */
export function applyUiFontPolicy(request: UiFontPolicy | ApplyUiFontPolicyOptions): UiFontPlan {
    const options: ApplyUiFontPolicyOptions = typeof request === 'string' ? { policy: request } : request;
    const settings = options.settings === undefined ? Gtk.Settings.get_default() : options.settings;
    if (settings === null) {
        console.warn(
            'applyUiFontPolicy: no Gtk.Settings — the toolkit is not initialised yet, so the ' +
                "policy was NOT applied. Call this after Gtk.init() (or from an application's " +
                '`startup`), which is still before any window is built.',
        );
        return { next: undefined, kind: 'uninitialised', family: undefined, size: undefined };
    }
    // BEFORE the read of `current`, so the very first call through this function still records
    // the host's own value even when it is about to overwrite it.
    const baseline = captureUiFontBaseline();
    const plan = planUiFontPolicy({
        ...options,
        family: options.family ?? resolvedAdwaitaFamily(options.policy),
        current: settings.gtk_font_name ?? undefined,
        baseline,
    });
    if (plan.next === undefined) return plan;
    settings.gtk_font_name = plan.next;
    return plan;
}

/**
 * WHICH NAME TO ASK FOR when the policy is `adwaita` — resolved against the live font map, not
 * taken from the declared constant.
 *
 * MEASURED, and it is the reason this function exists at all: `Adwaita Sans` is a variable font
 * with an `opsz` axis whose value at 14 is named `Text`, so fontconfig puts `Adwaita Sans` on the
 * map and gvsbuild's DirectWrite reader puts `Adwaita Sans Text`. Writing the declared name on
 * Windows therefore asks for a family that host does not have, Pango substitutes Tahoma, and a
 * user who chose "use the Adwaita font" gets the very substitution the policy was picked to
 * avoid — silently, because a missing family is not an error.
 *
 * `absent` falls back to the declared name AND says so. Refusing would be worse: the consumer
 * asked for this state explicitly, and it was told to check {@link adwaitaUiFontAvailability}
 * first. What it must not do is fail quietly.
 */
function resolvedAdwaitaFamily(policy: UiFontPolicy): string | undefined {
    if (policy !== 'adwaita') return undefined;
    const availability = adwaitaUiFontAvailability();
    if (availability.match.family !== undefined) return availability.match.family;
    console.warn(
        `applyUiFontPolicy: "${availability.family}" is ${availability.match.kind} on this font map, so asking for ` +
            "it will render in a substituted family. Register the runtime bundle's faces with initFonts() first, " +
            'and check adwaitaUiFontAvailability() before offering this policy.',
    );
    return undefined;
}

/**
 * Can this process offer the `adwaita` policy at all — is the GNOME face on the font map?
 *
 * THE QUESTION A PREFERENCES DIALOG HAS TO ASK BEFORE IT OFFERS THE OPTION. Forcing
 * `Adwaita Sans 11` on a host where that family never arrived — an old bundle, a system GTK with
 * no adwaita-fonts package — does not fail: Pango substitutes, and the user who picked "use the
 * Adwaita font" gets Tahoma. That is one substitution traded for another, with a setting that
 * now lies about what it did.
 *
 * Answered as a {@link FontFamilyMatch} rather than a boolean because `optical` is a real third
 * state, measured on Windows: a family can be on the map under a decorated name (`Merriweather
 * 18pt`), in which case the honest thing is to ask for THAT name — `match.family` — rather than
 * to report the face as missing. `available` is the convenience for the common case.
 *
 * Call it AFTER `initFonts()`, which is what puts the bundled faces on the map.
 */
export function adwaitaUiFontAvailability(family: string = ADWAITA_UI_FONT_FAMILY): UiFontAvailability {
    const match = matchFontFamily(family, fontMapFamilies(PangoCairo.FontMap.get_default()));
    return { family, match, available: match.kind !== 'absent' };
}

/** What {@link adwaitaUiFontAvailability} answers. */
export interface UiFontAvailability {
    /** The family that was asked about. */
    readonly family: string;
    /** How it resolves on the font map as it now stands. */
    readonly match: FontFamilyMatch;
    /** `false` when the family is absent, i.e. the `adwaita` policy would substitute. */
    readonly available: boolean;
}

/**
 * Collect the faces under `dir`, depth-first.
 *
 * Recursive because the WRITER is: `discoverFonts` walks the configured tree, so a project whose
 * `data/fonts` has subdirectories ships faces this must find when it is pointed at that tree
 * directly. The staged tree itself is flat — `planFonts` keys every face by its basename under the
 * app id — so in a shipped payload this recurses over nothing.
 */
function collectFaces(dir: Gio.File, out: string[], failed: FontFaceFailure[]): void {
    try {
        // NOFOLLOW_SYMLINKS: a symlink then reports as `SYMBOLIC_LINK` rather than as whatever it
        // points at, which both bounds the walk against a loop and matches the writer, whose
        // `listFilesRecursive` REFUSES a symlink outright ("the payload has to be self-contained").
        const children = dir.enumerate_children(ENUMERATE_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let info = children.next_file(null); info !== null; info = children.next_file(null)) {
            const child = children.get_child(info);
            const path = child.get_path();
            // Null only for a non-native (URI-backed) `GFile`. This walk is rooted at a local path
            // so the branch is unreachable today; narrowed rather than asserted so that a future
            // URI root degrades to "no faces found" instead of putting `null` into `add_font_file`.
            if (path === null) continue;
            if (info.get_file_type() === Gio.FileType.DIRECTORY) collectFaces(child, out, failed);
            else if (isFontFace(info.get_name())) out.push(path);
        }
    } catch (error) {
        // `enumerate_children` and `next_file` are both `throws="1"`, and this is their live path:
        // the launcher exports `GJSIFY_FONT_DIR` only when it actually staged a face, so a
        // directory that cannot be read is a payload promising faces it did not deliver. Reported
        // rather than swallowed, for the reason the whole mechanism exists — the alternative is an
        // application that renders in the wrong typeface and says nothing.
        failed.push({ path: dir.get_path() ?? '', message: fontErrorMessage(error) });
    }
}
