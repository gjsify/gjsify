// `FontFace.load()` against the REAL Pango font map — the property Excalibur's `FontSource.load()`
// depends on, and the one this file exists to hold.
//
// THE DISCRIMINATOR IS THE POINT, and it is the one `gtk-host`'s `fonts.spec.ts` builds: "the family
// resolved" is exactly what a substitution looks like. Pango answers a family it does not hold with the
// default sans, prints nothing, and the Canvas renders in the wrong typeface. So the same two glyphs
// are laid out at the same size through the same map twice — once in an INVENTED family, which
// measures what a substitution measures, and once in the real one — and the assertion is that the two
// DIFFER. Different METRICS, not a call that returned `true`.
//
// WHAT WAS BROKEN, measured on macOS 27 arm64 (Homebrew gjs 1.88.1, pango with fontconfig). `load()`
// called `add_font_file` on the DEFAULT map and swallowed the error. That map is a
// `PangoCairoCoreTextFontMap`, which implements no `add_font_file` vfunc, so every face answered
// `G_IO_ERROR_NOT_SUPPORTED`: the family stayed `absent`, the face measured identically to an invented
// family, and nothing was printed. So did `excalibur-jelly-jumper` under `gjsify run` — in the one
// place a developer actually looks at it. The repair routes the registration through
// `@gjsify/utils/font-map`, the same call `initFonts()` uses, and the swallowing became a diagnostic.
//
// ORDERING IS LOAD-BEARING and the suite is written to depend on it: `add_font_file` mutates a
// process-global font map and there is no unregister, so the "absent before" arm has to come first or
// it cannot be measured at all.

import { describe, expect, it } from '@gjsify/unit';

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';

import { fontMapHasFamily } from '@gjsify/utils/font-map';

import { FontFace } from './font-face.js';

/**
 * A real face whose family is on no host, borrowed from the showcase exactly as `gtk-host`'s
 * `fonts.spec.ts` and `tests/e2e/ship-layout` borrow it, and for the same reason (ADR 0038 §
 * Amendment 4): no operating system ships it, so no OS update can retire the control the way a
 * system font retires one the day a distribution starts shipping it. A SYSTEM face would prove nothing
 * on the machine that has it — which is the whole of `excalibur-jelly-jumper`'s symptom.
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

/**
 * Pixel size of a two-glyph layout in `family` — the metric half of the discriminator.
 *
 * The default map is read at CALL time rather than captured: a fontconfig fallback REPLACES the
 * process default, so a captured reference would keep measuring the map the face never reached, which
 * is the stale-measurement hazard `fonts.ts` documents for a layout built before registration.
 */
function layoutSize(family: string): string {
    const description = new Pango.FontDescription();
    description.set_family(family);
    description.set_size(40 * Pango.SCALE);
    const layout = Pango.Layout.new(PangoCairo.FontMap.get_default().create_context());
    layout.set_font_description(description);
    layout.set_text('Wg', -1);
    return layout.get_pixel_size().join('x');
}

/** Run `body` with `console.warn` collected, and hand the lines back. */
async function captureWarnings(body: () => Promise<void>): Promise<string[]> {
    const original = console.warn;
    const lines: string[] = [];
    console.warn = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
    };
    try {
        await body();
    } finally {
        console.warn = original;
    }
    return lines;
}

