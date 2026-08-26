// The paint half — pure TypeScript, so it runs without a display or a widget.
//
// That is the point of the seam: the partition's decisions are testable as data,
// and the only thing that needs GTK is the claim about which properties GTK accepts
// (`gtk-css.spec.ts`).

import { describe, expect, it } from '@gjsify/unit';

import { MINIMAL_TOKENS, type StyleTokens } from './tokens.js';
import { CSS_NAME, UnknownUtilityError, partition, resolveUtilities, resolveUtility } from './paint.js';
import { GTK_CSS_PROPERTIES } from './gtk-css.js';

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
    fontFamily: { serif: 'Merriweather' },
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
            expect(resolveUtility('bg-grey-100', TOKENS)).toStrictEqual({
                backgroundColor: 'rgb(var(--color-grey-100))',
            });
            expect(resolveUtility('rounded-md', TOKENS)).toStrictEqual({ borderRadius: '6px' });
            expect(resolveUtility('opacity-70', TOKENS)).toStrictEqual({ opacity: '0.7' });
            expect(resolveUtility('border', TOKENS)).toStrictEqual({ borderWidth: '1px' });
            expect(resolveUtility('border-b', TOKENS)).toStrictEqual({ borderBottomWidth: '1px' });
        });

        await it('lets the SCALES disambiguate text-*, not a hard-coded name list', async () => {
            // The same family answers two questions, and which one it is depends on
            // the project's tokens rather than on anything this file knows.
            expect(resolveUtility('text-s', TOKENS)).toStrictEqual({ fontSize: '13px' });
            expect(resolveUtility('text-grey-700', TOKENS)).toStrictEqual({ color: 'rgb(var(--color-grey-700))' });
        });

        await it('reports a token that is in two scales as ambiguous, rather than picking one', async () => {
            const ambiguous: StyleTokens = { colors: { s: 'red' }, fontSize: { s: '13px' } };
            expect(threw(() => resolveUtility('text-s', ambiguous)).message).toContain('ambiguous');
        });

        await it('composes an alpha modifier through GTK’s own alpha()', async () => {
            // `bg-always-dark/70` is ordinary, and the base colour is a token whose
            // value may be a `var()` expression — so the alpha has to COMPOSE rather
            // than parse the colour apart.
            expect(resolveUtility('bg-always-dark/70', TOKENS)).toStrictEqual({
                backgroundColor: 'alpha(rgb(var(--color-always-dark)), 0.7)',
            });
        });

        await it('refuses an alpha modifier on something that is not a colour', async () => {
            expect(threw(() => resolveUtility('rounded-md/70', TOKENS)).message).toContain('colour');
        });

        await it('names the scale and its contents when a token is missing', async () => {
            // The message has to be actionable: "not in the borderRadius scale" plus
            // what IS in it turns a typo into a one-line fix.
            const error = threw(() => resolveUtility('rounded-huge', TOKENS));
            expect(error.message).toContain('borderRadius');
            expect(error.message).toContain('full');
        });

        await it('tells a layout utility apart from a typo', async () => {
            // Both throw. Only one of them sends the reader looking for a spelling
            // mistake that is not there.
            expect(threw(() => resolveUtility('flex-1', TOKENS)).message).toContain('layout half');
            expect(threw(() => resolveUtility('mt-2xs', TOKENS)).message).toContain('layout half');
            expect(threw(() => resolveUtility('bg-nonsuch', TOKENS)).message).toContain('colors scale');
            expect(threw(() => resolveUtility('wibble-3', TOKENS)).message).toContain(
                'not a utility this vocabulary declares',
            );
        });

        await it('refuses text-align by name, because it reads like paint and is not', async () => {
            const error = threw(() => resolveUtility('text-center', TOKENS));
            expect(error.message).toContain('not GTK CSS');
            expect(error.message).toContain('xalign');
        });

        await it('refuses a variant rather than silently dropping it', async () => {
            // `active:opacity-70` means "when pressed", which is a pseudo-class the
            // caller has to place. Resolving it as if it were unconditional would
            // paint the pressed style permanently.
            expect(threw(() => resolveUtility('active:opacity-70', TOKENS)).message).toContain('variant');
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

        await it('refuses a property it does not route, instead of dropping it', async () => {
            // The silence this whole file exists against: an unrouted property that
            // simply vanishes leaves the widget unpainted and the run green.
            expect(threw(() => partition({ textAlign: 'center' } as never)).message).toContain(
                'not a property the paint partition routes',
            );
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
