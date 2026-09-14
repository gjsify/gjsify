// SPDX-License-Identifier: MIT
// Does Pango put a GLYPH on the page for a given script, in THIS process?
//
// One JSON line on stdout, one process, no window. Lives outside `test/` so node's test
// runner does not treat it as a test file (same reason as `gtk-template-*.program.mjs`), and
// is run as a CHILD by `test/font-script-coverage.test.mjs` — twice, with the single variable
// under test flipped between the runs, so both measurements come from identical code in
// identical process shapes and the only difference is `PANGOCAIRO_BACKEND`.
//
// THE ORACLE IS `pango_layout_get_unknown_glyphs_count()`, and it is the tofu counter itself:
// when a shaper answers .notdef for a character Pango substitutes PANGO_GET_UNKNOWN_GLYPH and
// the cairo renderer draws the box a user reports as "empty squares". Counting it is therefore
// a question about RENDERING, not about whether some call returned non-null — `load_font()`
// answers a font for every request, including the one that will draw boxes.
//
// Measured both directions before it was relied on (Fedora 44 / Pango 1.57.1): the Tamil
// sample counts 0 with the host's Tamil faces on the map and 5 — one per character — with a
// fontconfig configuration that hides them. `SAMPLES` carries that second measurement as a
// permanent control, see `noFallback` below.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The text, as CODE POINTS rather than as literals, because the whole subject of this file is
 * which bytes reach a shaper: a source file that travels through an editor, a patch and a
 * Windows checkout must not be able to change what was measured. The literals are in the
 * comments so a reader can still see them.
 *
 * `latin` and `tamilNoFallback` are the two halves of the oracle's own control, and they run
 * on every platform:
 *   - `latin` must count 0. A counter stuck high (no fonts at all on this host) fails there.
 *   - `tamilNoFallback` is the SAME text as `tamil` with `pango_attr_fallback_new(FALSE)` set,
 *     which confines itemization to the closest match for the requested family and so cannot
 *     reach an Indic face. It must count > 0. A counter stuck at 0 fails there.
 * Only then does `tamil` mean anything.
 *
 * WHY TAMIL. It is what was measured on the two platforms this exists for: tofu under the
 * default backend, correct under fontconfig, with `Tamil Sangam MN.ttc` / `Nirmala.ttf`
 * installed the whole time. JAPANESE IS DELIBERATELY ABSENT — it rendered correctly in the
 * same window of the same run, because both platform maps carry a CJK fallback, so a test
 * using it is green before and after the fix and proves nothing at all.
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
 * The three font maps `pangocairo-fontmap.c` can build, in the order it tries them — coretext
 * → win32 → fc, first one COMPILED IN wins, `PANGOCAIRO_BACKEND` overrides. Exported so the
 * test names them from one place; see `fontMapType` below for how one of them is identified.
 */
export const MAP_TYPES = ['PangoCairoCoreTextFontMap', 'PangoCairoWin32FontMap', 'PangoCairoFcFontMap'];

/**
 * The family every sample asks for. A generic alias on purpose: it resolves to a Latin UI face
 * on all three platforms, which is what makes `tamilNoFallback` a control rather than a
 * coincidence, and it is what an application that never names a font gets.
 */
const FONT = 'Sans 14';

async function measure() {
    // Imported here and not at module scope: the test module imports RESULT_PREFIX from this
    // file, and a static `../gi.js` would load the native addon and the whole GI stack into the
    // test runner's own process to read one string constant.
    const { requireGi } = await import('../gi.js');

    const Pango = requireGi('Pango', '1.0');
    const PangoCairo = requireGi('PangoCairo', '1.0');
    const GObject = requireGi('GObject', '2.0');

    const fontMap = PangoCairo.FontMap.get_default();
    const context = fontMap.create_context();

    // WHICH BACKEND THIS PROCESS ACTUALLY GOT, read from the type system rather than from the
    // wrapper. PangoCairo's three map implementations are private types no GIR describes, so
    // the wrapper resolves to the nearest introspected ancestor and `constructor.$gtype`
    // answers `PangoFontMap` on all three (measured — under gjs the same read answers
    // `unknown_PangoCairoFcFontMap`, which is exactly the divergence that would have made this
    // look like it worked). `g_type_from_name()` does not care about wrappers: a GType exists
    // only once its `*_get_type()` has run, and `pango_cairo_font_map_new()` instantiates
    // exactly one of the three. So after the map is built, precisely the selected backend
    // answers non-null — measured null for all three BEFORE it is built.
    //
    // This is what tells the parent the difference between "the control saw no tofu" and "the
    // control never switched backend", which are opposite conclusions from the same number.
    const fontMapType =
        MAP_TYPES.find((name) => GObject.type_from_name(name) !== null && GObject.type_from_name(name) !== undefined) ??
        'unknown';

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
        fontMapType,
        font: FONT,
        samples,
    };
}

// Only when RUN, never when imported. The test module imports RESULT_PREFIX from here rather
// than keeping a second copy of it, and an unguarded top level would print a result line into
// the test runner's own TAP stream.
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
