// How a `font-family` VALUE becomes GTK CSS text.
//
// Every other paint property carries a colour, a length, a number or a keyword —
// none of which can contain a character that ends the value early. `font-family`
// carries a NAME, and a name is the one thing a project supplies verbatim. So this
// is the only property whose value has to be SERIALISED rather than interpolated,
// and `CSS_VALUE_KIND` in `paint.ts` is where that judgement is written down and
// machine-held.
//
// THE INCIDENT. `font-family: Source Sans 3` — a real family, on Pango's default
// font map, `load_font()` answering `Source Sans 3 700` — reaches GTK's parser as
// `Junk at end of value for font-family`. GTK refuses the DECLARATION, the
// containment probe in `document.ts` refuses the whole generated rule, and a React
// tree dies with no boundary between the `<Text>` and the screen. Shipping a brand
// typeface and having a multi-word family name are close to the same event, so this
// arrives the moment an application adopts its own fonts.
//
// WHAT ACTUALLY BREAKS, MEASURED (GTK 4.22.4, gjs 1.88.1) — and it is NOT "more than
// one word". CSS lets an unquoted family be a SEQUENCE of identifiers, and GTK
// implements that faithfully: `Noto Sans`, `DejaVu Sans`, `Fira Code`,
// `Liberation Serif`, `SF Pro Text` and `Roboto Condensed` all parse bare. What
// fails is a component that is not a valid CSS identifier — overwhelmingly one that
// starts with a DIGIT (`Source Sans 3`, `M PLUS 1p`, `Press Start 2P`,
// `Helvetica Neue LT Std 55 Roman`; a leading digit on the first component reports
// `Expected a string` instead), and otherwise one carrying a character idents cannot
// hold (`Foo.Bar`, `Foo/Bar`). That distinction is why the first encounter reads as
// a problem with the specific font: most multi-word families work.
//
// So the rule is not "quote when there is a space". It is CSSOM's rule — quote every
// family NAME, leave every KEYWORD bare — which cannot be wrong about the identifier
// grammar because it never consults it.
//
// THREE THINGS THAT MUST SURVIVE UNTOUCHED, each measured:
//
//   1. **A fallback stack.** `'Source Sans 3', sans-serif` is a legitimate value.
//      The commas stay, each member is decided on its own, and `sans-serif` stays
//      BARE — a quoted keyword is a family name and no longer a keyword. On GTK the
//      difference is not observable (its own serialiser flattens `sans-serif` to
//      `"sans-serif"`, so it has no generic-family concept at all and hands both to
//      Pango, which resolves the alias); it is kept because the value is CSS and
//      correct CSS is what this emits.
//   2. **A value that is already quoted.** Consumers quote defensively while a fix
//      is in flight, and double-quoting turns `"Source Sans 3"` into a family whose
//      name contains quote marks.
//   3. **A `var()` reference.** `font-family: var(--font-sans)` parses on GTK and is
//      the shape a Tailwind v4 `@theme` produces, exactly as the colour scales
//      already arrive as `rgb(var(--…))`. Quoting it would emit a family literally
//      called `var(--font-sans)` — a silent wrong font rather than a refusal. Its
//      fallback form `var(--f, sans-serif)` also carries a COMMA, which is why the
//      split below tracks parenthesis depth instead of calling `split(',')`.
//
// BOTH PASSTHROUGHS ARE NARROW, because a member that goes out verbatim is
// declaration text this module did not write. `QUOTED` refuses a member carrying any
// of CSS's three newlines rather than only `\n`, since a raw carriage return in a
// defensively quoted token took the whole document. And a function is passed through
// only when the call it opens CLOSES on the last character: `var(--x); color: red`
// otherwise emits a second declaration, with no parse error and a surviving
// containment sentinel, so nothing downstream ever sees it.

import { UnknownUtilityError } from './errors.js';

/**
 * The generic families, which are keywords wherever they appear in the list.
 *
 * CSS Fonts 4 § 2.1.1. Quoting one would make it a family name — the failure is
 * silent, because a name nobody has is simply skipped in favour of the next member.
 */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'fangsong',
    'emoji',
]);

