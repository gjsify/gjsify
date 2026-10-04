// ADR 0093: this renderer's `./capabilities` table held to `CONSTRUCT_VECTORS` through the real
// tree builder and the elements it mounts.

import {
    CONSTRUCT_VECTORS,
    EXTERN_VECTOR_CLASS,
    driveConstructVectors,
    type ConstructVector,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import { capabilities } from './capabilities.mjs';
import { buildSharedTree, mountSharedTree } from './shared-tree-builder.js';
import { registerTemplateClass } from './template-classes.js';

class CorpusExtern extends HTMLElement {}
registerTemplateClass(EXTERN_VECTOR_CLASS, CorpusExtern, 'corpus-extern');

function observe(vector: ConstructVector): unknown {
    if (vector.kind === 'layout') {
        buildSharedTree(vector.tree);
        return undefined;
    }
    if (vector.kind === 'page') {
        const stack = buildSharedTree(vector.tree);
        return [{ name: stack.children[0]!.getAttribute('name'), title: stack.children[0]!.getAttribute('title') }];
    }
    if (vector.kind === 'extern') {
        return [...buildSharedTree(vector.tree).children].map((child) => ({
            id: child.id,
            builtByRegisteredClass: child instanceof CorpusExtern,
        }));
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
    await describe('adwaita-web: template classes (ADR 0093)', async () => {
        await it('refuses an extern name nothing registered, naming it', () => {
            expect(() =>
                buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'NobodyRegisteredThis', extern: true }] }),
            ).toThrow("'$NobodyRegisteredThis'");
        });
        await it('refuses a second class under a registered name', () => {
            expect(() =>
                registerTemplateClass(EXTERN_VECTOR_CLASS, class extends HTMLElement {}, 'corpus-extern-two'),
            ).toThrow('already registered');
        });
        await it('does not read a registered name for a node that is not extern', () => {
            const el = buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'GtkLabel' }] });
            expect(el.children[0]!.localName).toBe('gtk-label');
        });
    });
};
