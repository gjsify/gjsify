// REGISTERING a face on the Pango font map, and the ONE fallback for a map that will not take it.
//
// WHY THIS IS A SHARED MODULE AND NOT A HELPER IN ITS FIRST CALLER. `pango_font_map_add_font_file()`
// is a VFunc, so a map may simply not implement it: the CoreText map answers
// `G_IO_ERROR_NOT_SUPPORTED`, and the faces then reach nothing at all — Pango substitutes the default
// sans, nothing is printed and no test fails. Two packages here hand faces to that map and both need
// the same answer to "the map declined": `@gjsify/gtk-host`'s `initFonts()` (an application's own
// shipped faces, ADR 0038) and `@gjsify/dom-elements`' `FontFace.load()` (the face a Canvas registers
// at runtime). The first grew the whole fallback in § Amendment 5 and the second kept calling
// `add_font_file` on the default map and swallowing the decline, so a Canvas `FontFace` under
// `gjsify run` on macOS rendered in the fallback sans. A second copy is the shape AGENTS.md calls
// "duplication instead of a helper": the drifted copy fails in a CONSUMER while the owning package
// stays green.
//
// It lives here because this is the LOWEST package both can depend on. `@gjsify/dom-elements` is tier
// 1 and `@gjsify/gtk-host` is tier 3, and a tier may only point at the same or a lower one, so the
// shared half cannot sit in either; `@gjsify/utils` is tier 1, is already depended on by a dozen
// packages, and is what the repo's own rule names for "extract only when a 2nd package needs it". It
// is a SUBPATH because it statically binds `gi://PangoCairo` and the rest of this package must keep
// loading where Pango does not exist.
//
// WHAT THE FALLBACK IS, IN ONE PARAGRAPH. Where the map declines, build a fontconfig-backed map
// (`pango_cairo_font_map_new_for_font_type(CAIRO_FONT_TYPE_FT)`), register the declined faces on it
// and make it the process default with `pango_cairo_font_map_set_default()` — the map
// `gtk_widget_get_font_map()` falls back to. ONLY when all of: `PANGOCAIRO_BACKEND` is unset
// (somebody chose the backend), this pango can build an fc map, that map has families of its own
// (fontconfig found a configuration), and the faces bring a family the platform map does NOT already
// hold (in a shipped `.app`, `ATSApplicationFontsPath` activated the directory before any code ran,
// so there is nothing to rescue). Every condition keeps a case that already worked unchanged.
// ADR 0038 § Amendment 5, measured on macOS 27 arm64.
//
// THE SECOND FACE OF IT, and the one that turned CI red on a Linux-only condition. A DECLINE is not
// the only way a face reaches nothing: a map that TAKES a file can still not serve it. The fc font
// map caches the resolution it arrived at for a description, and `add_font_file` does not invalidate
// that cache — so a family that was asked for BEFORE the face arrived keeps measuring the fallback
// for the life of the map, while `get_family` answers it and a fresh context's `load_font` hands back
// the real face. Measured numbers and the readings that lie, in {@link fontMapServesFamily}. A face
// accepted and then not served is the same defect as one declined, so it takes the same route: the
// remedy is the only invalidation JS has, a FRESH map of the same backend, which has no such entry.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';
// A VALUE import where the subpath used a type-only one, for {@link layoutSize}. No new namespace
// reaches the process: `PangoCairo`'s own typelib imports `Pango-1.0`, so anywhere this subpath
// loads, that one loads.
import Pango from 'gi://Pango?version=1.0';

/**
 * `CAIRO_FONT_TYPE_FT` from `cairo.h` — the value `pango_cairo_font_map_new_for_font_type()` maps to
 * its fontconfig backend.
 *
 * A literal rather than `gi://cairo`'s `FontType.FT`: the enum is part of cairo's ABI, so importing a
 * fourth namespace to spell one stable integer would add a load-time dependency for nothing.
 */
export const CAIRO_FONT_TYPE_FT = 1;

/** A face the font map would not take, and why. */
export interface FontFaceFailure {
    readonly path: string;
    readonly message: string;
}

