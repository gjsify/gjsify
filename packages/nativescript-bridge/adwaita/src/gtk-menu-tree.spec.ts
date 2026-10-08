// ADR 0097 § 1 on this port: a tree's `menus` and `menuModels` reach `GtkMenuButton.menuModel` through
// the real builder. On the TREES entry for the reason `grid-layout.spec.ts` gives.
import {
    MENU_ACTION_VECTORS,
    MENU_TREE_VECTORS,
    driveMenuActionVectors,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';

export const GtkMenuTreeNsTest = async () => {
    expect(MENU_ACTION_VECTORS.length > 0).toBe(true);
    // The owning button sits below an ancestor, as a header bar holds it; the walk reads View.parent.
    await driveMenuActionVectors(
        'adwaita-nativescript (GtkMenuButton)',
        {
            chain() {
                const outer = new Gtk.Box();
                const button = new Gtk.MenuButton();
                outer.append(button as never);
                return { outer, button };
            },
            parent: (node) => (node as { parent?: object | null }).parent,
        },
        { describe, it, expect },
    );
    await describe('adwaita-nativescript: menus in a shared tree (ADR 0097 § 1)', async () => {
        for (const { result, rule, tree } of MENU_TREE_VECTORS) {
            await it(rule, () => {
                const node = tree as unknown as SharedTreeNode;
                if ('refused' in result) {
                    expect(() => build(node)).toThrow(result.refused);
                    return;
                }
                const button = build(node) as unknown as { menuModel: ReadonlyArray<{ kind: string }> };
                expect(button.menuModel.map((entry) => entry.kind).join(',')).toBe(result.kinds.join(','));
            });
        }
    });
};
