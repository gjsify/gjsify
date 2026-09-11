// WHICH family name an application must actually ask for — decided without touching the platform.
//
// Free of imports, like `font-dir.ts` beside it and for the same reason: the font map's family
// list arrives as a plain array of strings, so the decision is exercised on Node as well as on
// GJS, and `fonts.ts` is the only file that has to talk to Pango.
//
// THE DEFECT (#1542). `initFonts()` reported the FILES it handed to the font map, and a caller can
// act on none of them: `Pango.FontDescription.set_family()` and CSS `font-family` take a FAMILY
// NAME, which comes out of the font's naming table and depends on which font stack read it. The
// same byte-identical `Merriweather_400Regular.ttf`, staged by the same script, registers as
//
//   `Merriweather`        under fontconfig (Fedora, GTK 4)
//   `Merriweather 18pt`   under gvsbuild (Windows 11, @gjsify/gtk-runtime-win32-x64)
//
// because Google Fonts ships Merriweather as an optical-size family and the two readers disagree
// about whether the size axis belongs in the family name. `Source Sans 3`, from the same staging
// run, has no such axis and reads identically on both. `initFonts()` answered
// `registered: 5, declined: 0, failed: 0` on BOTH hosts — accurate, and useless: on Windows the
// declared family was absent from the map and Pango substituted, because `set_family()` against a
// family nothing has does not throw and does not exit non-zero.
//
// RE-MEASURED on 0.48.0, with the two files copied to both machines and SHA-256-verified
// identical there: 100 families → 102 under fontconfig (`Merriweather`, `Source Sans 3`) and
// 82 → 84 under `@gjsify/gtk-runtime-win32-x64` (`Merriweather 18pt`, `Source Sans 3`). The
// substitution is measurable rather than merely warned about: on Windows a 40pt `Wg` set in
// `Merriweather` measures exactly what an INVENTED family measures, while the same string in
// `Merriweather 18pt` measures something else — a different face, not a call that returned.
//
// What the two hosts DO differ on is whether anything is said at all: the win32 backend prints
// `couldn't load font "Merriweather …", falling back to "Sans …"` at LAYOUT time, and the
// fontconfig host printed nothing for the same invented family. Neither is a value a caller can
// branch on, which is why the answer is a returned match rather than a log line.
//
// So this is the layer between "a face was registered" and "the name I wrote will render": given
// the family names a map actually holds, what should the caller ASK FOR — and when is the honest
// answer that it cannot be decided here?
//
// WHY `ambiguous` IS A STATE AND NOT AN ERROR, and why it is the reason this returns four states
// rather than `string | undefined`. When several optical sizes of one family are on the map
// (`Merriweather 18pt`, `Merriweather 24pt`), WHICH to use at which point size is a design
// decision — an optical size is a different drawing of the letterforms, chosen for the size it
// will be set at. Picking one here would be this module making that decision invisibly, which is
// the same class of failure as the substitution it exists to surface.

/**
 * The optical-size suffix, in the two spellings that have been MEASURED on the Windows reader.
 *
 *   `Merriweather 18pt`    — Google Fonts' numeric convention, the original measurement
 *   `Adwaita Sans Text`    — a STAT axis-value NAME for the `opsz` axis
 *
 * The second was found by this repository's own bundled typeface failing on Windows, and it is
 * the same defect one spelling over. `AdwaitaSans-Regular.ttf` declares nameID 1 `Adwaita Sans`
 * and carries an `opsz` axis (14–32) whose value at 14 is named `Text`: fontconfig reports the
 * nameID-1 family, while gvsbuild's DirectWrite reader composes the STAT name and the family on
 * the map is `Adwaita Sans Text`. Byte-identical file, two family names — exactly the
 * Merriweather finding, which is why it belongs in this pattern rather than in a special case.
 *
 * A CLOSED SET OF NAMES, not `\w+`, and `Display` and `Poster` are OUT OF IT. A trailing word
 * is not evidence of an optical variant: `Noto Sans Display`, `Playfair Display` and
 * `Bodoni Poster` are families in their own right, so admitting those two tokens answers
 * `optical` — with a `family` the caller is told to ask for — for a family the host genuinely
 * does not have. That is the substitution this module exists to surface, produced by the fix
 * for it, and `absent` is the answer that cannot cause one. The set is therefore what has been
 * MEASURED (`\d+pt`, `Text`) plus the `opsz` names with no standalone-family collision; the
 * cost of leaving one out is a loud `absent` with a warning, the cost of admitting one is a
 * silent wrong family.
 *
 * The `exact` arm is tried first, so a map holding BOTH names is unaffected, and two matches
 * still land in `ambiguous` rather than in a guess.
 *
 * Anchored at the END and requiring the space, so `Source Sans 3` — a family whose name simply
 * ends in a digit — is untouched. It was the control in the measurement: same staging run, no
 * size axis, identical family name on both hosts.
 */