/** What one {@link registerFontFaces} call did. */
export interface FontFaceRegistration {
    /**
     * `false` where there is no Pango font map to register anything on at all — a `--app browser`
     * bundle empties `gi://` (`plugins/gjs-imports-empty.ts`), and there a browser's OWN font
     * machinery is what resolves a `FontFace`.
     *
     * Reported rather than left to be inferred from an empty outcome, because the two must not be
     * reported alike: nothing was DECLINED on a browser, and a caller warning about a decline there
     * would print a font warning per face in every web app.
     */
    readonly available: boolean;
    /**
     * The map in force afterwards — the adopted fontconfig one where the fallback ran, the `map` that
     * was passed in otherwise. `undefined` when {@link available} is `false`.
     *
     * A caller registering more than one batch MUST thread this forward: after a swap the process
     * default is the fontconfig map, and only this value knows.
     */
    readonly map: Pango.FontMap | undefined;
    /**
     * The family names the registering map held before any face was added — the BEFORE of a family
     * diff. On the fallback path this is the CANDIDATE's list, because the diff has to be taken on
     * the map that ends up in force or every family the two backends merely SPELL differently would
     * be credited to this call.
     */
    readonly before: readonly string[];
    /** Faces now on the map. */
    readonly registered: readonly string[];
    /**
     * Faces no map here would take — see {@link isUnsupportedByFontMap}. A face in a shipped `.app`
     * lands here and is CORRECT: the OS activated the directory before the process started.
     */
    readonly declined: readonly string[];
    /**
     * Faces this call put on the map that no layout can be served by — registered, `get_family`
     * answers the family, and text asking for it still measures the fallback. A SUBSET of
     * {@link registered}, and disjoint from {@link declined}.
     *
     * ITS OWN FIELD rather than a third bucket beside the two above, and the difference is what
     * happened to the map. `declined` is a map that would not TAKE the face, which for a shipped
     * `.app` is the correct outcome; a face here was TAKEN and then could not SERVE it. A caller
     * reading `declined` tells its user that no font map would take this file and points at
     * `ATSApplicationFontsPath` and `initFonts()` — advice that is wrong here, because the face is
     * already on the map and re-running a registration cannot help. That is why the distinction is
     * data rather than a comment: one is silent and correct, the other is loud and necessary, and
     * a caller cannot tell them apart without laying text out itself.
     *
     * EMPTY where the fontconfig fallback took over, which is the whole point of it: then the faces
     * render and there is nothing left to report.
     */
    readonly unreachable: readonly string[];
    /** Faces that failed for any other reason, plus any the fontconfig map could not open either. */
    readonly failed: readonly FontFaceFailure[];
    /**
     * `true` when this call REPLACED the process's default font map with a fontconfig-backed one.
     *
     * A whole-application consequence of one call — every widget created afterwards renders through
     * FreeType instead of the platform rasteriser — so it is reported rather than inferred, and
     * `PANGOCAIRO_BACKEND=coretext` gives the platform map back (ADR 0038 § Amendment 5).
     */
    readonly fontconfigFallback: boolean;
}

/** The `PangoCairo.FontMap` NAMESPACE members this module builds a map with. */
interface FontMapNamespace {
    get_default(): Pango.FontMap;
    new_for_font_type(fontType: number): Pango.FontMap | null;
}

/**
 * The two `PangoCairo.FontMap` NAMESPACE members this module needs to BUILD a map, or `undefined`
 * on a runtime with no Pango.
 *
 * The `--app browser` redirect and the plain-Node `--app node` target both replace `gi://PangoCairo`
 * with a virtual module whose default export is `{}`, while a node-gi-wired `--app node` target gets
 * the real bindings. The three are told apart by ASKING for the members rather than by reading a
 * platform string — the same discipline {@link isUnsupportedByFontMap} uses, because which font map a
 * process gets is decided by what Pango was COMPILED IN plus `PANGOCAIRO_BACKEND`, not by the OS
 * (ADR 0038 § Amendment 3).
 *
 * `set_default` is deliberately NOT among them: `pango_cairo_font_map_set_default()` takes the map as
 * its first argument, so GJS exposes it as an INSTANCE method and the namespace does not carry it.
 * Asking the namespace for it is how this module's own first version reported "no font map" on a
 * process that had one — every registration became a no-op returning an empty result, which reads as
 * "nothing was there" rather than as a thrown error.
 */
function fontMapNamespace(): FontMapNamespace | undefined {
    const api = (PangoCairo as { FontMap?: Partial<FontMapNamespace> }).FontMap;
    if (api === undefined || api === null) return undefined;
    if (typeof api.get_default !== 'function') return undefined;
    if (typeof api.new_for_font_type !== 'function') return undefined;
    return api as FontMapNamespace;
}

