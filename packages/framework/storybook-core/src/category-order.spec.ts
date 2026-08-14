// @gjsify/storybook-core — sidebar category order tests.
// Runs on GJS + Node + browser (pure TS, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { STORYBOOK_CATEGORY_ORDER, orderCategories } from './category-order.js';

export default async () => {
    await describe('orderCategories', async () => {
        await it('sorts listed categories into the declared order', () => {
            // Deliberately handed in REVERSED, because the defect this replaces
            // was the input order leaking through untouched.
            const input = [...STORYBOOK_CATEGORY_ORDER].reverse();
            expect(orderCategories(input)).toStrictEqual([...STORYBOOK_CATEGORY_ORDER]);
        });

        await it('leads with Overview, whatever position it arrived in', () => {
            // The reported symptom: a glob put Overview fifth, which reads as the
            // gallery being absent rather than as an ordering difference.
            const globOrder = ['Buttons', 'Feedback', 'Layout', 'Navigation', 'Overview', 'Presentation'];
            expect(orderCategories(globOrder)[0]).toBe('Overview');
        });

        await it('keeps a subset in declared order without inventing absent categories', () => {
            expect(orderCategories(['Feedback', 'Buttons', 'Overview'])).toStrictEqual([
                'Overview',
                'Buttons',
                'Feedback',
            ]);
        });

        await it('appends unlisted categories after every listed one', () => {
            expect(orderCategories(['Chrome', 'Buttons', 'Rows'])).toStrictEqual(['Buttons', 'Chrome', 'Rows']);
        });

        await it('keeps unlisted categories in arrival order', () => {
            // Partitioning, not sorting: an unrecognised prefix must not be
            // reordered against its peers just because it is unrecognised.
            expect(orderCategories(['Rows', 'Chrome'])).toStrictEqual(['Rows', 'Chrome']);
            expect(orderCategories(['Chrome', 'Rows'])).toStrictEqual(['Chrome', 'Rows']);
        });

        await it('drops nothing and duplicates nothing', () => {
            const input = ['Feedback', 'Zebra', 'Overview', 'Aardvark', 'Layout'];
            const out = orderCategories(input);
            expect(out.length).toBe(input.length);
            expect([...out].sort()).toStrictEqual([...input].sort());
        });

        await it('does not mutate its argument', () => {
            const input = ['Feedback', 'Overview'];
            orderCategories(input);
            expect(input).toStrictEqual(['Feedback', 'Overview']);
        });

        await it('returns an empty list unchanged', () => {
            expect(orderCategories([])).toStrictEqual([]);
        });
    });

    await describe('STORYBOOK_CATEGORY_ORDER', async () => {
        await it('names each category once', () => {
            expect(new Set(STORYBOOK_CATEGORY_ORDER).size).toBe(STORYBOOK_CATEGORY_ORDER.length);
        });
    });
};
