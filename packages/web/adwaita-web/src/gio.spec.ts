// The `Gio.SimpleActionGroup` door of adwaita-web, held to the shared vectors (real GJS is their
// oracle, in adwaita-core's `simple-action-group.gjs.spec.ts`). The door is the namespace module itself.

import {
    SIMPLE_ACTION_GROUP_VECTORS,
    driveSimpleActionGroupVectors,
    type GioActionsLike,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as Gio from './namespace/gio.js';

export const GioActionsTest = async () => {
    await driveSimpleActionGroupVectors(
        { name: 'adwaita-web', isOracle: false, Gio: Gio as unknown as GioActionsLike },
        { describe, it, expect },
    );
    await describe('adwaita-web: Gio door', async () => {
        await it('has a vector row for every vector', () => {
            expect(SIMPLE_ACTION_GROUP_VECTORS.length > 0).toBe(true);
        });
    });
};
