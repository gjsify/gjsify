// REGISTERING an application's own faces — the reading half of ADR 0038.
//
// `gjsify ship` stages `gjsify.ship.fonts` into `share/fonts/<appId>/` and its launcher exports
// `GJSIFY_FONT_DIR` at the staged directory, because only the launcher knows whether the payload
// became `/usr`, a `--prefix` tree, `/app`, `Contents/Resources` or a Windows program directory.
// This is the side that reads it. It lives in the host layer rather than in each application
// because otherwise every consumer that ships a face writes the same loop (ADR 0038 § "What this
// does NOT decide", and `status/open-todos.md`).
//
// WHY THE CALL EXISTS AT ALL, since two of the three operating systems reach the directory without
// it. On LINUX the stock `fonts.conf` finds the staged faces on its own — `<dir>/usr/share/fonts</dir>`
// for a `.deb`/`.rpm`, and `<dir prefix="xdg">fonts</dir>` over the `XDG_DATA_DIRS` the launcher
// sets everywhere else. On MACOS the bundle's `ATSApplicationFontsPath` has the OS activate the
// directory for this app before any of its code runs. WINDOWS has neither: GTK4 there is
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

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
// The SETTING half needs the toolkit: `gtk-font-name` lives on `Gtk.Settings`, which is the one
// place a GTK program's UI font size can be moved. Pango has no equivalent — its own resolution
// and description APIs describe a layout, not the display's default.
import Gtk from 'gi://Gtk?version=4.0';
import type Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

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

/** A face the font map would not take, and why. */
export interface FontFaceFailure {
    readonly path: string;
    readonly message: string;
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
    /** Every directory registered, runtime first. See {@link FontSource}. */
    readonly sources: readonly FontSource[];
    /**
     * What the UI-font-size policy did, or `undefined` when it did not run.
     *
     * `undefined` is the ordinary answer on Linux: no runtime bundle names a font directory
     * there, so the default leaves `gtk-font-name` alone entirely.
     */
    readonly uiFont: UiFontPlan | undefined;
    /** Faces now on the default font map. */
    readonly registered: readonly string[];
    /** Faces the font map declined as unsupported — see {@link isUnsupportedByFontMap}. */
    readonly declined: readonly string[];
    /** Faces that failed for any other reason. Each was warned about; none threw. */
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
}

/** Attributes the walk needs, and no more — a name and a type per entry. */
const ENUMERATE_ATTRIBUTES = 'standard::name,standard::type';

/**
 * Did the font map decline runtime registration outright?
 *
 * `pango_font_map_add_font_file()` is a vfunc, and the CoreText map implements none — so on macOS
 * the call falls through to the base implementation, which answers `G_IO_ERROR_NOT_SUPPORTED`.
 * That is not a failure to report: macOS is already correct declaratively, because the bundle's
 * `ATSApplicationFontsPath` had the OS activate the staged directory before the process started,
 * and the ordering makes the runtime call the wrong tool there rather than merely a redundant one
 * — `pango_core_text_font_map_changed()` only bumps a serial, there is no
 * `kCTFontManagerRegisteredFontsChangedNotification` observer and no re-scan path in
 * `pangocoretext-fontmap.c`, so a face registered after the map initialises could not be recovered
 * by poking it anyway.
 *
 * Keyed on the ERROR rather than on `process.platform`, which is the difference between a
 * capability test and a guess about who is asking. It costs no `gjsify.os` declaration (this
 * package makes no OS decision, and ADR 0018's candidate set is derived from the code that reads
 * the host), it stays right if a fontconfig-backed Pango is ever selected on darwin — the backend
 * is chosen by what is compiled in, not per platform, and `PANGOCAIRO_BACKEND=fc` selects one — and
 * it stays right for any other map that declines. The OS name was never the thing being asked.
 */
export function isUnsupportedByFontMap(error: unknown): boolean {
    return error instanceof GLib.Error && error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_SUPPORTED);
}