/**
 * Did the font map decline runtime registration outright?
 *
 * `pango_font_map_add_font_file()` is a vfunc, and the CoreText map implements none — so on macOS the
 * call falls through to Pango's base implementation, which answers `G_IO_ERROR_NOT_SUPPORTED`. That is
 * not a failure to report: a shipped `.app` is already correct declaratively, because
 * `ATSApplicationFontsPath` had the OS activate the staged directory before the process started, and
 * the ordering makes the runtime call the wrong tool there rather than merely a redundant one —
 * `pango_core_text_font_map_changed()` only bumps a serial, there is no
 * `kCTFontManagerRegisteredFontsChangedNotification` observer and no re-scan path in
 * `pangocoretext-fontmap.c`, so a face registered after the map initialises could not be recovered by
 * poking it anyway.
 *
 * KEYED ON THE ERROR rather than on `process.platform`, which is the difference between a capability
 * test and a guess about who is asking. It costs no `gjsify.os` declaration, and it stays right for any
 * other map that declines — which stopped being hypothetical: the backend is whichever is selected
 * rather than one per platform, and `@gjsify/node-gi`'s loader selects `PANGOCAIRO_BACKEND=fc` on the
 * bundled windowing runtime (ADR 0038 § Amendment 3), so a darwin process on it reaches this arm's
 * other side and REGISTERS the faces. A `process.platform` branch would have had to be found and
 * reversed instead.
 */
export function isUnsupportedByFontMap(error: unknown): boolean {
    // Narrowed through `as`, because a `gi://` module replaced by the empty virtual one has no
    // `GLib.Error` class at all and `error instanceof undefined` THROWS. Ask for each member instead of
    // narrowing the type once: the module's own shape is the guard.
    const gerror = (GLib as { Error?: new (...args: never[]) => { matches(quark: unknown, code: number): boolean } })
        .Error;
    const quark = (Gio as { io_error_quark?: () => unknown }).io_error_quark;
    const notSupported = (Gio as { IOErrorEnum?: { NOT_SUPPORTED?: number } }).IOErrorEnum?.NOT_SUPPORTED;
    if (typeof gerror !== 'function' || typeof quark !== 'function') return false;
    if (notSupported === undefined) return false;
    if (!(error instanceof gerror)) return false;
    return error.matches(quark(), notSupported);
}

/**
 * The reported reason as a GError's `message`, never a stringified GError.
 *
 * `GLib.Error` is NOT `instanceof Error` under GJS — measured on gjs 1.88.1, where
 * `GLib.Error.new_literal(…) instanceof Error` is `false`. A plain `instanceof Error` narrowing
 * therefore misses EXACTLY the errors this module sees, and every diagnostic printed over them would
 * silently degrade to `String(error)` — which is not obviously broken, only domain-prefixed.
 */
export function fontErrorMessage(error: unknown): string {
    const gerror = (GLib as { Error?: new (...args: never[]) => { message?: string } }).Error;
    if (typeof gerror === 'function' && error instanceof gerror) return error.message ?? String(error);
    return error instanceof Error ? error.message : String(error);
}

/**
 * The family names a font map currently holds.
 *
 * Typed `Pango.FontMap` and not `PangoCairo.FontMap`, which is what the call sites have:
 * `pango_cairo_font_map_get_default()` is declared to RETURN the base type.
 */
export function fontMapFamilies(fontMap: Pango.FontMap): string[] {
    return fontMap.list_families().map((family) => family.get_name());
}

/** Is `family` one this map can resolve? Pango's own answer, asked directly rather than inferred. */
export function fontMapHasFamily(fontMap: Pango.FontMap, family: string): boolean {
    return fontMap.get_family(family) !== null;
}

/**
 * How {@link fontMapServesFamily} takes its reading: a value that is EQUAL for a family the map
 * serves and for one it substitutes.
 *
 * A seam, so the decision can be held from a host that cannot produce the condition — the same
 * discipline {@link isUnsupportedByFontMap} exists for, and the reason `font-map.spec.ts` can assert
 * the decision on every leg instead of only where a poisoned map can be built.
 */
export type FontFamilyProbe = (fontMap: Pango.FontMap, family: string) => string;

/** A family name that cannot exist, so a served family and a substituted one cannot measure alike. */
const CONTROL_FAMILY = 'ZzzGjsifySubstitutionControlQx';

