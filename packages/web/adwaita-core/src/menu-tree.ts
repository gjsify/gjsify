// How a shared tree's menus reach a widget (ADR 0097 § 1), once for every renderer.
//
// The projection keeps `menu-model: id` a scalar and puts the root menus in `menus`; a menu
// written at the property is `menuModels`. A builder that wrote the scalar would hand the widget
// the id as text, which the widget reads as an empty menu — so both builders ask here.

import { normalizeMenuModel } from './menu.js';
import type { AdwMenuInput, AdwMenuModel } from './menu.js';

/** The slice of a tree node this reads. */
export interface MenuTreeNode {
    readonly tag: string;
    readonly props?: Readonly<Record<string, string | number | boolean>>;
    readonly menuModels?: Readonly<Record<string, readonly unknown[]>>;
}

/**
 * The menus a node assigns, as `[property, model]`: the root menu `menu-model: id` names, and each
 * model written at a property. An id with no root menu is refused by name.
 */
export function menuAssignments(
    node: MenuTreeNode,
    menus: Readonly<Record<string, readonly unknown[]>> | undefined,
): Array<[string, AdwMenuModel]> {
    const out: Array<[string, AdwMenuModel]> = [];
    const reference = node.props?.['menu-model'];
    if (reference !== undefined) {
        const items = typeof reference === 'string' ? menus?.[reference] : undefined;
        if (items === undefined) {
            throw new Error(
                `${node.tag} menu-model: ${JSON.stringify(reference)} names no menu: the file declares ` +
                    `[${Object.keys(menus ?? {}).join(', ')}] (ADR 0097 § 1).`,
            );
        }
        out.push(['menu-model', normalizeMenuModel(items as AdwMenuInput)]);
    }
    for (const [property, items] of Object.entries(node.menuModels ?? {})) {
        out.push([property, normalizeMenuModel(items as AdwMenuInput)]);
    }
    return out;
}
