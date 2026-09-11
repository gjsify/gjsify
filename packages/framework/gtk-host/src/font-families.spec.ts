// Resolving a declared family name against the families a font map holds — pure TypeScript, so it
// runs with no font map, no display and no GI at all. Same split as `font-dir.spec.ts` beside it,
// and the reason is the same: the DIVERGENCE this decides about exists between two operating
// systems, and no single host can produce both sides of it. The family lists below are therefore
// MEASURED ones, quoted from #1542, rather than a host's live `list_families()`.

import { describe, expect, it } from '@gjsify/unit';

import { describeFontFamilyMatch, matchFontFamilies, matchFontFamily } from './font-families.js';

/**
 * What two hosts report after registering the SAME two files, re-measured on `0.48.0`.
 *
 * `@expo-google-fonts/merriweather`'s `Merriweather_400Regular.ttf` and
 * `@expo-google-fonts/source-sans-3`'s `SourceSans3_400Regular.ttf`, copied to both machines and
 * SHA-256-verified identical there, then handed to
 * `PangoCairo.FontMap.get_default().add_font_file()` by one script:
 *
 *   Fedora 44 / GJS / PangoCairoFcFontMap      100 families → 102: `Merriweather`, `Source Sans 3`
 *   Windows 11 / @gjsify/gtk-runtime-win32-x64  82 families →  84: `Merriweather 18pt`, `Source Sans 3`
 *
 * Google Fonts ships Merriweather as an optical-size family and the two readers disagree about
 * whether the size axis belongs in the name. `Source Sans 3` is the control: no size axis, the
 * same name on both, and a name that ends in a digit without being an optical variant.
 *
 * And the substitution is a MEASUREMENT rather than a warning nobody sees. On Windows a 40pt
 * `Wg` set in `Merriweather` measures the same as one set in an invented family — Pango
 * substituted, and said so only in a `couldn't load font` line on stderr — while the same string
 * set in `Merriweather 18pt` measures differently. A different face, not a call that returned.
 */
const FONTCONFIG = ['Cantarell', 'DejaVu Sans', 'Merriweather', 'Source Sans 3'];
const GVSBUILD = ['Tahoma', 'Segoe UI', 'Merriweather 18pt', 'Source Sans 3'];