export default async () => {
    const source = findFaceSource();

    await it('has the showcase face in reach', async () => {
        // Fails rather than skips, as `tests/e2e/ship-layout` does: without the file every assertion
        // below would run over an empty set and pass having proved nothing.
        expect(source).toBeDefined();
    });

    if (source === undefined) return;

    // ── BEFORE ───────────────────────────────────────────────────────────────
    // The negative control, and it is also the arm that makes the measurement possible at all: the
    // BYTES are on disk, in this repository, one directory away — and the family is not on the map.
    // Nothing has to be hidden or mocked for the family to be absent, so no host can make this green
    // by having the face installed.
    await describe('before anything is registered', async () => {
        await it('has the face on disk and the family absent from the font map', async () => {
            expect(GLib.file_test(source, GLib.FileTest.EXISTS)).toBe(true);
            expect(fontMapHasFamily(PangoCairo.FontMap.get_default(), FACE_FAMILY)).toBe(false);
        });

        await it('measures the face family EXACTLY as it measures an invented one', async () => {
            // The substitution made measurable, before anything is registered. Without this the arm
            // after it would be a bare "the family is on the map", which a host that shipped
            // `Round9x13` would satisfy for the wrong reason.
            expect(layoutSize(FACE_FAMILY)).toBe(layoutSize(INVENTED_FAMILY));
        });
    });

    // ── THE LOAD ─────────────────────────────────────────────────────────────
    const face = new FontFace(FACE_FAMILY, `url(file://${source})`);
    const warnings = await captureWarnings(async () => {
        await face.load();
    });

    await describe('after load()', async () => {
        await it('reaches `loaded`, which it always did', async () => {
            // Stated separately and for no other reason: `status` is the whole of the Web contract this
            // class offers, it was `loaded` before the repair too, and it is therefore NOT evidence
            // that anything worked. The next two arms are.
            expect(face.status).toBe('loaded');
        });

        await it('puts the family on the font map', async () => {
            // FAILS BEFORE THE REPAIR on a CoreText map: the decline was swallowed, so the family
            // stayed absent. This is the line that makes the bug a bug rather than a comment.
            expect(fontMapHasFamily(PangoCairo.FontMap.get_default(), FACE_FAMILY)).toBe(true);
        });

        await it('measures the family DIFFERENTLY from an invented one', async () => {
            // The load-bearing assertion, and the one that cannot be satisfied by a name being
            // resolvable: both layouts go through the same map, the same size and the same two glyphs,
            // so any difference is the FACE. "The family resolved" has to mean that, because Pango
            // resolves a missing one too.
            expect(layoutSize(FACE_FAMILY)).not.toBe(layoutSize(INVENTED_FAMILY));
        });

        await it('says nothing, because everything it asked for worked', async () => {
            // The other half of "do not swallow the error silently": a diagnostic that fires on the
            // happy path is noise, and noise is what this change is removing. Asserted rather than
            // assumed, because a `console.warn` here would print once per face in every Canvas game.
            expect(warnings).toStrictEqual([]);
        });
    });

    // ── THE DIAGNOSTIC ───────────────────────────────────────────────────────
    await describe('a face whose family the map does not hold', async () => {
        await it('warns that text asking for it will render substituted, and still resolves', async () => {
            // The Windows optical-size rename is the real instance of this: gvsbuild's DirectWrite
            // reader puts the same bytes on the map as `Merriweather 18pt`, so the name the page wrote
            // resolves to nothing while the file registers without complaint (ADR 0038 § W1-W5). The
            // face is a real one here — the family the page DECLARED is the invented one, which is
            // what a consumer writing the wrong name looks like from inside Pango.
            const misnamed = new FontFace(INVENTED_FAMILY, `url(file://${source})`);
            const lines = await captureWarnings(async () => {
                await misnamed.load();
            });
            // Total by contract: a decorative face must not take a page down, so the promise still
            // resolves. Loud is what was missing.
            expect(misnamed.status).toBe('loaded');
            expect(lines.length).toBe(1);
            expect(lines[0]).toContain(INVENTED_FAMILY);
            expect(lines[0]).toMatch(/substituted/);
        });
    });

    // ── SOURCES THAT NAME NO FILE ────────────────────────────────────────────
    await describe('a source that is not a file:// URL', async () => {
        await it('resolves without inventing a path, and leaves the map alone', async () => {
            // What an https webfont looks like, and what the OLD dynamic import existed for: there is
            // nothing on disk to hand Pango and a browser's own machinery answers. The assertion is the
            // negative one — a made-up family stays absent — because "it did not crash" is what the
            // previous implementation already guaranteed and is not worth a test.
            const remote = new FontFace('ZzzNoSuchRemoteFontQx', 'url(https://example.invalid/font.woff2)');
            const lines = await captureWarnings(async () => {
                await remote.load();
            });
            expect(remote.status).toBe('loaded');
            expect(fontMapHasFamily(PangoCairo.FontMap.get_default(), 'ZzzNoSuchRemoteFontQx')).toBe(false);
            // And no diagnostic either: there is no face, so there is nothing that failed.
            expect(lines).toStrictEqual([]);
        });
    });
};
