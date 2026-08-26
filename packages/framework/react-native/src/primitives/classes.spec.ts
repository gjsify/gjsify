// The variant split — pure TypeScript, no GTK, no React.
//
// Small file, and the three NEGATIVES are what make it a test rather than a
// formality: a splitter that accepted a stacked variant, an empty half or a bare
// colon would hand `resolveUtility` an input it answers for the wrong reason —
// `dark:hover:bg-x` would resolve `hover:bg-x` as a utility name and report it as an
// unknown class, which sends the reader to look for a typo that is not there.

import { describe, expect, it } from '@gjsify/unit';

import { splitVariants } from './classes.js';
import { PrimitiveError } from './errors.js';

const threw = (fn: () => unknown): PrimitiveError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof PrimitiveError) return error;
        throw error;
    }
    throw new Error('expected a PrimitiveError, nothing was thrown');
};

export default async () => {
    await describe('the variant split', async () => {
        await it('separates the base group from one group per variant', async () => {
            const groups = splitVariants('flex-1 active:opacity-70 mt-2 active:opacity-60 hover:bg-white', 'View');
            expect(groups.base).toStrictEqual(['flex-1', 'mt-2']);
            expect(groups.variants.active).toStrictEqual(['opacity-70', 'opacity-60']);
            expect(groups.variants.hover).toStrictEqual(['bg-white']);
        });

        await it('splits on any whitespace, not on a single space', async () => {
            // 24 of the measured application's className sites are computed rather
            // than literal, and a template literal across lines produces newlines
            // and runs of spaces. Splitting on ' ' left empty tokens, and an empty
            // token reaching `resolveUtility` reports the empty string as an unknown
            // utility — a diagnostic about the splitter, not about the input.
            expect(splitVariants('  flex-1 \n\t mt-2  ', 'View').base).toStrictEqual(['flex-1', 'mt-2']);
        });

        await it('accepts an array, because a short-circuit leaves false behind', async () => {
            expect(splitVariants(['flex-1', false, null, 'mt-2', undefined], 'View').base).toStrictEqual([
                'flex-1',
                'mt-2',
            ]);
        });

        await it('treats absent and empty as no classes at all', async () => {
            for (const input of [undefined, null, '', '   ', []] as const) {
                const groups = splitVariants(input, 'View');
                expect(groups.base).toStrictEqual([]);
                expect(Object.keys(groups.variants)).toStrictEqual([]);
            }
        });

        // --- the negatives -------------------------------------------------

        await it('refuses a stacked variant instead of guessing a compound selector', async () => {
            const error = threw(() => splitVariants('dark:hover:bg-white', 'View'));
            expect(error.message).toContain('dark:hover:bg-white');
            expect(error.message).toContain('stacks variants');
        });

        await it('refuses a half-written variant, naming the shape it wanted', async () => {
            expect(threw(() => splitVariants('active:', 'View')).message).toContain('one half of this one is empty');
            expect(threw(() => splitVariants(':opacity-70', 'View')).message).toContain(
                'one half of this one is empty',
            );
        });

        await it('names the primitive the author wrote', async () => {
            const error = threw(() => splitVariants('active:', 'Pressable'));
            expect(error.primitive).toBe('Pressable');
            expect(error.message).toContain('<Pressable>');
        });
    });
};
