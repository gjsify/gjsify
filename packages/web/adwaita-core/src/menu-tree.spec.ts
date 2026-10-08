import { describe, expect, it } from '@gjsify/unit';

import { MENU_TREE_VECTORS } from './conformance/menu-tree.js';
import { menuAssignments } from './menu-tree.js';

export default async () => {
    await describe('menu tree assignments (ADR 0097 § 1)', async () => {
        for (const { result, rule, tree } of MENU_TREE_VECTORS) {
            await it(rule, () => {
                if ('refused' in result) {
                    expect(() => menuAssignments(tree, tree.menus)).toThrow(result.refused);
                    return;
                }
                const [assigned] = menuAssignments(tree, tree.menus);
                expect(assigned?.[0]).toBe('menu-model');
                expect((assigned?.[1] ?? []).map((node) => node.kind).join(',')).toBe(result.kinds.join(','));
            });
        }
    });
};
