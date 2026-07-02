// Coverage for the "did you mean …?" helper used by `gjsify workspace` when
// an unknown workspace / script name is passed.

import { describe, expect, it } from '@gjsify/unit';
import { editDistance, suggestClosest } from './suggest.js';

export default async () => {
    await describe('editDistance', async () => {
        await it('is 0 for identical strings', () => {
            expect(editDistance('abc', 'abc')).toBe(0);
        });

        await it('counts single edits', () => {
            expect(editDistance('kitten', 'sitting')).toBe(3);
            expect(editDistance('', 'abc')).toBe(3);
            expect(editDistance('abc', '')).toBe(3);
        });
    });

    await describe('suggestClosest', async () => {
        const workspaces = ['@gjsify/cli', '@gjsify/fetch', '@gjsify/adwaita-web', '@gjsify/adwaita-storybook'];

        await it('suggests the nearest name for a small typo', () => {
            expect(suggestClosest('@gjsify/adwaita-web', workspaces)).toBe('@gjsify/adwaita-web');
            expect(suggestClosest('@gjsify/fetchh', workspaces)).toBe('@gjsify/fetch');
        });

        await it('is case-insensitive', () => {
            expect(suggestClosest('@GJSIFY/CLI', workspaces)).toBe('@gjsify/cli');
        });

        await it('returns undefined when nothing is close enough', () => {
            expect(suggestClosest('@gjsify/does-not-exist', workspaces)).toBeUndefined();
            expect(suggestClosest('totally-unrelated', workspaces)).toBeUndefined();
        });

        await it('returns undefined for an empty candidate list', () => {
            expect(suggestClosest('anything', [])).toBeUndefined();
        });
    });
};
