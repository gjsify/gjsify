// ADR 0093: this port's `./capabilities` table held to `CONSTRUCT_VECTORS` through its real
// tree builder. On the TREES entry for the reason `grid-layout.spec.ts` gives.

import { CONSTRUCT_VECTORS, driveConstructVectors, type ConstructVector } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build, buildDialog } from './builder/index.js';
import { capabilities } from './capabilities.js';
import type { AdwAlertDialog } from './widgets/adw-alert-dialog.js';
import type { AdwComboRow } from './widgets/adw-combo-row.js';

type Cell = { row: number; column: number; columnSpan: number };

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
};