/**
 * The CSS-wide keywords, which are keywords ONLY as the whole value.
 *
 * `font-family: inherit` is inheritance; `font-family: inherit, sans-serif` is not
 * valid CSS at all, and reading the first member as a family name is the closest
 * thing to what was written. Measured: GTK honours `inherit`, `initial` and `unset`
 * (its serialiser keeps them bare) and does NOT implement `revert` — it comes back
 * as the string `"revert"`, i.e. a family name. It stays listed anyway, because the
 * value this emits is CSS and `revert` is a keyword in CSS.
 */
const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * A member that is ALREADY a CSS string, escapes included.
 *
 * A raw newline disqualifies it, because a CSS string cannot hold one — and CSS's
 * newline is THREE characters, not one: line feed, CARRIAGE RETURN and form feed
 * (Syntax 3 § 4.2). Measured, and the difference is the whole document: a raw CR
 * inside an already-quoted member, passed through here, is `Expected a string`
 * followed by `Unterminated block at end of document`, and the containment sentinel
 * is GONE — every rule after it with it. Excluded, the member falls to
 * {@link quote}, which escapes the character, and the sentinel survives. Matching
 * only `\n` left the passthrough branch walking into the exact failure the escaping
 * branch exists to prevent.
 */
const QUOTED = /^"(?:[^"\\\n\r\f]|\\[\s\S])*"$|^'(?:[^'\\\n\r\f]|\\[\s\S])*'$/;

/** A member that OPENS like a function call, `var(--x)` above all. A bare family name cannot contain a parenthesis. */
const FUNCTION = /^[a-zA-Z-][\w-]*\(/;

/** CSS's whitespace (Syntax 3 § 4.2). What "nothing but space so far in this member" is measured against. */
const WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r', '\f']);

/**
 * One family name → a CSS string.
 *
 * The control-character half is not decoration. A raw newline inside a string is
 * `Unterminated block at end of document` (measured) — the failure mode that takes
 * every rule AFTER it with it, reported by nothing but the containment probe. The
 * `\<hex> ` form is what GTK reads back correctly (`"Two\A Lines"` round-trips), and
 * the trailing space is the escape's own terminator rather than part of the name.
 *
 * Character by character rather than by regex: a character class holding the control
 * range is what `no-control-regex` is for, and the loop says the same thing without
 * a suppression.
 */
function quote(name: string): string {
    let out = '"';
    for (const char of name) {
        const code = char.codePointAt(0) ?? 0;
        if (char === '"' || char === '\\') out += `\\${char}`;
        else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
        else out += char;
    }
    return `${out}"`;
}

/**
 * Split on the commas that separate LIST MEMBERS, and on no others.
 *
 * A comma inside a string (`"Foo, Bar"` is a legal family name) or inside a function
 * (`var(--f, sans-serif)`) does not separate anything. Splitting on it would hand
 * `var(--f` to the quoter and emit a rule GTK refuses — the same bug being fixed
 * here, one layer along.
 *
 * A QUOTE ONLY OPENS A STRING WHERE A STRING CAN BEGIN: at the start of a member, or
 * inside a function, where CSS tokenisation applies. Everywhere else it is a
 * character of a bare name, because a bare member is a NAME supplied verbatim and
 * not CSS text — that is the same reading `QUOTED` uses by anchoring at `^`, and the
 * two disagreeing is a bug with no diagnostic anywhere. Measured: with a quote
 * opening a string wherever it appears, `Marion's Hand, sans-serif` never splits,
 * the whole value is quoted as one name, GTK accepts
 * `font-family: "Marion's Hand, sans-serif"` without complaint, and the fallback
 * stack is silently gone. Any name carrying an odd number of `'` or `"` — including
 * `Say "Ah` next to a fallback — swallowed the rest of the list the same way.
 */
function members(value: string): string[] {
    const out: string[] = [];
    let start = 0;
    let depth = 0;
    let quoteChar: string | null = null;
    // Nothing but whitespace seen since this member began, so a quote here opens it.
    let opening = true;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (quoteChar !== null) {
            if (char === '\\') index++;
            else if (char === quoteChar) quoteChar = null;
            continue;
        }
        if ((opening || depth > 0) && (char === '"' || char === "'")) quoteChar = char;
        else if (char === '(') depth++;
        else if (char === ')' && depth > 0) depth--;
        else if (char === ',' && depth === 0) {
            out.push(value.slice(start, index));
            start = index + 1;
            opening = true;
            continue;
        }
        if (!WHITESPACE.has(char)) opening = false;
    }
    out.push(value.slice(start));
    return out;
}

