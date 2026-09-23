// A REAL `.blp` OF GtkWidget LAYOUT PROPERTIES, MOUNTED AND MEASURED.
//
// `bottom-sheet-layout.blp` (`@gjsify/adwaita-core/src/conformance/blueprints/`) is the shape
// the gallery's `Adw.BottomSheet` block writes: a button placed with `halign`/`valign`, a box
// inset by four `margin-*` lines, a title at the start edge, and one expanding child. The
// NativeScript port builds the same file (`adwaita-nativescript`'s `blueprint-trees.spec.ts`).
//
// Before `_widget.scss` and the builder's margin table, this renderer wrote every one of these
// as an attribute nothing read — no refusal, since the web builder refuses nothing it writes as
// an attribute, and no effect: the centred button stretched across the sheet's content. So the
// assertions here are about GEOMETRY, read off the laid-out page, never about the attribute
// being present.

import { describe, expect, it } from '@gjsify/unit';

import { mountSharedTree } from './shared-tree-builder.js';

import sheetTree from '../../adwaita-core/src/conformance/blueprints/bottom-sheet-layout.blp?shared-tree';

/** Mount the fixture at a size a layout can be measured in; the caller unmounts. */
function mountSheet() {
    const mounted = mountSharedTree(sheetTree);
    mounted.root.style.width = '400px';
    mounted.root.style.height = '340px';
    const byId = (id: string): HTMLElement => {
        const el = mounted.root.querySelector<HTMLElement>(`#${id}`);
        if (el === null) throw new Error(`the mounted tree has no element with the id '${id}'`);
        return el;
    };
    return { ...mounted, byId };
}

export const AdwBlueprintLayoutTest = async () => {
    await describe('adwaita-web: bottom-sheet-layout.blp, laid out', async () => {
        await it('halign/valign center place the button in the middle of the content at its own size', async () => {
            const { root, unmount, byId } = mountSheet();
            try {
                const content = root.querySelector('.adw-bottom-sheet-content') as HTMLElement;
                const area = content.getBoundingClientRect();
                const button = byId('toggle').getBoundingClientRect();

                expect(button.width < area.width).toBe(true);
                expect(button.height < area.height).toBe(true);
                expect(Math.abs(button.left - area.left - (area.right - button.right)) <= 1).toBe(true);
                expect(Math.abs(button.top - area.top - (area.bottom - button.bottom)) <= 1).toBe(true);
            } finally {
                unmount();
            }
        });

        await it('the four margins inset the box, start and end on the logical edges', async () => {
            const { unmount, byId } = mountSheet();
            try {
                const style = getComputedStyle(byId('box'));

                expect(style.marginLeft).toBe('18px');
                expect(style.marginRight).toBe('12px');
                expect(style.marginTop).toBe('18px');
                expect(style.marginBottom).toBe('24px');
            } finally {
                unmount();
            }
        });

        await it('halign start keeps the title at the start edge of the box at its own width', async () => {
            const { unmount, byId } = mountSheet();
            try {
                const box = byId('box').getBoundingClientRect();
                const title = byId('title').getBoundingClientRect();

                expect(Math.abs(title.left - box.left) <= 1).toBe(true);
                expect(title.width < box.width).toBe(true);
            } finally {
                unmount();
            }
        });

        await it('expand grows along the box axis only', async () => {
            const { unmount, byId } = mountSheet();
            try {
                // The box is vertical: `vexpand` is its own axis and takes the spare height,
                // `hexpand` is the cross axis, which `align-items: stretch` already fills.
                expect(getComputedStyle(byId('body')).flexGrow).toBe('1');
                expect(getComputedStyle(byId('caption')).flexGrow).toBe('0');
            } finally {
                unmount();
            }
        });

        await it('the open modal sheet shows its dimming, and the non-modal one would not', async () => {
            const { root, unmount } = mountSheet();
            try {
                const sheet = root as HTMLElement & { modal: boolean };
                const dimming = root.querySelector('.adw-bottom-sheet-dimming') as HTMLElement;

                expect(dimming.classList.contains('visible')).toBe(true);
                sheet.modal = false;
                expect(dimming.classList.contains('visible')).toBe(false);
            } finally {
                unmount();
            }
        });
    });
};