/**
 * Pixel size of a two-glyph layout in `family` — the reading behind {@link fontMapServesFamily}.
 *
 * The same two glyphs at the same size that `@gjsify/gtk-host`'s `fonts.spec.ts` and
 * `@gjsify/dom-elements`' `font-face.spec.ts` assert with, so the product and the tests cannot
 * disagree about what a substitution looks like. 40 pt because a difference that only appears at
 * one size is not a discriminator, and two glyphs because one measures its advance alone.
 */
function layoutSize(fontMap: Pango.FontMap, family: string): string {
    const description = new Pango.FontDescription();
    description.set_family(family);
    description.set_size(40 * Pango.SCALE);
    const layout = Pango.Layout.new(fontMap.create_context());
    layout.set_font_description(description);
    layout.set_text('Wg', -1);
    return layout.get_pixel_size().join('x');
}

/**
 * Does this map actually SERVE `family`, or does asking for it get the fallback?
 *
 * A LAYOUT, because that is the only reading that does not lie, and the readings that look cheaper
 * were measured first (pango 1.58.2 / gjs 1.88.1, on the fc map Fedora has, reached here with
 * `PANGOCAIRO_BACKEND=fontconfig`) on a map that had resolved the family to the fallback and then
 * had the face registered on it:
 *
 *   `get_family(name)`                  answers it
 *   `list_families()`                   contains it
 *   `load_font(desc).describe()`        the requested family — from a FRESH context
 *   `get_serial()`                      1, exactly as on an unpoisoned map
 *   `Pango.Layout` pixel size           THE FALLBACK — 86x66, identical to an invented family
 *
 * So the map holds the face, hands the right font to a caller that asks for it by name, reports the
 * same serial as a healthy map, and lays every glyph out in Verdana: a per-map-instance cache of the
 * negative resolution, which `add_font_file` does not invalidate and which nothing in JS reaches.
 * Warming a context with `load_font` first does not help (measured — still 86x66), and neither does a
 * context created after the registration; only a map that never saw the question serves it, which is
 * the fresh map {@link probeFontconfigMap} builds.
 *
 * Which is also why the equality is against a control family rather than against a fixed number: the
 * fallback's metrics are the host's business (Verdana 86x66 here, 87x63 on the Fedora 44 leg), and a
 * number pinned to one host's default sans would red everywhere else while proving nothing extra.
 */
export function fontMapServesFamily(
    fontMap: Pango.FontMap,
    family: string,
    probe: FontFamilyProbe = layoutSize,
): boolean {
    return probe(fontMap, family) !== probe(fontMap, CONTROL_FAMILY);
}

/**
 * The faces the map declined, tried against a fontconfig-backed map — and whether that map replaced
 * the default.
 *
 * A PROBE AND A DECISION, kept apart, because bundling them loses one of the two answers. A file
 * fontconfig cannot open is a real answer even where the swap is then refused: before this, a face that
 * was not a font at all landed in `declined` on a CoreText map — the platform map never opened it, so
 * there was no parse failure to report, and the fallback refused to swap because the face brought no
 * family — and it was therefore indistinguishable from a face that was perfectly good. That is the
 * silent substitution ADR 0038 exists against, one level down.
 */
interface FontconfigProbe {
    /** The candidate, or `null` where none could be built: no fc backend, or no configuration. */
    readonly map: Pango.FontMap | null;
    /** Its family names before the faces. Load-bearing only where `adopted` is `true`. */
    readonly before: readonly string[];
    /** Faces fontconfig could not open either, path → message. */
    readonly failed: ReadonlyMap<string, string>;
    /** `true` when `map` is now the process's default font map. */
    readonly adopted: boolean;
}

/** A probe that never ran: no faces declined, no fc backend, or `PANGOCAIRO_BACKEND` pinned. */
const NO_PROBE: FontconfigProbe = { map: null, before: [], failed: new Map(), adopted: false };