/**
 * Is this member a SINGLE, COMPLETE function call — `var(--x)` and not `var(--x`?
 *
 * The passthrough branch hands a function to GTK verbatim, so what it accepts is
 * declaration text this module did not write. Measured: `var(--x); color: red`
 * passed through emits two declarations where one was asked for, with no parse error
 * and a surviving containment sentinel — nothing downstream sees it. `var(--x) } .x
 * {` opens a second RULE, and `var(--x` takes the whole document. Requiring the
 * opening call to close on the last character keeps the branch to the shape it was
 * added for; anything else is refused by name rather than quoted, because quoting it
 * would mint a family nobody has and render the wrong font in silence.
 */
function isCompleteCall(member: string): boolean {
    if (!FUNCTION.test(member)) return false;
    let depth = 0;
    let quoteChar: string | null = null;
    for (let index = 0; index < member.length; index++) {
        const char = member[index];
        if (quoteChar !== null) {
            if (char === '\\') index++;
            else if (char === quoteChar) quoteChar = null;
            continue;
        }
        if (char === '"' || char === "'") quoteChar = char;
        else if (char === '(') depth++;
        else if (char === ')') {
            depth--;
            if (depth === 0) return index === member.length - 1;
            if (depth < 0) return false;
        }
    }
    return false;
}

/**
 * A `font-family` value → the text that goes into the declaration.
 *
 * Exported because a consumer that has been quoting defensively (see the incident in
 * the header) can call this instead and stop, and because both routes into the
 * partition — a `style={{ fontFamily }}` object and a `font-*` utility resolving
 * against `tokens.fontFamily` — must go through exactly this one function.
 */
export function serialiseFontFamily(value: string): string {
    const list = members(value);
    const whole = list.length === 1;
    return list
        .map((member) => {
            const name = member.trim();
            if (name === '') {
                throw new UnknownUtilityError(
                    value,
                    'is a font-family list with an empty member. GTK answers a missing family with "Expected a string" ' +
                        'and drops the whole declaration, so the list is refused here instead',
                );
            }
            if (QUOTED.test(name)) return name;
            if (FUNCTION.test(name)) {
                if (isCompleteCall(name)) return name;
                throw new UnknownUtilityError(
                    value,
                    'opens a function the member never closes. A function is the one member handed to GTK verbatim, ' +
                        'so an unclosed one emits declaration text this module did not write — measured, ' +
                        '"var(--x); color: red" emits a second declaration with no parse error at all',
                );
            }
            const keyword = name.toLowerCase();
            if (GENERIC_FAMILIES.has(keyword)) return name;
            if (whole && CSS_WIDE_KEYWORDS.has(keyword)) return name;
            return quote(name);
        })
        .join(', ');
}

/**
 * What GTK does with an authored value that was NOT serialised.
 *
 * Three states rather than a boolean, and the third one is why. `refused` is the
 * loud bug — GTK rejects the declaration, the containment probe rejects the rule,
 * and the screen is gone. `misread` is the QUIET one: GTK accepts the bare text and
 * resolves a DIFFERENT family, so the application renders in a substituted font with
 * no diagnostic anywhere. A boolean column would have merged `misread` into
 * `accepted` and asserted that serialising changes nothing — which is false for
 * exactly the vectors where changing something is the whole point.
 */
export type BareReading = 'refused' | 'accepted' | 'misread';

