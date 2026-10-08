// MENU_ACTION_VECTORS: what a menu item does with the actions registered above its owner (ADR 0097 § 3).
//
// Popover content lives outside the owner's subtree, so resolution starts at the owning
// `MenuButton` and not at the row. Each vector builds a chain `outer → button`, inserts groups at
// either end, and asks what the item reads (`sensitive`) and what activating it runs (`fired`).
// The scene supplies only the chain and its parent link; the registry, the walk and the item
// state are the core's, so a port cannot answer differently without leaving the vector.
//
// GJS is the oracle (`menu-actions.gjs.spec.ts`). Measured there: a group inserted on the window is
// found from a popover's content, one on an intermediate ancestor of the MenuButton is NOT (GTK
// links a popover to its parent's action muxer only when that muxer exists), so `outer` is the root.

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
        rule: 'no group for the prefix leaves the action missing, so the item is insensitive (GTK; 0097 § 3 said nothing is dimmed)',
        groups: [{ at: 'outer', prefix: 'elsewhere', actions: { go: true } }],
        action: 'grp.go',
        sensitive: false,
        fired: [],
    },
];

export interface MenuActionScene {
    /** A fresh chain: `outer` is the ROOT (the window) and `button` a descendant of it, and is where resolution starts. */
    chain(): { outer: object; button: object };
    /** Insert a group of `actions` (name → enabled) at `widget`; `onActivate` hears each activation by name. */
    insertGroup(
        widget: object,
        prefix: string,
        actions: Readonly<Record<string, boolean>>,
        onActivate: (action: string) => void,
    ): void;
    /** Whether an item naming `detailed` reads as sensitive from `button`. */
    sensitive(button: object, detailed: string): boolean;
    /** What choosing an item that names `detailed` does from `button`. */
    activate(button: object, detailed: string): void;
}

/** The registry of ADR 0098 over a port's parent link: what the browser and NativeScript drive. */
export function registryMenuActionScene(
    chain: () => { outer: object; button: object },
    parent: (node: object) => object | null | undefined,
): MenuActionScene {
    const itemOf = (detailed: string) => {
        const [item] = normalizeMenuModel([{ label: 'x', action: detailed }]);
        if (item === undefined || item.kind !== 'item') throw new Error('vector model is not an item');
        return item;
    };
    return {
        chain,
        insertGroup(widget, prefix, actions, onActivate) {
            const registry = new ActionRegistry();
            for (const [action, enabled] of Object.entries(actions)) {
                const simple = new SimpleAction({ name: action, enabled });
                simple.connect('activate', () => onActivate(action));
                registry.add(simple);
            }
            insertActionGroup(widget, prefix, registry);
        },
        sensitive(button, detailed) {
            const item = itemOf(detailed);
            return resolveMenuItemState(item, menuActionsFor([item], button, parent)).sensitive;
        },
        activate: (button, detailed) => void activateMenuItem(itemOf(detailed), button, parent),
    };
}

/** Runs {@link MENU_ACTION_VECTORS} on a port's tree walk, or on GTK itself (the oracle). */
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
                    scene.insertGroup(spec.at === 'outer' ? outer : button, spec.prefix, spec.actions, (action) =>
                        fired.push(`${spec.at}:${action}`),
                    );
                }
                expect(scene.sensitive(button, vector.action)).toBe(vector.sensitive);
                scene.activate(button, vector.action);
                expect(fired.join(',')).toBe(vector.fired.join(','));
            });
        }
    });
}
