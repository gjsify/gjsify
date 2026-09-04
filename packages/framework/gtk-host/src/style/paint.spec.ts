// The paint half — pure TypeScript, so it runs without a display or a widget.
//
// That is the point of the seam: the partition's decisions are testable as data,
// and the only thing that needs GTK is the claim about which properties GTK accepts
// (`gtk-css.spec.ts`).

import { describe, expect, it } from '@gjsify/unit';

// THE IMPORTS MOVED WITH THE PARTITION REFACTOR, and nothing else here did. This
// half no longer owns the whole vocabulary: `resolveUtility` (which now tries both
// halves) and `partition` live in `resolve.ts`, the error class in `errors.ts`, and
// what remains here is `resolvePaintUtility` — the same function under a name that
// says which half it is.
import { MINIMAL_TOKENS, type StyleTokens } from './tokens.js';
import { UnknownUtilityError } from './errors.js';
import { CSS_NAME, CSS_VALUE, CSS_VALUE_KIND, partitionPaint, resolvePaintUtility } from './paint.js';
import { partition, resolveUtilities } from './resolve.js';
import { GTK_CSS_PROPERTIES } from './gtk-css.js';
import { FONT_FAMILY_VECTORS, serialiseFontFamily } from './font-family.js';

const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    colors: {
        ...MINIMAL_TOKENS.colors,
        'grey-100': 'rgb(var(--color-grey-100))',
        'grey-700': 'rgb(var(--color-grey-700))',
        emphasis: 'rgb(var(--color-emphasis))',
        'always-dark': 'rgb(var(--color-always-dark))',
    },
    fontSize: { ...MINIMAL_TOKENS.fontSize, s: '13px' },
    letterSpacing: { wide: '0.5px' },
    lineHeight: { snug: '1.3' },
    // Two entries on purpose: one family that is fine bare and one that is not, so
    // the UTILITY route is exercised by a value that can actually fail (#1539).
    fontFamily: { serif: 'Merriweather', display: 'Source Sans 3' },
};

const threw = (fn: () => unknown): UnknownUtilityError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof UnknownUtilityError) return error;
        throw error;
    }
    throw new Error('expected an UnknownUtilityError, nothing was thrown');
};