/**
 * Try the declined faces on a fontconfig-backed map, and make that map the default — but only when
 * the faces would otherwise reach nothing (ADR 0038 § Amendment 5).
 *
 * Each DECISION below exists so this changes NOTHING where nothing was broken: a pinned
 * `PANGOCAIRO_BACKEND` is somebody's choice; a pango built without fontconfig answers `NULL`; an fc
 * map with NO families means fontconfig found no configuration, and adopting it would trade one
 * missing face for every glyph; and if every family the faces bring is ALREADY on the platform map —
 * the shipped `.app`, or a face the user installed — they already reach the application and the
 * platform rasteriser is kept. None of them is a reason not to ASK fontconfig whether it can open the
 * files.
 *
 * ALTERNATIVES, weighed in the amendment rather than here: `CTFontManagerRegisterFontsForURL` keeps
 * CoreText rendering, but it needs a native symbol in a published prebuild AND has to run before Pango
 * first builds its map (there is no re-scan path in `pangocoretext-fontmap.c`), so it is an ordering
 * contract on application startup that no library call can enforce.
 */
function probeFontconfigMap(
    namespace: FontMapNamespace,
    platformMap: Pango.FontMap,
    faces: readonly string[],
    stale: readonly string[] = [],
): FontconfigProbe {
    if (faces.length === 0) return NO_PROBE;
    if (GLib.getenv('PANGOCAIRO_BACKEND') !== null) return NO_PROBE;

    // Typed through `never` because the declaration wants `cairo.FontType`, and naming that type would
    // pull `@girs/cairo-1.0` into this package's surface for one integer — see CAIRO_FONT_TYPE_FT.
    const candidate = namespace.new_for_font_type(CAIRO_FONT_TYPE_FT as never);
    if (candidate === null || candidate === undefined) return NO_PROBE;
    const before = fontMapFamilies(candidate);
    if (before.length === 0) return NO_PROBE;

    const failed = new Map<string, string>();
    for (const path of faces) {
        try {
            candidate.add_font_file(path);
        } catch (error) {
            failed.set(path, fontErrorMessage(error));
        }
    }

    const gained = fontMapFamilies(candidate).filter((name) => !before.includes(name));
    // Nothing new — fontconfig already had these faces from its own configuration, or none of them
    // opened, so there is nothing the platform map is missing. The per-face `failed` map is returned
    // all the same: on the second reading that is the only thing this call learned.
    if (gained.length === 0) return { map: candidate, before, failed, adopted: false };
    // "THE PLATFORM MAP ALREADY HAS THIS FAMILY" and "the platform map already SERVES it" are
    // different claims, and only the second is what this guard is for — a shipped `.app` activated
    // its directory and the platform rasteriser keeps rendering. `stale` names the families measured
    // to be served by nobody, and they are precisely the ones whose presence in `get_family` would
    // otherwise refuse the very swap this function exists to make: the map answering for a family it
    // cannot lay out is the definition of the bug, not a reason to keep it.
    const alreadyReached = (name: string): boolean => !stale.includes(name) && platformMap.get_family(name) !== null;
    if (gained.every(alreadyReached)) {
        return { map: candidate, before, failed, adopted: false };
    }

    // The swap is an INSTANCE call, so this is the only place the member is asked for — see
    // `fontMapNamespace`. Asked rather than assumed because a missing one would throw out of a
    // function whose whole contract is to never throw.
    const swap = (candidate as PangoCairo.FontMap).set_default;
    if (typeof swap !== 'function') return { map: candidate, before, failed, adopted: false };
    swap.call(candidate);
    return { map: candidate, before, failed, adopted: true };
}

/** The result for a runtime with no font map at all, and for a call with nothing to register. */
function noRegistration(): FontFaceRegistration {
    return {
        available: false,
        map: undefined,
        before: [],
        registered: [],
        declined: [],
        unreachable: [],
        failed: [],
        fontconfigFallback: false,
    };
}

/**
 * Register faces on a font map, falling back to a fontconfig-backed one when that map DECLINES.
 *
 * `map` defaults to the process default and exists so a caller can keep a batch on the map a previous
 * batch adopted — see {@link FontFaceRegistration.map}.
 *
 * Total: a face that will not open, or that no map here will take, is reported and never thrown.
 * Taking an application down over a decorative face would be worse than rendering it in a fallback —
 * but doing so SILENTLY is the defect this exists against (ADR 0038), so both are reported and the
 * caller decides what to say about them.
 */
