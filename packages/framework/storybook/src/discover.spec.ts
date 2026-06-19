// collectStoryModules — pure module-namespace flattening. GTK-free.

import { describe, expect, it } from '@gjsify/unit';
import { collectStoryModules } from './discover.js';

export default async () => {
    await describe('collectStoryModules', async () => {
        await it('collects StoryModule-shaped exports regardless of name', async () => {
            const nsA = { FooStories: { stories: [] }, helper: 42, FOO: 'x' };
            const nsB = { default: { stories: [], decorators: [] }, BarStories: { stories: [] } };
            const modules = collectStoryModules([nsA, nsB]);
            expect(modules.length).toBe(3);
        });

        await it('ignores exports that are not story modules', async () => {
            const ns = { a: 1, b: 'two', c: { notStories: [] }, d: null, e: () => {} };
            expect(collectStoryModules([ns as Record<string, unknown>]).length).toBe(0);
        });

        await it('tolerates empty input and empty namespaces', async () => {
            expect(collectStoryModules([]).length).toBe(0);
            expect(collectStoryModules([{}]).length).toBe(0);
        });
    });
};
