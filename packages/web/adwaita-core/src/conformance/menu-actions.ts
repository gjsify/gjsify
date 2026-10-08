// MENU_ACTION_VECTORS: what a menu item does with the actions registered above its owner (ADR 0097 § 3).
//
// Popover content lives outside the owner's subtree, so resolution starts at the owning
// `MenuButton` and not at the row. Each vector builds a chain `outer → button`, inserts groups at
// either end, and asks what the item reads (`sensitive`) and what activating it runs (`fired`).
// The scene supplies only the chain and its parent link; the registry, the walk and the item
// state are the core's, so a port cannot answer differently without leaving the vector.
//
// GJS is the oracle for the walk (`gtk_widget_insert_action_group`, nearest group wins); the
// gjs driver of these rows needs a headless GTK display and is not wired yet.

import { ActionRegistry, SimpleAction, insertActionGroup } from '../gio-actions.js';
import { activateMenuItem, menuActionsFor } from '../menu-actions.js';
import { normalizeMenuModel, resolveMenuItemState } from '../menu.js';
import type { ConstructHarness } from './constructs.js';

export interface MenuActionGroupSpec {
    readonly at: 'outer' | 'button';
    readonly prefix: string;
    /** `enabled` of each action by name; the name is also what its handler logs, with `at`. */
    readonly actions: Readonly<Record<string, boolean>>;
}

export interface MenuActionVector {
    readonly rule: string;
    readonly groups: readonly MenuActionGroupSpec[];
    /** The detailed action the one item names. */
    readonly action: string;
    readonly sensitive: boolean;
    readonly fired: readonly string[];
}

export const MENU_ACTION_VECTORS: ReadonlyArray<MenuActionVector> = [
    {
        rule: 'an action inserted on an ancestor of the MenuButton is found by its menu item',
        groups: [{ at: 'outer', prefix: 'grp', actions: { go: true } }],
        action: 'grp.go',
        sensitive: true,
        fired: ['outer:go'],
    },
    {
        rule: 'a nearer group shadows a farther one with the same prefix',
        groups: [
            { at: 'outer', prefix: 'grp', actions: { go: true } },
            { at: 'button', prefix: 'grp', actions: { go: true } },
        ],
        action: 'grp.go',
        sensitive: true,
        fired: ['button:go'],
    },
    {
        rule: 'a disabled action leaves the item insensitive and activating it does nothing',
        groups: [{ at: 'outer', prefix: 'grp', actions: { go: false } }],
        action: 'grp.go',
        sensitive: false,
        fired: [],
    },
    {
        rule: 'an action missing from the group found makes the item insensitive',
        groups: [{ at: 'outer', prefix: 'grp', actions: { other: true } }],
        action: 'grp.go',
        sensitive: false,
        fired: [],
    },
    {
        rule: 'no group for the prefix is not an empty group: nothing is dimmed',
        groups: [{ at: 'outer', prefix: 'elsewhere', actions: { go: true } }],
        action: 'grp.go',
        sensitive: true,
        fired: [],
    },
];

export interface MenuActionScene {
    /** A fresh chain: `button` is a descendant of `outer`. */
    chain(): { outer: object; button: object };
    parent(node: object): object | null | undefined;
}

/** Runs {@link MENU_ACTION_VECTORS} on a port's tree walk. */
export async function driveMenuActionVectors(
    name: string,
    scene: MenuActionScene,
    { describe, it, expect }: ConstructHarness,
): Promise<void> {
    await describe(`${name}: menu actions resolve from the owning MenuButton (ADR 0097 § 3)`, async () => {
        for (const vector of MENU_ACTION_VECTORS) {
            await it(vector.rule, () => {
                const { outer, button } = scene.chain();
                const fired: string[] = [];
                for (const spec of vector.groups) {
                    const registry = new ActionRegistry();
                    for (const [action, enabled] of Object.entries(spec.actions)) {
                        const simple = new SimpleAction({ name: action, enabled });
                        simple.connect('activate', () => fired.push(`${spec.at}:${action}`));
                        registry.add(simple);
                    }
                    insertActionGroup(spec.at === 'outer' ? outer : button, spec.prefix, registry);
                }
                const [item] = normalizeMenuModel([{ label: 'x', action: vector.action }]);
                if (item === undefined || item.kind !== 'item') throw new Error('vector model is not an item');
                const actions = menuActionsFor([item], button, (node) => scene.parent(node));
                expect(resolveMenuItemState(item, actions).sensitive).toBe(vector.sensitive);
                activateMenuItem(item, button, (node) => scene.parent(node));
                expect(fired.join(',')).toBe(vector.fired.join(','));
            });
        }
    });
}
