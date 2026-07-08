// @gjsify/adwaita-app — nav-model tests.
// Runs on GJS + Node (pure helpers, no platform imports).

import { describe, expect, it } from '@gjsify/unit';
import { findNavItem, resolveInitialNavIndex } from './nav-model.js';
import type { NavItem } from './types.js';

const items: NavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'reports', label: 'Reports' },
];

export default async () => {
    await describe('resolveInitialNavIndex', async () => {
        await it('returns the index of a matching id', () => {
            expect(resolveInitialNavIndex(items, 'reports')).toBe(2);
        });

        await it('falls back to 0 for an unknown id', () => {
            expect(resolveInitialNavIndex(items, 'nope')).toBe(0);
        });

        await it('returns 0 when no id is requested', () => {
            expect(resolveInitialNavIndex(items)).toBe(0);
        });

        await it('returns -1 for an empty list', () => {
            expect(resolveInitialNavIndex([], 'anything')).toBe(-1);
        });
    });

    await describe('findNavItem', async () => {
        await it('finds an item by id', () => {
            expect(findNavItem(items, 'accounts')?.label).toBe('Accounts');
        });

        await it('returns undefined for an unknown id', () => {
            expect(findNavItem(items, 'nope')).toBeUndefined();
        });
    });
};
