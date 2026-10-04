// ADR 0093: this renderer's `./capabilities` table held to `CONSTRUCT_VECTORS` through the real
// tree builder and the elements it mounts.

import { CONSTRUCT_VECTORS, driveConstructVectors, type ConstructVector } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import { capabilities } from './capabilities.mjs';
import { buildSharedTree, mountSharedTree } from './shared-tree-builder.js';

function observe(vector: ConstructVector): unknown {
    if (vector.kind === 'layout') {
        buildSharedTree(vector.tree);
        return undefined;
    }
    if (vector.kind === 'page') {
        const stack = buildSharedTree(vector.tree);
        return [{ name: stack.children[0]!.getAttribute('name'), title: stack.children[0]!.getAttribute('title') }];
    }
    const { root, unmount } = mountSharedTree(vector.tree);
    try {
        if (vector.kind === 'strings') {
            return [...root.querySelectorAll('option, .adw-drop-down-item-label')].map((node) => node.textContent);
        }
        const dialog = root as unknown as AdwAlertDialog;
        return (vector.tree.extensions?.responses ?? []).map(({ id }) => ({
            id,
            label: dialog.getResponseLabel(id),
            appearance: dialog.getResponseAppearance(id),
            enabled: dialog.getResponseEnabled(id),
        }));
    } finally {
        unmount();
    }
}

export const AdwConstructVectorsTest = async () => {
    await driveConstructVectors(
        { name: 'adwaita-web', capabilities, vectors: CONSTRUCT_VECTORS, observe },
        { describe, it, expect },
    );
};
