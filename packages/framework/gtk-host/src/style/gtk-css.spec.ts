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

import { FONT_FAMILY_VECTORS } from './font-family.js';
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

            await it('parses every serialised font-family value the table carries', async () => {
                // The property name was never the problem in #1539: `font-family` is
                // right and the VALUE took the rule down. So the value gets the same
                // treatment the names get — measured against the running parser.
                const rejected = FONT_FAMILY_VECTORS.filter(
                    (vector) => parseError('font-family', vector.emitted) !== null,
                ).map((vector) => `${vector.authored} -> ${vector.emitted}`);
                expect(rejected).toStrictEqual([]);
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
