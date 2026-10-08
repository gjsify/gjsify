// MENU_TREE_VECTORS: how a shared tree's menus reach `menuModel` (ADR 0097 § 1).
//
// The projection keeps `menu-model: id` a scalar and carries root menus in `menus`; a menu
// written at the property is `menuModels`. A builder that wrote the scalar would hand the widget
// the id as text, which reads as an empty menu — so each row states what the widget must hold.

import type { AdwMenuNode } from '../menu.js';

export interface MenuTreeVector {
    readonly rule: string;
    /** A `GtkMenuButton` tree. */
    readonly tree: {
        readonly tag: 'GtkMenuButton';
        readonly props?: Record<string, string>;
        readonly menus?: Record<string, readonly AdwMenuNode[]>;
        readonly menuModels?: Record<string, readonly AdwMenuNode[]>;
    };
    /** The `kind` of each top-level node `menuModel` holds, or a fragment of the refusal. */
    readonly result: { readonly kinds: readonly string[] } | { readonly refused: string };
}

const ITEM: AdwMenuNode = { kind: 'item', label: 'Preferences', action: 'app.preferences' };

export const MENU_TREE_VECTORS: ReadonlyArray<MenuTreeVector> = [
    {
        rule: '`menu-model: id` resolves against the root menus, not the id text',
        tree: {
            tag: 'GtkMenuButton',
            props: { 'menu-model': 'mainMenu' },
            menus: { mainMenu: [{ kind: 'section', items: [ITEM] }] },
        },
        result: { kinds: ['section'] },
    },
    {
        rule: 'a menu written at the property is the model itself',
        tree: { tag: 'GtkMenuButton', menuModels: { 'menu-model': [ITEM] } },
        result: { kinds: ['item'] },
    },
    {
        rule: 'an id that names no root menu is refused by name',
        tree: { tag: 'GtkMenuButton', props: { 'menu-model': 'nope' }, menus: {} },
        result: { refused: 'names no menu' },
    },
];