/** One authored `font-family` value, what it must become, and what GTK does with it unserialised. */
export interface FontFamilyVector {
    /** What a `tokens.fontFamily` entry or a `style={{ fontFamily }}` carries. */
    readonly authored: string;
    /** What {@link serialiseFontFamily} must emit for it. */
    readonly emitted: string;
    /**
     * What GTK does with `authored` AS IT STANDS.
     *
     * The column that makes this table a test rather than a restatement, and every
     * state of it is RE-MEASURED against the running GTK by `gtk-css.spec.ts`:
     * `refused` must be rejected, `accepted` must parse to the same computed value
     * as `emitted`, and `misread` must parse to a DIFFERENT one. So the state is a
     * finding and not a claim, and a vector cannot quietly stop exercising the rule.
     */
    readonly bare: BareReading;
}

/**
 * The conformance set for `font-family` values.
 *
 * WHY THIS TABLE EXISTS, and it is the whole finding behind #1539. `gtk-css.ts`
 * probed `['font-family', 'Cantarell']` — ONE word, valid as a bare identifier, and
 * therefore the single family for which the missing quoting is invisible. The suite
 * asserted that `font-family` is emitted and never that it is emitted CORRECTLY, so
 * it would have gone green against an implementation that quoted nothing. A vector
 * whose value cannot exercise the rule reads exactly like a vector that passed.
 *
 * So the set carries, deliberately: a family that NEEDS quoting, a family that does
 * not, a bare multi-identifier family GTK already accepted (the case a
 * quote-on-space reading would call broken), a stack mixing a quoted family with a
 * bare keyword, a value already quoted, a `var()` reference, and a value GTK MISREADS
 * rather than refuses. `bare` is re-measured by `gtk-css.spec.ts`, which also refuses
 * a table that has lost its refused or its misread vectors.
 *
 * The three added after the first review are the shapes the SPLIT and the two
 * PASSTHROUGHS have to survive rather than the quoter: a bare name carrying an odd
 * quote character in front of a fallback, a nested `var()`, and an already-quoted
 * member holding a carriage return. Each was emitted as something GTK accepted and
 * was wrong about — so `gtk-css.spec.ts` also holds the three CLASSES directly, by
 * asking GTK where the fallback member ended up, whether the document survived, and
 * whether a declaration appeared that nothing here wrote.
 */
