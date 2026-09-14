// SPDX-License-Identifier: MIT
// Does Pango put a GLYPH on the page for a given script, in THIS process?
//
// One JSON line on stdout, one process, no window. Lives outside `test/` so node's test runner
// does not treat it as a test file (same reason as `gtk-template-*.program.mjs`), and is run as a
// CHILD by `test/font-script-coverage.test.mjs` — several times, with the single variable under
// test flipped between the runs, so every measurement comes from identical code in identical
// process shapes and the only difference is `PANGOCAIRO_BACKEND`: its VALUE, and — because that
// turned out to be the thing #1668 actually hinged at on win32 — whether it arrives in the
// LAUNCH environment or is written by the loader once the process is already running.
//
// THE ORACLE IS `pango_layout_get_unknown_glyphs_count()`, and it is the tofu counter itself:
// when a shaper answers .notdef for a character Pango substitutes PANGO_GET_UNKNOWN_GLYPH and
// the cairo renderer draws the box a user reports as "empty squares". Counting it is therefore
// a question about RENDERING, not about whether some call returned non-null — `load_font()`
// answers a font for every request, including the one that will draw boxes.
//
// Measured both directions before it was relied on (Fedora 44 / Pango 1.57.1): the Tamil sample
// counts 0 with the host's Tamil faces on the map and 5 — one per character — with a fontconfig
// configuration that hides them. `SAMPLES` carries that second measurement as a permanent
// control, see `noFallback` below.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The variables whose REACH is in question, and which this program therefore reports from every
 * environment a Windows process has rather than from the one that is convenient.
 *
 * `pango_cairo_font_map_new()` and fontconfig's config lookup both call plain `getenv()`, while
 * Node's `process.env` writer is `SetEnvironmentVariableW()`, which updates the Win32
 * environment block and not the C runtime's copy. So on win32 a value can be simultaneously
 * present in `process.env`, present to `g_getenv()`, inherited by every child — and invisible to
 * the library that reads it. Reporting only `process.env` is what made a set variable look like
 * a declined one (#1668).
 */
export const WATCHED_ENV = ['PANGOCAIRO_BACKEND', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH'];

/**
 * What the LAUNCH environment carried, captured before `../gi.js` is imported and therefore
 * before the loader has written anything. The difference between this and the same read after
 * the import is the difference between "the test put it there" and "the loader did".
 */
const envAtEntry = Object.fromEntries(WATCHED_ENV.map((name) => [name, process.env[name] ?? null]));

/**
 * The text, as CODE POINTS rather than as literals, because the whole subject of this file is
 * which bytes reach a shaper: a source file that travels through an editor, a patch and a
 * Windows checkout must not be able to change what was measured. The literals are in the
 * comments so a reader can still see them.
 *
 * `latin` and `tamilNoFallback` are the two halves of the oracle's own control, and they run on
 * every platform:
 *   - `latin` must count 0. A counter stuck high (no usable face at all) fails there.
 *   - `tamilNoFallback` is the SAME text as `tamil` with `pango_attr_fallback_new(FALSE)` set,
 *     which confines itemization to the closest match for the requested family and so cannot
 *     reach an Indic face. It must count > 0. A counter stuck at 0 fails there.
 * Only then does `tamil` mean anything.
 *
 * WHY TAMIL. It is what was measured on the two platforms this exists for: tofu under the
 * default backend, correct under fontconfig, with `Tamil Sangam MN.ttc` / `Nirmala.ttf`
 * installed the whole time. JAPANESE IS DELIBERATELY ABSENT — it rendered correctly in the same
 * window of the same run, because both platform maps carry a CJK fallback, so a test using it is
 * green before and after the fix and proves nothing at all.
 */
export const SAMPLES = [
    // "Hello"
    { id: 'latin', codePoints: [0x48, 0x65, 0x6c, 0x6c, 0x6f], label: 'Latin' },
    // "தமிழ்" — TA, MA, vowel sign I, ZHA, virama
    { id: 'tamil', codePoints: [0x0ba4, 0x0bae, 0x0bbf, 0x0bb4, 0x0bcd], label: 'Tamil' },
    {
        id: 'tamilNoFallback',
        codePoints: [0x0ba4, 0x0bae, 0x0bbf, 0x0bb4, 0x0bcd],
        label: 'Tamil, font fallback disabled',
        noFallback: true,
    },
];

/** The marker the parent greps for: a loader diagnostic on stdout must not become the result. */
export const RESULT_PREFIX = 'PANGO-SCRIPT-COVERAGE ';

/**
 * The three font maps `pangocairo-fontmap.c` can build, in the order it tries them — coretext →
 * win32 → fc, first one COMPILED IN wins, `PANGOCAIRO_BACKEND` overrides. Exported so the test
 * names them from one place.
 */
export const MAP_TYPES = ['PangoCairoCoreTextFontMap', 'PangoCairoWin32FontMap', 'PangoCairoFcFontMap'];

/**
 * Family names that would mean this host has a Tamil face at all, lower-cased substrings.
 *
 * Reported, never asserted. Its job is to separate the two explanations for a tofu count that
 * otherwise look identical in a log — "the backend cannot reach the face" and "this machine has
 * no such face" — because a Windows SERVER image ships a far smaller font set than the Windows
 * 11 desktop the defect was measured on, and that difference is invisible in a glyph count.
 */
const TAMIL_FAMILY_HINTS = ['tamil', 'nirmala', 'latha', 'vijaya'];

/**
 * The family every sample asks for. A generic alias on purpose: it resolves to a Latin UI face on
 * all three platforms, which is what makes `tamilNoFallback` a control rather than a coincidence,
 * and it is what an application that never names a font gets.
 */
const FONT = 'Sans 14';

/**
 * Which of the three map GTypes exist in this process right now.
 *
 * `g_type_from_name()` does not care about wrappers: a GType exists only once its
 * `*_get_type()` has run, and for these three that is `g_object_new()` inside
 * `pango_cairo_font_map_new()`. Read from the type system rather than from the wrapper because
 * the maps are private types no GIR describes — node-gi resolves `constructor.$gtype` to the
 * nearest introspected ancestor and answers `PangoFontMap` for all three (measured; gjs answers
 * `unknown_PangoCairoFcFontMap` for the same read, which is exactly the divergence that would
 * have made a wrong control look right).
 * @param {Record<string, any>} GObject
 * @returns {string[]}
 */
function registeredMapTypes(GObject) {
    return MAP_TYPES.filter((name) => {
        const gtype = GObject.type_from_name(name);
        return gtype !== null && gtype !== undefined;
    });
}

async function measure() {
    // Imported here and not at module scope: the test module imports RESULT_PREFIX and MAP_TYPES
    // from this file, and a static `../gi.js` would load the native addon and the whole GI stack
    // into the test runner's own process to read two constants.
    const { requireGi } = await import('../gi.js');

    const Pango = requireGi('Pango', '1.0');
    const PangoCairo = requireGi('PangoCairo', '1.0');
    const GObject = requireGi('GObject', '2.0');
    const GLib = requireGi('GLib', '2.0');

    // THE TWO ENVIRONMENTS, read side by side while neither has been acted on yet. `process.env`
    // is Node's view (`GetEnvironmentVariableW` on win32), `GLib.getenv` is `g_getenv()`'s — the
    // same Win32 block. Neither of them is `getenv()`, which is the one pango is about to use and
    // the one no API here can read; what stands in for it is the MAP built below. A run where all
    // three views agree and the map does not is the whole finding of #1668 written in one line.
    const envAfterLoad = Object.fromEntries(WATCHED_ENV.map((name) => [name, process.env[name] ?? null]));
    const glibEnv = Object.fromEntries(WATCHED_ENV.map((name) => [name, GLib.getenv(name) ?? null]));

    // BEFORE, so the delta below NAMES the map that was built rather than listing what happens to
    // be registered. Expected empty: requiring the typelib does not run a private type's
    // `*_get_type()`, only instantiating one of the maps does.
    const mapTypesBefore = registeredMapTypes(GObject);

    const fontMap = PangoCairo.FontMap.get_default();
    // NULL is a real answer, and the one `PANGOCAIRO_BACKEND=<not compiled in>` gives: pango
    // g_criticals the available-backend list and returns nothing (measured, Pango 1.57.1). The
    // caller wants that list, so this reports rather than throws.
    if (!fontMap) {
        return {
            platform: process.platform,
            backend: process.env.PANGOCAIRO_BACKEND ?? null,
            envAtEntry,
            envAfterLoad,
            glibEnv,
            fontMap: null,
        };
    }

    const context = fontMap.create_context();

    // WHICH BACKEND THIS PROCESS ACTUALLY GOT, read from the type system rather than from the
    // wrapper. PangoCairo's three map implementations are private types no GIR describes, so the
    // wrapper resolves to the nearest introspected ancestor and `constructor.$gtype` answers
    // `PangoFontMap` on all three (measured — under gjs the same read answers
    // `unknown_PangoCairoFcFontMap`, which is exactly the divergence that would have made this
    // look like it worked). `g_type_from_name()` does not care about wrappers: a GType exists
    // only once its `*_get_type()` has run.
    //
    // ALL of them, not the first — a list, because more than one CAN be registered in a process
    // and reporting the first in a fixed order would hand the caller a name that happens to be
    // right while hiding that the question was ambiguous. That is not hypothetical: the first
    // version of this file reported `MAP_TYPES.find(...)` over a coretext → win32 → fc order, so
    // a win32 name would have masked an fc map registered beside it, and the run that produced
    // the wrong #1668 diagnosis is the one that read it.
    const mapTypes = registeredMapTypes(GObject);

    const families = fontMap.list_families().map((family) => family.get_name());
    const tamilFamilies = families.filter((name) =>
        TAMIL_FAMILY_HINTS.some((hint) => name.toLowerCase().includes(hint)),
    );

    const samples = SAMPLES.map((sample) => {
        const layout = Pango.Layout.new(context);
        layout.set_font_description(Pango.FontDescription.from_string(FONT));
        if (sample.noFallback) {
            const attrs = new Pango.AttrList();
            attrs.insert(Pango.attr_fallback_new(false));
            layout.set_attributes(attrs);
        }
        layout.set_text(String.fromCodePoint(...sample.codePoints), -1);
        return {
            id: sample.id,
            label: sample.label,
            characters: sample.codePoints.length,
            unknownGlyphs: layout.get_unknown_glyphs_count(),
        };
    });

    return {
        platform: process.platform,
        backend: process.env.PANGOCAIRO_BACKEND ?? null,
        fontconfigFile: process.env.FONTCONFIG_FILE ?? null,
        envAtEntry,
        envAfterLoad,
        glibEnv,
        fontMap: true,
        mapTypesBefore,
        mapTypes,
        familyCount: families.length,
        tamilFamilies,
        font: FONT,
        samples,
    };
}

// Only when RUN, never when imported. The test module imports two constants from here, and an
// unguarded top level would print a result line into the test runner's own TAP stream.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let payload;
    try {
        payload = await measure();
    } catch (error) {
        // A host with no Pango typelib is a SKIP for the caller, not a failure — the same
        // tolerance every GTK test here has. Reported as data so the parent says which it was.
        payload = { error: String(error?.message ?? error), platform: process.platform };
    }
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(payload)}\n`);
}
