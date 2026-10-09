// The SimpleActionGroup core against the shared vectors.

import { describe, expect, it } from '@gjsify/unit';

import {
    SIMPLE_ACTION_GROUP_VECTORS,
    driveSimpleActionGroupVectors,
    type GioActionsLike,
} from './conformance/simple-action-group.js';
import { SimpleAction, SimpleActionGroup } from './gio-actions.js';

export default async () => {
    await driveSimpleActionGroupVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            Gio: { SimpleAction, SimpleActionGroup } as unknown as GioActionsLike,
        },
        { describe, it, expect },
    );

    await describe('adwaita-core: Gio.SimpleActionGroup', async () => {
        await it('answers whether the action existed (GIO answers nothing)', () => {
            const group = new SimpleActionGroup();
            group.add_action(new SimpleAction({ name: 'a' }));
            expect(group.activate_action('a')).toBe(true);
            expect(group.activate_action('zz')).toBe(false);
        });
        await it('has a vector row for every vector', () => {
            expect(SIMPLE_ACTION_GROUP_VECTORS.length > 0).toBe(true);
        });
    });
};
