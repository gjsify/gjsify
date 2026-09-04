// The measured CSS table, re-measured against the GTK that is running.
//
// `gtk-css.ts` is a claim about another program. Committing it as data is what makes
// the partition testable without a display, but data that nothing re-checks is a
// claim that decays: a GTK upgrade that adds `text-align` or removes `line-height`
// would leave the table describing a version nobody runs, and the partition would go
// on emitting declarations GTK drops in silence.
//
// So this asserts BOTH directions against a real `Gtk.CssProvider`. The negative
// direction is the load-bearing one: without it the table could list every property
// in CSS and still pass.

import Gtk from 'gi://Gtk?version=4.0';
import { expect, it, on } from '@gjsify/unit';

import { FONT_FAMILY_VECTORS, serialiseFontFamily } from './font-family.js';
import { GTK_CSS_PROBES, NOT_GTK_CSS } from './gtk-css.js';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { installDiagnosticsGate } from '../conformance/index.js';

/** Load one declaration and report the parser's own verdict. */
function parseError(property: string, value: string): string | null {
    const provider = new Gtk.CssProvider();
    let message: string | null = null;
    const handler = provider.connect('parsing-error', (_provider, _section, error) => {
        message = error.message;
    });
    provider.load_from_string(`.probe { ${property}: ${value}; }`);
    provider.disconnect(handler);
    return message;
}

/**
 * What GTK computes for one declaration, in GTK's OWN spelling.
 *
 * The parsed value read back out, which is what makes an equivalence claim a
 * measurement rather than a restatement of our expectation: `Fira Code` and
 * `"Fira Code"` both come back as `font-family: "Fira Code"`, so serialising
 * provably did not change what the widget will be painted with.
 */
function normalised(property: string, value: string): string {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(`.probe { ${property}: ${value}; }`);
    return provider.to_string().replace(/\s+/g, ' ').trim();
}

/** A class name that cannot collide, so its survival means the parse reached the end. */
const SENTINEL = 'gjsify-css-spec-sentinel';

/**
 * Does a rule carrying this declaration leave the rules AFTER it loadable?
 *
 * `parseError` is not the same question, and the gap is the expensive one: an
 * unterminated string ends the DOCUMENT, and `document.ts` records a measured case
 * where GTK reported no error at all while everything after was gone. Same shape as
 * the runtime's containment probe, on one declaration rather than a whole sheet —
 * its own sentinel, because what is being asserted is that the parse reached the
 * end, not that the two spellings agree.
 */
function contained(property: string, value: string): boolean {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(`.probe { ${property}: ${value}; }\n.${SENTINEL} { color: rgb(1 2 3); }`);
    return provider.to_string().includes(SENTINEL);
}

/**
 * The `font-family` value GTK computed, in GTK's own spelling.
 *
 * Read back out rather than counted in the serialiser, because how many members the
 * serialiser thinks it made is the thing under test. Sound only for values whose
 * names carry no semicolon — GTK does not escape one inside a string.
 */
