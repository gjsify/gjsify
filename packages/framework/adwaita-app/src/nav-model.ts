// @gjsify/adwaita-app — pure navigation-model helpers.
// No @girs imports: unit-tested on Node + GJS.

import type { NavItem } from './types.js';

/**
 * Resolve the sidebar row index to select on startup.
 *
 * @returns the index of the item whose id matches `wantedId`; `0` when there is
 *   no match or no `wantedId` but the list is non-empty; `-1` for an empty list.
 */
export function resolveInitialNavIndex(items: readonly NavItem[], wantedId?: string): number {
    if (items.length === 0) return -1;
    if (!wantedId) return 0;
    const index = items.findIndex((item) => item.id === wantedId);
    return index >= 0 ? index : 0;
}

/** Find a nav item by id, or `undefined`. */
export function findNavItem(items: readonly NavItem[], id: string): NavItem | undefined {
    return items.find((item) => item.id === id);
}
