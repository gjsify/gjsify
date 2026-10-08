import { describe, expect, it } from '@gjsify/unit';

import { MENU_ACTION_VECTORS, driveMenuActionVectors } from './conformance/menu-actions.js';

const parents = new WeakMap<object, object>();

export default async () => {
    await driveMenuActionVectors(
        'adwaita-core (plain objects)',
        {
            chain() {
                const outer = {};
                const button = {};
                parents.set(button, outer);
                return { outer, button };
            },
            parent: (node) => parents.get(node),
        },
        { describe, it, expect },
    );
    await describe('MENU_ACTION_VECTORS', async () => {
        await it('state every resolution rule of ADR 0097 § 3', () => {
            expect(MENU_ACTION_VECTORS.length).toBe(5);
        });
    });
};
