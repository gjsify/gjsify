// A `.blp`'s string lists and dialog responses, built by this port — ADR 0072.
//
// Each `VALUE_LIST_VECTORS` row is a Blueprint source and what GTK builds from it, measured
// with `Gtk.Builder`. The source goes through the real parser and projection, refused on any
// loss as the `?shared-tree` door refuses it, then through `build`, and the widget is read
// back: the combo row's or drop-down's model, the dialog's registered responses. The web
// driver (`packages/web/adwaita-web/src/value-lists.spec.ts`) drives the same rows.
//
// On the TREES entry (`src/test.trees.mts`): it builds the port's real widget classes, which
// evaluate `@nativescript/core` at module scope and resolve only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';
import { VALUE_LIST_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { build, buildDialog } from './builder/index.js';
import type { AdwAlertDialog } from './widgets/adw-alert-dialog.js';
import type { AdwComboRow } from './widgets/adw-combo-row.js';

/** A Blueprint object as the `?shared-tree` door hands it over, refused on any loss. */
function blueprintTree(body: string): SharedTreeNode {
    const { node, lost } = projectToSharedNode(
        parseBlueprint(`using Gtk 4.0;\nusing Adw 1;\n\n${body}\n`, 'value-lists.spec.blp'),
    );
    if (lost.length > 0) {
        throw new Error(`the projection dropped ${lost.map((loss) => `${loss.kind} at line ${loss.line}`).join(', ')}`);
    }
    return node as SharedTreeNode;
}

export const AdwValueListsNsTest = async () => {
    await describe('adwaita-nativescript: VALUE_LIST_VECTORS through a .blp', async () => {
        for (const vector of VALUE_LIST_VECTORS) {
            await it(vector.rule, () => {
                const tree = blueprintTree(vector.blueprint);
                if (vector.strings !== undefined) {
                    const row = build(tree) as unknown as Pick<AdwComboRow, 'model' | 'selectedValue'>;
                    expect(JSON.stringify(row.model.map((option) => option.label))).toBe(
                        JSON.stringify(vector.strings),
                    );
                    // GTK selects the first item of a fresh model, and so must the port.
                    expect(row.selectedValue).toBe(vector.strings[0]);
                }
                if (vector.responses !== undefined) {
                    const dialog = buildDialog(tree) as unknown as AdwAlertDialog;
                    const read = dialog.responses.map(({ id, label, appearance, enabled }) => ({
                        id,
                        label,
                        appearance,
                        enabled,
                    }));
                    expect(JSON.stringify(read)).toBe(JSON.stringify(vector.responses));
                }
            });
        }
    });

    await describe('adwaita-nativescript: an extension no class takes is refused', async () => {
        await it('string-list items on a class with no `append`', () => {
            const tree: SharedTreeNode = { tag: 'GtkLabel', extensions: { strings: [{ value: 'a' }] } };
            expect(() => build(tree)).toThrow();
        });

        await it('responses on a class with no `add_response`', () => {
            const tree: SharedTreeNode = { tag: 'GtkBox', extensions: { responses: [{ id: 'ok', label: 'OK' }] } };
            expect(() => build(tree)).toThrow();
        });
    });
};
