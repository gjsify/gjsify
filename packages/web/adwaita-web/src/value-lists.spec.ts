// A `.blp`'s string lists and dialog responses, built by this renderer — ADR 0072.
//
// Each `VALUE_LIST_VECTORS` row is a Blueprint source and what GTK builds from it, measured
// with `Gtk.Builder`. The source goes through the real parser and projection, refused on any
// loss as the `?shared-tree` door refuses it, then through `mountSharedTree`, and the widget
// is read back: the options a combo row or drop-down paints, the buttons a dialog registered.
// Before ADR 0072 the projection dropped both lists, so the same sources rendered an EMPTY
// combo row and a dialog with no buttons, at exit 0.
//
// The NativeScript driver (`packages/nativescript-bridge/adwaita/src/value-lists.spec.ts`)
// drives the same rows through its own builder.

import { describe, expect, it } from '@gjsify/unit';

import { parseBlueprint, projectToSharedNode } from '@gjsify/blueprint';
import { VALUE_LIST_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import type { AdwComboRow } from './elements/adw-combo-row.js';
import { mountSharedTree } from './shared-tree-builder.js';

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

/** The option labels the widget paints, which is what a reader sees. */
const paintedOptions = (el: HTMLElement) =>
    [...el.querySelectorAll('option, .adw-drop-down-item-label')].map((node) => node.textContent);

/** Mount, run, and unmount even when the body throws. */
function mounted(tree: SharedTreeNode, body: (root: HTMLElement) => void): void {
    const { root, unmount } = mountSharedTree(tree);
    try {
        body(root);
    } finally {
        unmount();
    }
}

export const AdwValueListsTest = async () => {
    await describe('adwaita-web: VALUE_LIST_VECTORS through a .blp', async () => {
        for (const vector of VALUE_LIST_VECTORS) {
            await it(vector.rule, () => {
                mounted(blueprintTree(vector.blueprint), (root) => {
                    if (vector.strings !== undefined) {
                        const model = (root as unknown as Pick<AdwComboRow, 'model'>).model;
                        expect(JSON.stringify(model.map((option) => option.label))).toBe(
                            JSON.stringify(vector.strings),
                        );
                        expect(JSON.stringify(paintedOptions(root))).toBe(JSON.stringify(vector.strings));
                        // Consumed as data, as GtkBuilder leaves no list model in the widget tree.
                        expect(root.querySelector('gtk-string-list')).toBe(null);
                    }
                    if (vector.responses !== undefined) {
                        const dialog = root as unknown as AdwAlertDialog;
                        const read = vector.responses.map(({ id }) => ({
                            id,
                            label: dialog.getResponseLabel(id),
                            appearance: dialog.getResponseAppearance(id),
                            enabled: dialog.getResponseEnabled(id),
                        }));
                        expect(JSON.stringify(read)).toBe(JSON.stringify(vector.responses));
                        // The buttons the dialog paints, in the order the source wrote them.
                        const painted = [...root.querySelectorAll('.adw-alert-dialog-response')].map(
                            (button) => button.textContent,
                        );
                        expect(JSON.stringify(painted)).toBe(JSON.stringify(vector.responses.map((r) => r.label)));
                    }
                });
            });
        }
    });

    await describe('adwaita-web: an extension no element takes is refused', async () => {
        await it('a string list at a slot the parent has no destination for', () => {
            const tree = blueprintTree('Gtk.Box { Gtk.StringList { strings [ "a" ] } }');
            expect(() => mountSharedTree(tree)).toThrow();
        });

        await it('responses on an element that is not a dialog', () => {
            const tree: SharedTreeNode = { tag: 'GtkBox', extensions: { responses: [{ id: 'ok', label: 'OK' }] } };
            expect(() => mountSharedTree(tree)).toThrow();
        });
    });
};
