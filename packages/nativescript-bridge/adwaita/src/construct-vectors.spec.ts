// ADR 0093: this port's `./capabilities` table held to `CONSTRUCT_VECTORS` through its real
// tree builder. On the TREES entry for the reason `grid-layout.spec.ts` gives.

import {
    CONSTRUCT_VECTORS,
    EXTERN_VECTOR_CLASS,
    driveConstructVectors,
    type ConstructVector,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build, buildDialog, registerTemplateClass } from './builder/index.js';
import { capabilities } from './capabilities.js';
import { GtkBox } from './widgets/gtk-box.js';
import type { GtkButton } from './widgets/gtk-button.js';
import type { AdwAlertDialog } from './widgets/adw-alert-dialog.js';
import type { AdwComboRow } from './widgets/adw-combo-row.js';

type Cell = { row: number; column: number; columnSpan: number };

class CorpusExtern extends GtkBox {}
registerTemplateClass(EXTERN_VECTOR_CLASS, CorpusExtern);

function observe(vector: ConstructVector): unknown {
    switch (vector.kind) {
        case 'layout': {
            const root = build(vector.tree) as unknown as { getViewById(id: string): Cell };
            return ['a', 'b'].map((id) => {
                const { row, column, columnSpan } = root.getViewById(id);
                return { row, column, columnSpan };
            });
        }
        case 'strings':
            return (build(vector.tree) as unknown as Pick<AdwComboRow, 'model'>).model.map((option) => option.label);
        case 'responses':
            return (buildDialog(vector.tree) as unknown as AdwAlertDialog).responses.map(
                ({ id, label, appearance, enabled }) => ({ id, label, appearance, enabled }),
            );
        case 'signal': {
            let calls = 0;
            const root = build(vector.tree, {
                scope: {
                    onClicked: () => {
                        calls++;
                    },
                },
            }) as unknown as { getViewById(id: string): GtkButton };
            root.getViewById('pressed').notify({ eventName: 'clicked', object: root.getViewById('pressed') });
            return [{ handler: 'onClicked', calls }];
        }
        case 'extern': {
            const root = build(vector.tree) as unknown as { getViewById(id: string): object | undefined };
            return [
                { id: 'registered', builtByRegisteredClass: root.getViewById('registered') instanceof CorpusExtern },
            ];
        }
        case 'page':
            // Refused, so the driver never asks for a reading; building must throw.
            build(vector.tree);
            return undefined;
    }
}

export const AdwConstructVectorsNsTest = async () => {
    await driveConstructVectors(
        { name: 'adwaita-nativescript', capabilities, vectors: CONSTRUCT_VECTORS, observe },
        { describe, it, expect },
    );
    await describe('adwaita-nativescript: template classes (ADR 0093)', async () => {
        await it('refuses an extern name nothing registered, naming it', () => {
            expect(() => build({ tag: 'GtkBox', children: [{ tag: 'NobodyRegisteredThis', extern: true }] })).toThrow(
                "'$NobodyRegisteredThis'",
            );
        });
        await it('refuses a second class under a registered name', () => {
            expect(() => registerTemplateClass(EXTERN_VECTOR_CLASS, class extends GtkBox {})).toThrow(
                'already registered',
            );
        });
        await it('refuses a signal handler the scope lacks, naming it', () => {
            const tree = CONSTRUCT_VECTORS.find((each) => each.kind === 'signal')!.tree;
            expect(() => build(tree)).toThrow("'onClicked'");
            expect(() => build(tree, { scope: {} })).toThrow('has no such function');
        });
        await it('refuses a signal the class does not emit, and the forms it has not verified', () => {
            const on = (signal: NonNullable<SharedTreeNode['signals']>[number]): SharedTreeNode => ({
                tag: 'GtkBox',
                children: [{ tag: 'GtkButton', signals: [signal] }],
            });
            const scope = { onX: () => {} };
            expect(() => build(on({ name: 'map', handler: 'onX' }), { scope })).toThrow("no signal 'map'");
            expect(() => build(on({ name: 'clicked', handler: 'onX', flags: ['swapped'] }), { scope })).toThrow(
                'plain handlers only',
            );
        });
        await it('builds the registered class with its own props and children, as for any widget', () => {
            const root = build({
                tag: 'GtkBox',
                children: [
                    { tag: EXTERN_VECTOR_CLASS, extern: true, id: 'e', children: [{ tag: 'GtkLabel', id: 'inner' }] },
                ],
            }) as unknown as { getViewById(id: string): object | undefined };
            expect(root.getViewById('e') instanceof CorpusExtern).toBe(true);
            expect(root.getViewById('inner') !== undefined).toBe(true);
        });
    });
};