function computedFamily(value: string): string {
    const computed = /font-family:\s*([^;]*);/.exec(normalised('font-family', value));
    return computed === null ? '' : computed[1];
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'the measured GTK CSS table', async () => {
            await it('GTK accepts every property the table claims it accepts', async () => {
                const rejected = GTK_CSS_PROBES.filter(([property, value]) => parseError(property, value) !== null).map(
                    ([property, value]) => `${property}: ${value}`,
                );
                expect(rejected).toStrictEqual([]);
            });

            await it('GTK refuses every property the table claims it refuses', async () => {
                // Without this direction the table could name every property in CSS
                // and the test above would still pass — which is the shape of a gate
                // that looks alive and checks nothing.
                const accepted = NOT_GTK_CSS.filter(([property, value]) => parseError(property, value) === null).map(
                    ([property, value]) => `${property}: ${value}`,
                );
                expect(accepted).toStrictEqual([]);
            });

            await it('reports text-align as absent, which is the one that reads like paint', async () => {
                // Called out on its own because it is the property most likely to be
                // grouped with `color` and `font-size` by anyone reading a `text-*`
                // utility family, and GTK drops it without a word.
                const error = parseError('text-align', 'center');
                expect(error === null).toBe(false);
                expect(String(error)).toContain('text-align');
            });

            await it('parses every serialised font-family value the table carries, and CONTAINS it', async () => {
                // The property name was never the problem in #1539: `font-family` is
                // right and the VALUE took the rule down. So the value gets the same
                // treatment the names get — measured against the running parser.
                //
                // Containment is the second half and it is not the same question. A
                // raw carriage return inside an already-quoted member matched the
                // passthrough while only `\n` was excluded, went out verbatim, and
                // ended the DOCUMENT — and `document.ts` has a measured case of that
                // happening with no error signal at all. An emitted value that parses
                // and takes the rest of the sheet with it is still a bug.
                const rejected = FONT_FAMILY_VECTORS.filter(
                    (vector) => parseError('font-family', vector.emitted) !== null,
                ).map((vector) => `${vector.authored} -> ${vector.emitted}`);
                expect(rejected).toStrictEqual([]);
                const uncontained = FONT_FAMILY_VECTORS.filter(
                    (vector) => !contained('font-family', vector.emitted),
                ).map((vector) => `${vector.authored} -> ${vector.emitted}`);
                expect(uncontained).toStrictEqual([]);
            });

            await it('never emits a value that ends the document, however the newline is spelled', async () => {
                // THE OTHER CLASS, and the expensive one. A raw newline inside a
                // string is an unterminated string, which ends the DOCUMENT — every
                // rule after it silently absent, and `document.ts` records a measured
                // case of GTK reporting no error at all. `quote` escapes the
                // character; the already-quoted PASSTHROUGH did not, and its guard
                // excluded only `\n` while CSS's newline is three characters
                // (Syntax 3 § 4.2). A carriage return in a defensively quoted token
                // was the whole sheet.
                //
                // Generated over the three characters rather than listed as vectors,
                // because the table can only carry the spellings someone thought of
                // and the failure is the same for all three.
                const NEWLINES = ['\n', '\r', '\f'];
                const uncontained = NEWLINES.flatMap((newline) => [
                    `Two${newline}Lines`,
                    `"Two${newline}Lines"`,
                    `'Two${newline}Lines'`,
                ])
                    .filter((authored) => !contained('font-family', serialiseFontFamily(authored)))
                    .map((authored) => JSON.stringify(authored));
                expect(uncontained).toStrictEqual([]);
            });

            await it('never loses a fallback member, whatever the name in front of it carries', async () => {
                // THE CLASS, not the three instances. Every fix here so far has been a
                // vector added after the fact; this asks GTK the question the table
                // can only answer one row at a time — put a name in front of a
                // fallback, and check that GTK still ends up with the fallback AS ITS
                // OWN MEMBER (`…, "sans-serif"`, GTK's spelling of the parsed
                // keyword) rather than swallowed into the name.
                //
                // Counting commas would NOT do it, which is worth saying because it
                // was the first attempt and it went green against the bug: the
                // swallowed value is `"Marion's Hand, sans-serif"` and the comma is
                // still there, inside the string. The separator has to be read where
                // GTK puts it, not counted.
                //
                // The bug it holds is silent by construction: a split that opened a
                // string at every quote never reached the comma after
                // `Marion's Hand`, so the whole value went out as one quoted family,
                // GTK accepted it, the containment probe accepted it, and the
                // application lost its fallback with no diagnostic anywhere. Any
                // character that has ever ended a value early belongs in this list.
                const NAMES = [
                    "Marion's Hand",
                    'Say "Ah',
                    'Foo\\"',
                    'Back\\slash',
                    'Source Sans 3',
                    'Foo.Bar',
                    'Foo (Bold)',
                    'M PLUS 1p',
                    '8514oem',
                ];
                const lost = NAMES.map((name) => ({
                    name,
                    computed: computedFamily(serialiseFontFamily(`${name}, sans-serif`)),
                }))
                    .filter((measured) => !measured.computed.endsWith(', "sans-serif"'))
                    .map((measured) => `${JSON.stringify(measured.name)} -> ${measured.computed}`);
                expect(lost).toStrictEqual([]);
            });

            await it('never lets a value add a declaration the partition did not write', async () => {
                // THE THIRD CLASS, and it belongs to the two PASSTHROUGH branches: a
                // member that goes out verbatim is declaration text nothing here
                // wrote. Measured on the function branch — `var(--x); color: red`
                // emitted a second declaration with NO parse error and a surviving
                // containment sentinel, so every guard downstream saw a valid sheet.
                //
                // Asked of each member shape rather than of the one that broke, and
                // asked of GTK: append a declaration to the value and check GTK does
                // not come back with it. A named refusal is a pass — being loud is
                // the point; emitting the extra declaration is the bug.
                //
                // The payload is looked for in GTK's PARSED spelling, `rgb(255,0,0)`,
                // and that is the load-bearing part. Searching for the authored text
                // matches the harmless case too — a quoted family called
                // `Cantarell; color: rgb(255 0 0)` still contains every character of
                // the payload — so the gate went red against the fixed code on its
                // first run. Only a colour GTK actually parsed loses the spaces.
                const PAYLOAD = '; color: rgb(255 0 0)';
                const PARSED = 'rgb(255,0,0)';
                const SHAPES = ['Cantarell', '"Cantarell"', "'Cantarell'", 'var(--font-sans)', 'sans-serif', 'inherit'];
                const injected = SHAPES.filter((shape) => {
                    let emitted: string;
                    try {
                        emitted = serialiseFontFamily(`${shape}${PAYLOAD}`);
                    } catch {
                        // `serialiseFontFamily` refuses by name — the loud answer, and
                        // the one the function branch now gives. Nothing was emitted,
                        // so nothing was injected.
                        return false;
                    }
                    return normalised('font-family', emitted).includes(PARSED);
                });
                expect(injected).toStrictEqual([]);
            });

            await it('agrees with the table about what it does with each value UNSERIALISED', async () => {
                // `bare` is a claim about another program, so all three of its states
                // are re-measured here rather than trusted. It also records a finding
                // the issue got wrong: a bare SEQUENCE of identifiers is legal CSS
                // and GTK implements it, so `Fira Code` and `Liberation Serif` parse
                // unquoted and only a component that is not an identifier — usually
                // one starting with a digit — is refused.
                //
                // `misread` is the state that had to exist. Two vectors the table
                // first called `refused` are in fact ACCEPTED and resolve a different
                // family: `Back\slash` is the escape for the ident `Backslash`, and a
                // raw newline is whitespace, so `Two⏎Lines` is the ident sequence
                // `Two Lines`. Serialising MUST change what GTK computes for those,
                // which is the opposite of what it must do for `accepted`.
                const disagreed = FONT_FAMILY_VECTORS.filter((vector) => {
                    const parses = parseError('font-family', vector.authored) === null;
                    if (!parses) return vector.bare !== 'refused';
                    const same =
                        normalised('font-family', vector.authored) === normalised('font-family', vector.emitted);
                    return vector.bare !== (same ? 'accepted' : 'misread');
                }).map((vector) => `${JSON.stringify(vector.authored)} (table says ${vector.bare})`);
                expect(disagreed).toStrictEqual([]);
            });

            await it('still carries a value GTK refuses AND one it misreads, so the set can fail', async () => {
                // THE DISCRIMINATOR, and the reason this whole table exists. The old
                // vector was `['font-family', 'Cantarell']` — one word, valid as a
                // bare identifier, and therefore the single family for which the
                // missing quoting is invisible. The suite asserted that font-family
                // is emitted and never that it is emitted correctly, so it would have
                // gone green against an implementation that quoted nothing.
                //
                // A vector whose value cannot exercise the rule reads exactly like a
                // vector that passed, so the SET is held here instead of trusted. BOTH
                // bug shapes are required: `refused` is the loud one that took the
                // screen down, `misread` is the quiet one that renders the wrong font
                // at exit 0 — and a table reduced to `accepted` rows would look
                // exactly like a table that is testing something.
                const byState = (state: string): readonly string[] =>
                    FONT_FAMILY_VECTORS.filter((vector) => vector.bare === state).map((vector) => vector.authored);
                expect(byState('refused')).toContain('Source Sans 3');
                expect(byState('misread').length > 0).toBe(true);
            });

            await it('accepts the PHYSICAL spacings and refuses the LOGICAL ones, in one place', async () => {
                // The pair the layout half is built on, asserted together because the
                // decision is the CONTRAST rather than either half: `ml-*` has to go
                // through CSS and `ms-*` cannot, and a table that listed only one
                // side would read as an oversight rather than as a constraint.
                const physical = ['margin-left', 'margin-right', 'padding-left', 'padding-right'];
                const logical = ['margin-start', 'margin-end', 'padding-start', 'padding-end'];
                expect(physical.filter((property) => parseError(property, '8px') !== null)).toStrictEqual([]);
                expect(logical.filter((property) => parseError(property, '8px') === null)).toStrictEqual([]);
            });
        });
    });
};
