// ADR 0097 §§ 1, 3 on the browser: the action resolution from the owning `gtk-menu-button`, and a
// tree's menus reaching its `menuModel`.
import {
    MENU_ACTION_VECTORS,
    MENU_TREE_VECTORS,
    driveMenuActionVectors,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { parentOfElement } from './application.js';
import { buildSharedTree } from './shared-tree-builder.js';
import type { GtkMenuButton } from './elements/gtk-menu-button.js';

const made: Element[] = [];

export const MenuActionsTest = async () => {
    expect(MENU_ACTION_VECTORS.length > 0).toBe(true);
    await driveMenuActionVectors(
        'adwaita-web (gtk-menu-button)',
        {
            chain() {
                const outer = document.createElement('div');
                const button = document.createElement('gtk-menu-button');
                outer.append(button);
                document.body.append(outer);
                made.push(outer);
                return { outer, button };
            },
            parent: parentOfElement,
        },
        { describe, it, expect },
    );

    await describe('adwaita-web: menus in a shared tree (ADR 0097 § 1)', async () => {
        for (const { result, rule, tree } of MENU_TREE_VECTORS) {
            await it(rule, () => {
                const node = tree as unknown as SharedTreeNode;
                if ('refused' in result) {
                    expect(() => buildSharedTree(node)).toThrow(result.refused);
                    return;
                }
                const button = buildSharedTree(node) as unknown as GtkMenuButton;
                expect(button.menuModel.map((entry) => entry.kind).join(',')).toBe(result.kinds.join(','));
            });
        }
    });
    for (const element of made.splice(0)) element.remove();
};
