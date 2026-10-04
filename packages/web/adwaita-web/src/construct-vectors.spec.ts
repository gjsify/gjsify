// ADR 0093: this renderer's `./capabilities` table held to `CONSTRUCT_VECTORS` through the real
// tree builder and the elements it mounts.

import {
    CONSTRUCT_VECTORS,
    EXTERN_VECTOR_CLASS,
    driveConstructVectors,
    type ConstructVector,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import { capabilities } from './capabilities.mjs';
import { buildSharedTree, mountSharedTree } from './shared-tree-builder.js';
import { registerTemplateClass } from './template-classes.js';

const vector = (kind: string) => CONSTRUCT_VECTORS.find((each) => each.kind === kind)!.tree;

class CorpusExtern extends HTMLElement {}
customElements.define('corpus-extern', CorpusExtern);
registerTemplateClass(EXTERN_VECTOR_CLASS, 'corpus-extern');

function observe(vector: ConstructVector): unknown {
    if (vector.kind === 'layout') {
        buildSharedTree(vector.tree);
        return undefined;
    }
    if (vector.kind === 'page') {
        const stack = buildSharedTree(vector.tree);
        return [{ name: stack.children[0]!.getAttribute('name'), title: stack.children[0]!.getAttribute('title') }];
    }
    if (vector.kind === 'signal') {
        let calls = 0;
        const { root, unmount } = mountSharedTree(vector.tree, {
            scope: {
                onClicked: () => {
                    calls++;
                },
            },
        });
        try {
            root.querySelector('#pressed')!.dispatchEvent(new Event('click'));
            return [{ handler: 'onClicked', calls }];
        } finally {
            unmount();
        }
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
    await describe('adwaita-web: template classes and handlers (ADR 0093)', async () => {
        await it('refuses an extern name nothing registered, naming it', () => {
            expect(() =>
                buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'NobodyRegisteredThis', extern: true }] }),
            ).toThrow("'$NobodyRegisteredThis'");
        });
        await it('refuses a second tag under a registered name', () => {
            expect(() => registerTemplateClass(EXTERN_VECTOR_CLASS, 'corpus-extern-two')).toThrow('already registered');
        });
        await it('refuses a registered tag nothing defined, naming it', () => {
            registerTemplateClass('CorpusUndefinedTag', 'corpus-undefined-tag');
            expect(() =>
                buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'CorpusUndefinedTag', extern: true }] }),
            ).toThrow('nothing has defined');
        });
        await it('refuses a signal handler the scope lacks, naming it', () => {
            const tree = vector('signal');
            expect(() => mountSharedTree(tree)).toThrow("'onClicked'");
            expect(() => mountSharedTree(tree, { scope: {} })).toThrow('has no such function');
        });
        await it('refuses a signal the element does not declare, and the forms it has not verified', () => {
            const on = (signal: NonNullable<SharedTreeNode['signals']>[number]): SharedTreeNode => ({
                tag: 'GtkBox',
                children: [{ tag: 'GtkButton', signals: [signal] }],
            });
            const scope = { onX: () => {} };
            expect(() => mountSharedTree(on({ name: 'map', handler: 'onX' }), { scope })).toThrow("no signal 'map'");
            expect(() => mountSharedTree(on({ name: 'clicked', handler: 'onX', flags: ['after'] }), { scope })).toThrow(
                'plain handlers only',
            );
            expect(() => mountSharedTree(on({ name: 'clicked', handler: 'onX', object: 'a' }), { scope })).toThrow(
                'plain handlers only',
            );
        });
        await it('does not read a registered name for a node that is not extern', () => {
            const el = buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'GtkLabel' }] });
            expect(el.children[0]!.localName).toBe('gtk-label');
        });
    });
};