export const FONT_FAMILY_VECTORS: readonly FontFamilyVector[] = [
    // THE REPORTED FAILURE. `3` is not an identifier, so the sequence ends there and
    // everything after it is junk.
    { authored: 'Source Sans 3', emitted: '"Source Sans 3"', bare: 'refused' },
    // The same shape from three more directions: another digit-led component, a
    // leading digit on the FIRST component (GTK says `Expected a string` rather than
    // `Junk at end of value`), and a character no identifier can hold.
    { authored: 'M PLUS 1p', emitted: '"M PLUS 1p"', bare: 'refused' },
    { authored: '8514oem', emitted: '"8514oem"', bare: 'refused' },
    { authored: 'Foo.Bar', emitted: '"Foo.Bar"', bare: 'refused' },
    // NEEDS NOTHING, and it is the vector the old table consisted of.
    { authored: 'Cantarell', emitted: '"Cantarell"', bare: 'accepted' },
    // MORE THAN ONE WORD AND ALREADY FINE — the pair that disproves "quote when
    // there is a space" and keeps this from being a fix aimed at the wrong rule.
    { authored: 'Fira Code', emitted: '"Fira Code"', bare: 'accepted' },
    { authored: 'Liberation Serif', emitted: '"Liberation Serif"', bare: 'accepted' },
    // KEYWORDS, bare and staying bare.
    { authored: 'sans-serif', emitted: 'sans-serif', bare: 'accepted' },
    { authored: 'monospace', emitted: 'monospace', bare: 'accepted' },
    { authored: 'system-ui', emitted: 'system-ui', bare: 'accepted' },
    // Case-insensitively, because CSS keywords are.
    { authored: 'Sans-Serif', emitted: 'Sans-Serif', bare: 'accepted' },
    // A CSS-wide keyword, which is a keyword only as the whole value.
    { authored: 'inherit', emitted: 'inherit', bare: 'accepted' },
    // A FALLBACK STACK: the quoting is per member, and the commas survive.
    { authored: 'Source Sans 3, sans-serif', emitted: '"Source Sans 3", sans-serif', bare: 'refused' },
    { authored: "'Source Sans 3', sans-serif", emitted: "'Source Sans 3', sans-serif", bare: 'accepted' },
    {
        authored: 'Fira Code, ui-monospace, monospace',
        emitted: '"Fira Code", ui-monospace, monospace',
        bare: 'accepted',
    },
    // ALREADY QUOTED, in both spellings, and left exactly as written.
    { authored: '"Source Sans 3"', emitted: '"Source Sans 3"', bare: 'accepted' },
    { authored: "'Noto Sans'", emitted: "'Noto Sans'", bare: 'accepted' },
    // A quoted family whose NAME contains a comma. Splitting on every comma would
    // tear this in half.
    { authored: '"Foo, Bar", sans-serif', emitted: '"Foo, Bar", sans-serif', bare: 'accepted' },
    // AN ODD QUOTE CHARACTER IN A BARE NAME, in front of a fallback. A bare member is
    // a name supplied verbatim, so the `'` is a character of it and the comma after
    // it still separates — but a split that opened a string at every quote never
    // reached that comma, emitted `"Marion's Hand, sans-serif"` as ONE family, and
    // GTK accepted it without a word. The fallback was gone with no diagnostic.
    { authored: "Marion's Hand, sans-serif", emitted: '"Marion\'s Hand", sans-serif', bare: 'refused' },
    // A `var()` reference, including the fallback form whose comma is INSIDE the
    // parentheses, and the nested form that needs the depth counter rather than a
    // flag. Quoting any of them would emit a family nobody has, silently.
    { authored: 'var(--font-sans)', emitted: 'var(--font-sans)', bare: 'accepted' },
    { authored: 'var(--font-sans, sans-serif)', emitted: 'var(--font-sans, sans-serif)', bare: 'accepted' },
    {
        authored: 'var(--a, var(--b, sans-serif))',
        emitted: 'var(--a, var(--b, sans-serif))',
        bare: 'accepted',
    },
    // A name that has to be ESCAPED rather than merely wrapped. An ident sequence
    // cannot also contain a string, so GTK refuses this one.
    { authored: 'Say "Ah"', emitted: '"Say \\"Ah\\""', bare: 'refused' },
    // THE TWO QUIET ONES, and they are why `bare` is not a boolean. Both were
    // MEASURED here after the table first claimed GTK refuses them, and it does not:
    //
    //   - `Back\slash` bare is the CSS escape for the identifier `Backslash`, so GTK
    //     accepts it and looks for a family that is not the one that was named.
    //   - a raw newline is WHITESPACE outside a string, so `Two⏎Lines` bare is the
    //     ident sequence `Two Lines`. Inside a string the same byte is
    //     `Unterminated block at end of document` — the failure that takes every rule
    //     after it and is reported by nothing but the containment probe — which is
    //     why the escaped `\a ` form is what gets emitted.
    //
    // Neither produces a diagnostic unserialised. They are the shape the whole
    // partition exists against: green run, wrong window.
    { authored: 'Back\\slash', emitted: '"Back\\\\slash"', bare: 'misread' },
    { authored: 'Two\nLines', emitted: '"Two\\a Lines"', bare: 'misread' },
    // THE SAME BYTE, ALREADY QUOTED — and CSS's newline is three characters, not one.
    // A carriage return inside a quoted member matched the passthrough while only
    // `\n` was excluded, so it went out verbatim and GTK answered `Expected a string`
    // plus `Unterminated block at end of document`: the containment sentinel gone and
    // every rule after it with it. It is a vector because the passthrough branch had
    // none carrying a character that ends a string.
    { authored: '"Two\rLines"', emitted: '"\\"Two\\d Lines\\""', bare: 'refused' },
];