const OPTICAL_SIZE_SUFFIX = /^(.*\S)\s(?:\d+pt|Text|Caption|Subhead|Banner)$/i;

/** How a declared family name was found among the families a font map holds. */
export type FontFamilyMatchKind = 'exact' | 'optical' | 'ambiguous' | 'absent';

/** What a declared family name resolves to on a given font map. */
export interface FontFamilyMatch {
    /** The name the application wrote. */
    readonly declared: string;
    /**
     * The family name to put in a `Pango.FontDescription` or a `font-family` declaration, or
     * `undefined` when there is no answer this module may give (`absent`, `ambiguous`).
     */
    readonly family: string | undefined;
    readonly kind: FontFamilyMatchKind;
    /**
     * Every family on the map that is a plausible reading of `declared`. One entry for `exact`
     * and `optical`, several for `ambiguous`, none for `absent` — so a caller resolving an
     * ambiguity has the candidates in hand and does not have to re-derive them.
     */
    readonly candidates: readonly string[];
}

/** A family name for comparison. Pango and CSS both match family names case-insensitively. */
const fold = (name: string): string => name.trim().toLowerCase();

/**
 * Resolve one declared family name against the families a font map holds.
 *
 * Both directions of the divergence, because it is one fact read from either side: an application
 * written against the fontconfig name (`Merriweather`) meets `Merriweather 18pt` on Windows, and
 * one written against the Windows name meets `Merriweather` everywhere else. Neither is more
 * correct than the other, and an application that hardcodes either has to keep working on the
 * other platform — which is the whole complaint.
 */
export function matchFontFamily(declared: string, families: readonly string[]): FontFamilyMatch {
    const want = fold(declared);
    const exact = families.find((family) => fold(family) === want);
    if (exact !== undefined) return { declared, family: exact, kind: 'exact', candidates: [exact] };

    // `declared` is the base name, the map carries optical variants of it.
    const optical = families.filter((family) => {
        const base = OPTICAL_SIZE_SUFFIX.exec(family);
        return base !== null && fold(base[1]) === want;
    });
    if (optical.length === 1) return { declared, family: optical[0], kind: 'optical', candidates: optical };
    if (optical.length > 1) return { declared, family: undefined, kind: 'ambiguous', candidates: optical };

    // The inverse: `declared` carries the optical suffix and the map has the base name.
    const declaredBase = OPTICAL_SIZE_SUFFIX.exec(declared.trim());
    if (declaredBase !== null) {
        const base = families.find((family) => fold(family) === fold(declaredBase[1]));
        if (base !== undefined) return { declared, family: base, kind: 'optical', candidates: [base] };
    }

    return { declared, family: undefined, kind: 'absent', candidates: [] };
}

/** {@link matchFontFamily} over a list, in the order declared. */
export function matchFontFamilies(
    declared: readonly string[],
    families: readonly string[],
): readonly FontFamilyMatch[] {
    return declared.map((name) => matchFontFamily(name, families));
}

/**
 * One line saying what happened to a declared family, for a caller that wants to print it.
 *
 * Exported because the wording is the point: a report that says "not found" leaves the reader
 * to guess whether the file failed, the map declined it, or the name simply differs here — and
 * those have three different repairs. The `optical` line is the one that earns its keep, because
 * a rename is exactly what does NOT look like a problem when the window renders.
 */
export function describeFontFamilyMatch(match: FontFamilyMatch): string {
    switch (match.kind) {
        case 'exact':
            return `${match.declared}: on the font map under that name`;
        case 'optical':
            return (
                `${match.declared}: on the font map as "${match.family}" — this font stack keeps the optical-size ` +
                'axis in the family name, so the declared name resolves to nothing and Pango substitutes the ' +
                'default sans without a word. Ask for the name on the right.'
            );
        case 'ambiguous':
            return (
                `${match.declared}: the font map carries ${match.candidates.length} optical sizes of it ` +
                `(${match.candidates.join(', ')}) and no family under the declared name. Which one to use at ` +
                'which point size is a design decision, so nothing here picks for you.'
            );
        case 'absent':
            return (
                `${match.declared}: NOT on the font map. Text asking for it renders in a substituted family — ` +
                'Pango does not report a missing family, so nothing else will say so.'
            );
    }
}
