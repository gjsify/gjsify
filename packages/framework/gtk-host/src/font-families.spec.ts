// Resolving a declared family name against the families a font map holds — pure TypeScript, so it
// runs with no font map, no display and no GI at all. Same split as `font-dir.spec.ts` beside it,
// and the reason is the same: the DIVERGENCE this decides about exists between two operating
// systems, and no single host can produce both sides of it. The family lists below are therefore
// MEASURED ones, quoted from #1542, rather than a host's live `list_families()`.

import { describe, expect, it } from '@gjsify/unit';

import { describeFontFamilyMatch, matchFontFamilies, matchFontFamily } from './font-families.js';

/**
 * What the two hosts of #1542 reported after the SAME staging run of the same five files.
 *
 * Byte-identical faces (SHA-256 verified), one script, and two different family names — because
 * Google Fonts ships Merriweather as an optical-size family and the two readers disagree about
 * whether the size axis belongs in the name. `Source Sans 3` is the control: no size axis, same
 * name on both, and a name that ends in a digit without being an optical variant.
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
