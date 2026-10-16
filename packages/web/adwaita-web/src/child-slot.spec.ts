// A `.blp`'s `child:` (and every other widget-valued property) becomes `slot: '<property>'` in the
// shared tree (`packages/infra/blueprint/src/project.mjs`). An element that routed only its
// DEFAULT slot refused that name on mount, and before the refusal existed it left the child
// beside the structure it had built — Learn6502's `Overlay { child: Adw.ToastOverlay { … } }`
// was the measured case. Every element whose GTK class has such a property is mounted here
// with it, and the child has to land where the element's own binding says that slot goes.
import { describe, expect, it } from '@gjsify/unit';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { mountSharedTree } from './shared-tree-builder.js';
import { slottedChildrenOf } from './slotted-children.js';

/** The GIR class, and the widget-valued property the tree writes as its child's slot. */
const CASES: ReadonlyArray<readonly [string, string]> = [
    ['GtkOverlay', 'child'],
    ['AdwToastOverlay', 'child'],
    ['AdwDialog', 'child'],
    ['AdwAlertDialog', 'extra-child'],
    ['GtkListBoxRow', 'child'],
    ['GtkFlowBoxChild', 'child'],
    ['GtkGraphicsOffload', 'child'],
    ['GtkPaned', 'start-child'],
    ['GtkPaned', 'end-child'],
    ['GtkWindow', 'child'],
    ['GtkWindowHandle', 'child'],
    ['GtkPopover', 'child'],
    ['AdwBreakpointBin', 'child'],
    ['GtkPopoverBin', 'child'],
    ['GtkViewport', 'child'],
    ['GtkTreeExpander', 'child'],
    ['GtkDragIcon', 'child'],
    ['GtkSearchBar', 'child'],
    ['AdwBin', 'child'],
    ['AdwClamp', 'child'],
    ['GtkScrolledWindow', 'child'],
    ['GtkRevealer', 'child'],
    ['GtkFrame', 'child'],
    ['GtkExpander', 'child'],
    ['AdwStatusPage', 'child'],
];

/** Where `child` ended up, read against the slot the parent itself declares. */
function report(root: HTMLElement, child: Element, slot: string): string {
    const declared = slottedChildrenOf(root)?.slots.find((candidate) => candidate.name === slot);
    if (declared === undefined) return 'undeclared';
    if (!root.contains(child)) return 'outside';
    if (!('into' in declared)) return 'consumed';
    return child.parentElement === declared.into ? 'routed' : `beside, under <${child.parentElement?.localName}>`;
}

export const AdwChildSlotTest = async () => {
    await describe('adwaita-web: a widget-valued property in a tree is the slot it names', async () => {
        for (const [tag, slot] of CASES) {
            await it(`${tag} { ${slot}: … }`, () => {
                const tree: SharedTreeNode = {
                    tag,
                    children: [{ tag: 'GtkBox', id: 'probe', slot }],
                };
                let outcome: string;
                try {
                    const { root, unmount } = mountSharedTree(tree);
                    outcome = report(root, root.querySelector('#probe')!, slot);
                    unmount();
                } catch (error) {
                    outcome = `refused: ${(error as Error).message}`;
                }
                expect(`${tag} ${slot}: ${outcome}`).toBe(`${tag} ${slot}: routed`);
            });
        }
    });
};