export default async () => {
    await describe('matchFontFamily — the name the caller wrote', async () => {
        await it('finds a family that is on the map under that name', async () => {
            const match = matchFontFamily('Merriweather', FONTCONFIG);
            expect(match.kind).toBe('exact');
            expect(match.family).toBe('Merriweather');
        });

        await it('finds the optical-size alias the OTHER font stack made of it', async () => {
            // THE MEASUREMENT. The same file, the same call, `registered: 5, failed: 0` on both
            // hosts — and on Windows the declared family was absent and Pango substituted Tahoma
            // without a word. This is the answer that makes it recoverable from the result.
            const match = matchFontFamily('Merriweather', GVSBUILD);
            expect(match.kind).toBe('optical');
            expect(match.family).toBe('Merriweather 18pt');
        });

        await it('resolves the same divergence read from the other side', async () => {
            // An application written on Windows hardcodes `Merriweather 18pt` and then has to keep
            // working on the platform whose map says `Merriweather`. One fact, two directions.
            const match = matchFontFamily('Merriweather 18pt', FONTCONFIG);
            expect(match.kind).toBe('optical');
            expect(match.family).toBe('Merriweather');
        });

        await it('finds an opsz axis-value NAME too, not just the `18pt` spelling', async () => {
            // MEASURED on this repository's own bundled typeface, and it is the same defect one
            // spelling over. `AdwaitaSans-Regular.ttf` declares nameID 1 `Adwaita Sans` and
            // carries an `opsz` axis (14-32) whose value at 14 is named `Text`. fontconfig puts
            // `Adwaita Sans` on the map; gvsbuild's DirectWrite reader composes the STAT name and
            // puts `Adwaita Sans Text`. Byte-identical file, two family names.
            //
            // It cost a CI failure to find: the runtime bundle's own font test asked for the
            // declared name on Windows and the family was not there — and the UI-font policy was
            // WRITING that name, so "use the Adwaita font" would have rendered in Tahoma.
            const match = matchFontFamily('Adwaita Sans', ['Adwaita Sans Text', 'Adwaita Mono', 'Segoe UI']);
            expect(match.kind).toBe('optical');
            expect(match.family).toBe('Adwaita Sans Text');
        });

        await it('keeps the set of axis-value names CLOSED', async () => {
            // `\w+` would have been the shorter rule and it is the wrong one: a trailing word is
            // not evidence of an optical variant. `Adwaita Sans Condensed` is a different family,
            // and answering `optical` for it would send a caller at a face the host does not
            // have — the substitution this module exists to prevent, caused by the fix for it.
            expect(matchFontFamily('Adwaita Sans', ['Adwaita Sans Condensed']).kind).toBe('absent');
            expect(matchFontFamily('Adwaita Sans', ['Adwaita Sans Mono']).kind).toBe('absent');
            // `Display` and `Poster` are `opsz` value names AND real family names, which is why
            // they are out of the set. A host that has `Noto Sans Display` and not `Noto Sans`
            // must hear `absent` — loud, with a warning — rather than be handed a DIFFERENT
            // family as the name to ask for, which is the failure this module reports on.
            expect(matchFontFamily('Noto Sans', ['Noto Sans Display']).kind).toBe('absent');
            expect(matchFontFamily('Playfair', ['Playfair Display']).kind).toBe('absent');
            expect(matchFontFamily('Bodoni', ['Bodoni Poster']).kind).toBe('absent');
            // And the exact name still wins over a variant when the map carries both, so a host
            // with the real family is never redirected to an optical alias of it.
            const both = matchFontFamily('Adwaita Sans', ['Adwaita Sans Text', 'Adwaita Sans']);
            expect(both.kind).toBe('exact');
            expect(both.family).toBe('Adwaita Sans');
        });

        await it('REFUSES to choose when the map carries several optical sizes', async () => {
            // Which optical size to use at which point size is a design decision — an optical size
            // is a different drawing of the letterforms. Picking one here would be this module
            // making that decision invisibly, which is the class of failure it exists to surface.
            const match = matchFontFamily('Merriweather', ['Merriweather 18pt', 'Merriweather 24pt', 'Tahoma']);
            expect(match.kind).toBe('ambiguous');
            expect(match.family).toBeUndefined();
            expect(match.candidates).toStrictEqual(['Merriweather 18pt', 'Merriweather 24pt']);
        });

        await it('prefers the exact name when both it and an optical variant are present', async () => {
            const match = matchFontFamily('Merriweather', ['Merriweather', 'Merriweather 18pt']);
            expect(match.kind).toBe('exact');
            expect(match.family).toBe('Merriweather');
        });

        await it('answers absent for a family nothing has, with no candidate to guess from', async () => {
            // The discriminator this whole area needs: a family that cannot exist must not be
            // reported as anything but missing, or "it resolved" and "it was substituted" look
            // alike — which is exactly what they do on the map itself.
            const match = matchFontFamily('ZzzNoSuchFamilyQx', GVSBUILD);
            expect(match.kind).toBe('absent');
            expect(match.family).toBeUndefined();
            expect(match.candidates.length).toBe(0);
        });

        await it('does not read a family that merely ENDS in a digit as an optical variant', async () => {
            // `Source Sans 3` was the control in the measurement and is the control here: it has
            // no size axis, reads identically on both hosts, and a looser suffix rule would find
            // "Source Sans" for it and answer a family nobody has.
            expect(matchFontFamily('Source Sans 3', FONTCONFIG).kind).toBe('exact');
            expect(matchFontFamily('Source Sans', FONTCONFIG).kind).toBe('absent');
            expect(matchFontFamily('Source Sans', GVSBUILD).kind).toBe('absent');
        });

        await it('matches case-insensitively and answers in the MAP’s spelling', async () => {
            // Pango and CSS both match family names case-insensitively, and the name to hand back
            // is the one the map uses — an application echoing its own spelling into a report
            // would print a name that is not what resolved.
            const match = matchFontFamily('merriweather', FONTCONFIG);
            expect(match.kind).toBe('exact');
            expect(match.family).toBe('Merriweather');
        });

        await it('is empty-input safe in both arguments', async () => {
            expect(matchFontFamily('Merriweather', []).kind).toBe('absent');
            expect(matchFontFamilies([], FONTCONFIG).length).toBe(0);
        });
    });

    await describe('matchFontFamilies — a brand set, in the order declared', async () => {
        await it('answers per name, keeping the caller’s order', async () => {
            const matches = matchFontFamilies(['Merriweather', 'Source Sans 3', 'Nope'], GVSBUILD);
            expect(matches.map((match) => match.declared)).toStrictEqual(['Merriweather', 'Source Sans 3', 'Nope']);
            expect(matches.map((match) => match.kind)).toStrictEqual(['optical', 'exact', 'absent']);
        });

        await it('is what separates the two hosts that reported the same result', async () => {
            // `registered: 5, declined: 0, failed: 0` on BOTH. The difference is entirely in what
            // the map holds afterwards, which is the only thing this reads.
            const onLinux = matchFontFamilies(['Merriweather', 'Source Sans 3'], FONTCONFIG);
            const onWindows = matchFontFamilies(['Merriweather', 'Source Sans 3'], GVSBUILD);
            expect(onLinux.map((match) => match.family)).toStrictEqual(['Merriweather', 'Source Sans 3']);
            expect(onWindows.map((match) => match.family)).toStrictEqual(['Merriweather 18pt', 'Source Sans 3']);
        });
    });

    await describe('describeFontFamilyMatch — the line a caller prints', async () => {
        await it('names the substitution for an absent family, since nothing else will', async () => {
            expect(describeFontFamilyMatch(matchFontFamily('Nope', FONTCONFIG))).toMatch(/NOT on the font map/);
        });

        await it('gives the optical case the name to ask for instead', async () => {
            // The line that earns its keep: this is the case where the window renders and the
            // typeface is wrong, so a message that only said "not found" would be read as a bug
            // in the staging rather than as a rename.
            expect(describeFontFamilyMatch(matchFontFamily('Merriweather', GVSBUILD))).toMatch(/"Merriweather 18pt"/);
        });

        await it('says whose decision an ambiguity is', async () => {
            const match = matchFontFamily('Merriweather', ['Merriweather 18pt', 'Merriweather 24pt']);
            expect(describeFontFamilyMatch(match)).toMatch(/design decision/);
        });

        await it('has something to say about every state, including the good one', async () => {
            // A describe() with a hole in it prints `undefined` at the moment a report is being
            // read, which is the worst possible moment.
            for (const description of [
                describeFontFamilyMatch(matchFontFamily('Merriweather', FONTCONFIG)),
                describeFontFamilyMatch(matchFontFamily('Merriweather', GVSBUILD)),
                describeFontFamilyMatch(matchFontFamily('Merriweather', ['Merriweather 18pt', 'Merriweather 24pt'])),
                describeFontFamilyMatch(matchFontFamily('Nope', FONTCONFIG)),
            ]) {
                expect(description.length).toBeGreaterThan(20);
            }
        });
    });
};