/**
 * Register every face in the application's shipped font directory with the default font map.
 *
 * Call it once at startup, and BEFORE any text is laid out — that ordering is load-bearing on the
 * fontconfig backend rather than tidiness: it caches the FONTSET resolved for a description and
 * `add_font_file` does not invalidate it, so a `Pango.Layout` that measured the family first keeps
 * measuring the fallback for the life of the process even though the family is then in
 * `list_families()`. win32 clears its cache instead and recovers, so registering early is free
 * there and unrecoverable-if-missed on Linux (measured both ways; `fonts.spec.ts`).
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
    const sources = resolveFontSources({
        ...options,
        env: {
            GJSIFY_FONT_DIR: GLib.getenv('GJSIFY_FONT_DIR') ?? undefined,
            GJSIFY_GTK_RUNTIME_FONT_DIR: GLib.getenv('GJSIFY_GTK_RUNTIME_FONT_DIR') ?? undefined,
        },
    });
    const dir = sources.find((source) => source.origin === 'app')?.dir;

    const registered: string[] = [];
    const declined: string[] = [];
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
    if (sources.length === 0 && expected.length === 0) {
        return { dir, sources, uiFont: undefined, registered, declined, failed, families: [], matches: [] };
    }

    const fontMap = PangoCairo.FontMap.get_default();

    // The BEFORE half of the diff, taken only when there is something to register: a family list
    // is a walk over every family the map knows, and with no directory there is nothing to
    // attribute to this call anyway.
    const before = sources.length === 0 ? [] : familyNames(fontMap);

    for (const source of sources) {
        const faces: string[] = [];
        collectFaces(Gio.File.new_for_path(source.dir), faces, failed);

        for (const path of faces.sort()) {
            try {
                fontMap.add_font_file(path);
                registered.push(path);
            } catch (error) {
                // `add_font_file` is `throws="1"` in `Pango-1.0.gir` (since 1.56), and both arms
                // are live: a map that does no runtime registration answers NOT_SUPPORTED, and a
                // file that FreeType cannot open answers something else.
                if (isUnsupportedByFontMap(error)) {
                    declined.push(path);
                    continue;
                }
                failed.push({ path, message: messageOf(error) });
            }
        }
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
    const after = familyNames(fontMap);
    const families = sources.length === 0 ? [] : after.filter((name) => !before.includes(name)).sort();
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

    return { dir, sources, uiFont, registered, declined, failed, families, matches };
}

/** Everything {@link planUiFontPolicy} takes except what this module supplies itself. */
export interface ApplyUiFontPolicyOptions extends PlanUiFontOptions {
    readonly policy: UiFontPolicy;
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
 * `Gtk.Settings.get_default()` answers null before `Gtk.init()`, and that is a legitimate state
 * rather than an error: a program may register its faces before it initialises the toolkit. It
 * reports `unparsed` — the arm that already means "nothing to act on, so nothing changed" —
 * instead of throwing a caller out of a font call over a setting.
 */
export function applyUiFontPolicy(request: UiFontPolicy | ApplyUiFontPolicyOptions): UiFontPlan {
    const options: ApplyUiFontPolicyOptions = typeof request === 'string' ? { policy: request } : request;
    const settings = Gtk.Settings.get_default();
    if (settings === null) {
        return { next: undefined, kind: 'unparsed', family: undefined, size: undefined };
    }
    // BEFORE the read of `current`, so the very first call through this function still records
    // the host's own value even when it is about to overwrite it.
    const baseline = captureUiFontBaseline();
    const plan = planUiFontPolicy({ ...options, current: settings.gtk_font_name ?? undefined, baseline });
    if (plan.next === undefined) return plan;
    settings.gtk_font_name = plan.next;
    return plan;
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
    const match = matchFontFamily(family, familyNames(PangoCairo.FontMap.get_default()));
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
 * The family names a font map currently holds.
 *
 * Typed `Pango.FontMap` and not `PangoCairo.FontMap`, which is what the caller has:
 * `pango_cairo_font_map_get_default()` is declared to RETURN the base type, and the four members
 * the cairo subtype adds are ones this walk has no use for. Narrowing the parameter to the
 * subtype makes the one live call site a type error.
 */
function familyNames(fontMap: Pango.FontMap): string[] {
    return fontMap.list_families().map((family) => family.get_name());
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
        failed.push({ path: dir.get_path() ?? '', message: messageOf(error) });
    }
}

function messageOf(error: unknown): string {
    // `GLib.Error` is NOT `instanceof Error` under GJS — measured on gjs 1.88.1, where
    // `GLib.Error.new_literal(…) instanceof Error` is `false`. A plain `instanceof Error` narrowing
    // therefore misses EXACTLY the errors this module sees, and every diagnostic it prints would
    // silently degrade to `String(error)` while the tests, which assert on the path, stayed green.
    if (error instanceof GLib.Error) return error.message;
    return error instanceof Error ? error.message : String(error);
}