export function registerFontFaces(faces: readonly string[], map?: Pango.FontMap): FontFaceRegistration {
    const namespace = fontMapNamespace();
    if (namespace === undefined) return noRegistration();

    let target = map ?? namespace.get_default();
    if (faces.length === 0) {
        return { ...noRegistration(), available: true, map: target, before: fontMapFamilies(target) };
    }

    const before = fontMapFamilies(target);
    const registered: string[] = [];
    const declined: string[] = [];
    const unreachable: string[] = [];
    const failed: FontFaceFailure[] = [];

    for (const path of faces) {
        try {
            target.add_font_file(path);
            registered.push(path);
        } catch (error) {
            // `add_font_file` is `throws="1"` in `Pango-1.0.gir` (since 1.56), and both arms are live:
            // a map that does no runtime registration answers NOT_SUPPORTED, and a file FreeType cannot
            // open answers something else.
            if (isUnsupportedByFontMap(error)) {
                declined.push(path);
                continue;
            }
            failed.push({ path, message: fontErrorMessage(error) });
        }
    }

    // A face the map ACCEPTED is not thereby reachable, and the reading that settles it is the one
    // `fontMapServesFamily` documents. Taken over the families this call's faces BROUGHT — the diff of
    // the family list, which is the only statement of "what did these files register as" that Pango
    // makes — and only where this call registered something, so a map that takes no face never pays
    // for a layout.
    //
    // It asks the map about the family it just gained, which RESOLVES it, and that is why this is
    // safe here and was not safe as a rule for callers: the poisoning being detected is exactly this
    // question, and by the time it is asked the answer is already fixed for the life of the map. The
    // only thing done with a poisoned map afterwards is to leave it.
    let stale: readonly string[] = [];
    if (registered.length > 0) {
        const gained = fontMapFamilies(target).filter((name) => !before.includes(name));
        stale = gained.filter((name) => !fontMapServesFamily(target, name));
        if (stale.length > 0) unreachable.push(...registered);
    }

    // THE DARWIN DEVELOPMENT RUN (ADR 0038 § Amendment 5), and its second face. A declined face and a
    // face no layout can be served are the same problem from here — nothing in this process renders
    // them — and both are re-accounted from what the probe learned, in this order:
    //
    //   failed      fontconfig could not open it either — a real answer, and where the swap was
    //               refused it is the ONLY one there is (see `FontconfigProbe`)
    //   registered  the probe adopted its map, so the face is on the map now in force
    //   declined    nothing here can take it: a shipped `.app`, whose faces the OS already activated
    //   unreachable nothing here can SERVE it, though the map took it all the same
    //
    // The accepted-but-unreachable faces go into the probe TOGETHER rather than one by one, and that
    // is a limit of Pango's API rather than a choice: it exposes no link from a registered file back
    // to the family it produced, so one unreachable family cannot be attributed to one file. Five
    // faces of two families would otherwise rescue whichever one happened to register first and call
    // the other four failures. A swap is the whole process default anyway, so all-or-nothing is what
    // `probeFontconfigMap` already decides.
    const rescued = [...declined, ...unreachable];
    if (rescued.length > 0) {
        const probe = probeFontconfigMap(namespace, target, rescued, stale);
        const stillDeclined: string[] = [];
        for (const path of declined) {
            const message = probe.failed.get(path);
            if (message !== undefined) failed.push({ path, message });
            else if (probe.adopted) registered.push(path);
            else stillDeclined.push(path);
        }
        declined.length = 0;
        declined.push(...stillDeclined);

        // An accepted face needs no re-accounting of its own: it stays in `registered` — the map
        // took it, and `get_family` answers the family — and `unreachable` is the refinement that
        // says a layout still gets the fallback. Two ways out of that refinement, and neither adds a
        // path anywhere the sibling loop above already put it: the fallback adopted its map, so the
        // faces are served now; or fontconfig could not open the file either, which is a `failed`
        // and not an unreachable face.
        if (probe.adopted) unreachable.length = 0;
        else {
            const stillUnreachable = unreachable.filter((path) => !probe.failed.has(path));
            for (const path of unreachable) {
                const message = probe.failed.get(path);
                if (message !== undefined) failed.push({ path, message });
            }
            unreachable.length = 0;
            unreachable.push(...stillUnreachable);
        }

        if (probe.adopted && probe.map !== null) {
            // The diff has to be taken on the map that is now in force, or every family the two
            // backends merely SPELL differently would be credited to this call.
            return {
                available: true,
                map: probe.map,
                before: probe.before,
                registered,
                declined,
                unreachable,
                failed,
                fontconfigFallback: true,
            };
        }
    }

    return {
        available: true,
        map: target,
        before,
        registered,
        declined,
        unreachable,
        failed,
        fontconfigFallback: false,
    };
}