export default async () => {
    await describe('the paint vocabulary', async () => {
        await it('resolves a colour, a radius, an opacity and a border', async () => {
            expect(resolvePaintUtility('bg-grey-100', TOKENS)).toStrictEqual({
                backgroundColor: 'rgb(var(--color-grey-100))',
            });
            expect(resolvePaintUtility('rounded-md', TOKENS)).toStrictEqual({ borderRadius: '6px' });
            expect(resolvePaintUtility('opacity-70', TOKENS)).toStrictEqual({ opacity: '0.7' });
            expect(resolvePaintUtility('border', TOKENS)).toStrictEqual({ borderWidth: '1px' });
            expect(resolvePaintUtility('border-b', TOKENS)).toStrictEqual({ borderBottomWidth: '1px' });
        });

        await it('lets the SCALES disambiguate text-*, not a hard-coded name list', async () => {
            // The same family answers two questions, and which one it is depends on
            // the project's tokens rather than on anything this file knows.
            expect(resolvePaintUtility('text-s', TOKENS)).toStrictEqual({ fontSize: '13px' });
            expect(resolvePaintUtility('text-grey-700', TOKENS)).toStrictEqual({ color: 'rgb(var(--color-grey-700))' });
        });

        await it('reports a token that is in two scales as ambiguous, rather than picking one', async () => {
            const ambiguous: StyleTokens = { colors: { s: 'red' }, fontSize: { s: '13px' } };
            expect(threw(() => resolvePaintUtility('text-s', ambiguous)).message).toContain('ambiguous');
        });

        await it('composes an alpha modifier through GTK’s own alpha()', async () => {
            // `bg-always-dark/70` is ordinary, and the base colour is a token whose
            // value may be a `var()` expression — so the alpha has to COMPOSE rather
            // than parse the colour apart.
            expect(resolvePaintUtility('bg-always-dark/70', TOKENS)).toStrictEqual({
                backgroundColor: 'alpha(rgb(var(--color-always-dark)), 0.7)',
            });
        });

        await it('refuses an alpha modifier on something that is not a colour', async () => {
            expect(threw(() => resolvePaintUtility('rounded-md/70', TOKENS)).message).toContain('colour');
        });

        await it('names the scale and its contents when a token is missing', async () => {
            // The message has to be actionable: "not in the borderRadius scale" plus
            // what IS in it turns a typo into a one-line fix.
            const error = threw(() => resolvePaintUtility('rounded-huge', TOKENS));
            expect(error.message).toContain('borderRadius');
            expect(error.message).toContain('full');
        });

        await it('hands a family it does not own back, rather than judging it', async () => {
            // CHANGED BY THE REFACTOR, and this is the change: `flex-1` and `mt-2xs`
            // used to throw "belongs to the layout half" from a copy of the layout
            // vocabulary kept in this file. Returning null is what lets the two
            // halves stay ignorant of each other — `resolve.ts` is the only module
            // that knows both said no, so it is the only one that can say "unknown".
            expect(resolvePaintUtility('flex-1', TOKENS)).toBeNull();
            expect(resolvePaintUtility('mt-2xs', TOKENS)).toBeNull();
            expect(resolvePaintUtility('wibble-3', TOKENS)).toBeNull();
            // A family it DOES own, with a token no scale carries, is still ITS error
            // — and keeping that difference is the entire point of the split.
            expect(threw(() => resolvePaintUtility('bg-nonsuch', TOKENS)).message).toContain('colors scale');
        });

        await it('does not claim text alignment, because it reads like paint and is not', async () => {
            // Measured: `No property named "text-align"`. It is a widget property on
            // a widget only the shadow tree can find, so this half hands it back —
            // where it used to throw a bespoke message naming a milestone that has
            // since arrived.
            expect(resolvePaintUtility('text-center', TOKENS)).toBeNull();
            // Still the same family, still settled by the scales.
            expect(resolvePaintUtility('text-s', TOKENS)).toStrictEqual({ fontSize: '13px' });
        });

        await it('refuses a variant rather than silently dropping it', async () => {
            // `active:opacity-70` means "when pressed", which is a pseudo-class the
            // caller has to place. Resolving it as if it were unconditional would
            // paint the pressed style permanently.
            expect(threw(() => resolvePaintUtility('active:opacity-70', TOKENS)).message).toContain('variant');
        });

        await it('lets a later class win, on the property record', async () => {
            // Not by emitting both declarations: GTK resolves equal specificity by
            // SHEET ORDER, not by the order of names in `css-classes`, so "the later
            // class wins" would be false the moment two generated classes met.
            expect(resolveUtilities(['bg-grey-100', 'bg-emphasis'], TOKENS)).toStrictEqual({
                backgroundColor: 'rgb(var(--color-emphasis))',
            });
        });
    });

    await describe('the partition', async () => {
        await it('emits GTK CSS declarations for every paint property', async () => {
            const props = resolveUtilities(['bg-emphasis', 'rounded-full', 'opacity-70', 'text-grey-700'], TOKENS);
            const { css, props: widgetProps, intent } = partition(props);
            expect(css.includes('background-color: rgb(var(--color-emphasis))')).toBe(true);
            expect(css.includes('border-radius: 9999px')).toBe(true);
            expect(css.includes('opacity: 0.7')).toBe(true);
            expect(css.includes('color: rgb(var(--color-grey-700))')).toBe(true);
            // The layout half is empty here, and saying so is part of the contract.
            expect(widgetProps).toStrictEqual({});
            expect(intent).toStrictEqual({});
        });

        await it('sends border-style: solid along with a width, and only then', async () => {
            // The append at the end of `partitionPaint` had NO assertion at all, and
            // it is the one behaviour in this file that is invisible when it breaks:
            // CSS's initial `border-style` is `none`, `none` zeroes the width, and a
            // width-only rule therefore paints nothing and occupies nothing.
            // MEASURED on GTK 4.22.4, a Gtk.Box rooted in a window: `border-width:
            // 4px` alone measures what no border at all measures — 0x0 empty, 9x18
            // holding a Label('x') — while `+ border-style: solid` adds 4 px per
            // edge on both shapes.
            expect(partition({ borderWidth: '4px' }).css).toStrictEqual(['border-width: 4px', 'border-style: solid']);
            // Per edge as well: the condition is keyed on the border-*-width family,
            // not on the shorthand, because `border-b` is the utility people reach
            // for first and it would be the silent one.
            expect(partition({ borderBottomWidth: '1px' }).css).toStrictEqual([
                'border-bottom-width: 1px',
                'border-style: solid',
            ]);
            // And through the class route, which is how it actually arrives.
            expect(partition(resolveUtilities(['border-b'], TOKENS)).css).toStrictEqual([
                'border-bottom-width: 1px',
                'border-style: solid',
            ]);
            // THE CONTROL, and it is what makes the three above mean anything: an
            // implementation that appended the style unconditionally satisfies all of
            // them, and would put a border on every generated class in the sheet.
            expect(partition({ backgroundColor: 'red' }).css).toStrictEqual(['background-color: red']);
        });

        await it('refuses a property it does not route, instead of dropping it', async () => {
            // The silence this whole file exists against: an unrouted property that
            // simply vanishes leaves the widget unpainted and the run green.
            //
            // The VECTOR changed with the refactor — `textAlign` is a property the
            // partition routes now, to an intent — so the probe is a React Native
            // property nothing has mapped yet, which is the case that actually
            // matters: a `style={{…}}` object has no class name to check.
            expect(threw(() => partition({ zIndex: '1' } as never)).message).toContain(
                'not a property the style partition routes',
            );
        });

        await it('serialises a font family, by both routes into the partition', async () => {
            // THE REPORTED FAILURE (#1539). `font-family: Source Sans 3` is refused
            // by GTK in full — `Junk at end of value for font-family` — so the
            // containment probe refuses the generated rule and a React tree dies
            // with no boundary between the `<Text>` and the screen.
            //
            // Asserted through BOTH front ends because they are two routes to one
            // emitter and a fix at either front end would leave the other one broken:
            // a `style={{ fontFamily }}` object, and a `font-*` utility whose token
            // resolves to the same value.
            expect(partition({ fontFamily: 'Source Sans 3' }).css).toStrictEqual(['font-family: "Source Sans 3"']);
            expect(partition(resolveUtilities(['font-display'], TOKENS)).css).toStrictEqual([
                'font-family: "Source Sans 3"',
            ]);
            // THE CONTROL: the other `font-*` half still answers a weight, which is
            // a number and is not serialised.
            expect(partition(resolveUtilities(['font-bold'], TOKENS)).css).toStrictEqual(['font-weight: 700']);
        });

        await it('emits every vector in the conformance set exactly as the set says', async () => {
            // The pure half of the mechanism. `gtk-css.spec.ts` holds the other half
            // — that each `emitted` parses, that the `bare` column is what the
            // running GTK actually does, and that the set still contains a value GTK
            // refuses and one it misreads.
            //
            // THE KEYWORD RULE LIVES HERE AND CANNOT LIVE THERE. GTK has no
            // generic-family concept — its serialiser answers bare `sans-serif` with
            // `"sans-serif"` — so an implementation that quoted keywords passes every
            // GTK-side assertion. The `emitted` column is the only thing that sees
            // it, and it is kept because what this emits is CSS, where a quoted
            // keyword is a family name and no longer a keyword.
            const wrong = FONT_FAMILY_VECTORS.filter(
                (vector) => serialiseFontFamily(vector.authored) !== vector.emitted,
            ).map(
                (vector) =>
                    `${JSON.stringify(vector.authored)} -> ${JSON.stringify(serialiseFontFamily(vector.authored))}`,
            );
            expect(wrong).toStrictEqual([]);
            // And through the emitter rather than only the function, because the
            // wiring is the half a consumer meets.
            const unwired = FONT_FAMILY_VECTORS.filter(
                (vector) => partitionPaint({ fontFamily: vector.authored })[0] !== `font-family: ${vector.emitted}`,
            ).map((vector) => vector.authored);
            expect(unwired).toStrictEqual([]);
        });

        await it('refuses a font-family list with an empty member instead of emitting one', async () => {
            // GTK answers a missing family with `Expected a string` and drops the
            // declaration, so a trailing comma in a token would cost the whole rule.
            expect(threw(() => serialiseFontFamily('Cantarell,')).message).toContain('empty member');
            expect(threw(() => serialiseFontFamily('Cantarell, , sans-serif')).message).toContain('empty member');
        });

        await it('refuses a function the member never closes, rather than passing it through', async () => {
            // A function is the ONE member handed to GTK verbatim, so it is the one
            // member that can carry declaration text this module did not write.
            // Measured: `var(--x); color: red` emits a SECOND declaration, with no
            // parse error and a surviving containment sentinel — the whole guard
            // chain sees a valid sheet. `var(--x) } .x {` opens another RULE, and the
            // unterminated `var(--x` ends the document.
            //
            // Refused rather than quoted, because quoting it would mint a family
            // nobody has and render the wrong font in silence — the loud half of the
            // same choice `bare: 'misread'` exists to record.
            expect(threw(() => serialiseFontFamily('var(--x); color: red')).message).toContain('never closes');
            expect(threw(() => serialiseFontFamily('var(--x) } .injected { color: red')).message).toContain(
                'never closes',
            );
            expect(threw(() => serialiseFontFamily('var(--x')).message).toContain('never closes');
            // THE CONTROL: a call that does close is passed through untouched,
            // nesting included.
            expect(serialiseFontFamily('var(--a, var(--b, sans-serif))')).toBe('var(--a, var(--b, sans-serif))');
        });

        await it('gives every NAME-valued property a serialiser, and only those', async () => {
            // THE MECHANISM, not the fix. `font-family` was reachable with an
            // unserialised value because nothing recorded that its value is a NAME
            // while every other paint value is a colour, a length, a number or a
            // keyword. Declaring the kind makes the next such property impossible to
            // add quietly: the key set is `keyof PaintProps`, so it cannot be
            // skipped, and this holds the two sets against each other.
            const nameValued = Object.entries(CSS_VALUE_KIND)
                .filter(([, kind]) => kind === 'name')
                .map(([property]) => property)
                .sort();
            expect(nameValued).toStrictEqual(Object.keys(CSS_VALUE).sort());
            expect(nameValued).toContain('fontFamily');
        });

        await it('maps every property onto a CSS name GTK actually accepts', async () => {
            // The INVARIANT, asserted directly. `partition` also guards it per call,
            // but that branch is unreachable while the table is correct — so a test
            // driving it would be testing a path no input can reach. This one fails
            // the moment someone adds a mapping to a property GTK drops in silence,
            // which is the edit the guard exists for.
            const unaccepted = Object.entries(CSS_NAME).filter(([, name]) => !GTK_CSS_PROPERTIES.has(name));
            expect(unaccepted).toStrictEqual([]);
        });
    });
};
