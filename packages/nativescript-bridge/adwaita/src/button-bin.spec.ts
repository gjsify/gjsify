// A BUTTON IS A BIN — the container shape that can centre a child inside a size request.
//
// THE INCIDENT. Learn6502's Android gamepad asks each of its buttons for 55×55 (`width-request`
// / `height-request`, which this port maps onto NativeScript's `minWidth` / `minHeight`). On
// device the "A" button's view measured 193×193 and its glyph sat in the top-left corner of it,
// 79px left of and 65.5px above the button's centre, with the d-pad arrows and the header's
// icon button off the same way. The child WAS aligned `center` / `middle`, in a `GridLayout`
// with one `star` row and one `star` column — and a grid freezes its track lengths in
// `onMeasure` and applies the view's size floor afterwards, so the cell stayed content-sized at
// the padding origin and the alignment centred the child inside that. `widgets/bin-layout.ts`
// carries the Java, the measurement and the three containers that were refused.
//
// WHAT THIS HOLDS, since a double cannot lay anything out: the SHAPE the fix turns on. The
// button is a `DockLayout`; it stretches its last child, which is the platform's whole
// definition of docking the remaining space; its content is that last child on every slot; and
// a size request still goes to the minimum rather than to the exact `width` — the floor whose
// arrival the grid could not pass on. The pixels are device evidence and belong in the report,
// not here.
//
// `AdwImageButton` is the same construction and is checked through `Gtk.MenuButton`, which
// extends it and is the spelling a caller has (`namespace/adw.ts`: the image button composes
// `GtkButton` and has no namespace member of its own).
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope and are reachable only under
// that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';
import { DockLayout, type View } from './testing/ns-core.mjs';

/** The bin's children, in paint order — the last one is the one `DockLayout` stretches. */
function childrenOf(view: object): View[] {
    const bin = view as unknown as { getChildrenCount(): number; getChildAt(index: number): View };
    return Array.from({ length: bin.getChildrenCount() }, (_, index) => bin.getChildAt(index));
}

/** The one child a bin is supposed to have, or a failure message naming how many there were. */
function onlyChild(view: object): View | string {
    const children = childrenOf(view);
    return children.length === 1 ? children[0]! : `${children.length} children`;
}

/** Whether `view` docks its last child across its own allocation. */
const stretchesLastChild = (view: object): boolean => (view as unknown as DockLayout).stretchLastChild;

/** The platform members a one-cell grid would still answer, and a bin no longer does. */
const hasGridTracks = (view: object): boolean =>
    typeof (view as { getColumns?: unknown }).getColumns === 'function' ||
    typeof (view as { getRows?: unknown }).getRows === 'function';

export const GtkButtonBinNsTest = async () => {
    await describe('Gtk.Button as a bin', async () => {
        await it('is a DockLayout that stretches its last child', () => {
            const button = new Gtk.Button();
            expect(button instanceof DockLayout).toBe(true);
            expect(stretchesLastChild(button)).toBe(true);
        });

        await it('is no longer a grid, so there is no cell left to pin a child in', () => {
            expect(hasGridTracks(new Gtk.Button())).toBe(false);
        });

        await it('holds no child until a slot is filled', () => {
            expect(childrenOf(new Gtk.Button()).length).toBe(0);
        });

        await it('centres the label it builds for `label` on both axes', () => {
            const button = new Gtk.Button({ label: 'A' });
            const child = onlyChild(button);
            expect(typeof child).toBe('object');
            expect((child as View).horizontalAlignment).toBe('center');
            expect((child as View).verticalAlignment).toBe('middle');
        });

        await it('centres the image it builds for `icon-name`', () => {
            const button = new Gtk.Button({ iconName: 'list-add-symbolic' });
            const child = onlyChild(button);
            expect(typeof child).toBe('object');
            expect((child as View).horizontalAlignment).toBe('center');
            expect((child as View).verticalAlignment).toBe('middle');
        });

        await it('centres a `child` the caller hands it', () => {
            const box = new Gtk.Box();
            const button = new Gtk.Button();
            button.child = box;
            expect(onlyChild(button)).toBe(box as unknown as View);
            expect((box as unknown as View).horizontalAlignment).toBe('center');
            expect((box as unknown as View).verticalAlignment).toBe('middle');
        });

        await it('keeps the content the LAST child across a slot swap', () => {
            const button = new Gtk.Button({ label: 'A' });
            button.iconName = 'list-add-symbolic';
            const afterIcon = childrenOf(button);
            expect(afterIcon.length).toBe(1);

            button.label = 'B';
            const afterLabel = childrenOf(button);
            expect(afterLabel.length).toBe(1);
            expect(afterLabel[0]).not.toBe(afterIcon[0]);
            expect(afterLabel[0]!.horizontalAlignment).toBe('center');
            expect(afterLabel[0]!.verticalAlignment).toBe('middle');
        });

        await it('still docks its child after the content has been replaced', () => {
            const button = new Gtk.Button({ label: 'A' });
            button.child = new Gtk.Box();
            expect(stretchesLastChild(button)).toBe(true);
        });

        await it('takes a size request as a minimum, never as an exact size', () => {
            const button = new Gtk.Button({ label: 'A' });
            button.widthRequest = 55;
            button.heightRequest = 55;
            expect((button as unknown as View).minWidth).toBe(55);
            expect((button as unknown as View).minHeight).toBe(55);
            expect((button as unknown as View).width).toBe('auto');
            expect((button as unknown as View).height).toBe('auto');
        });
    });

    await describe('AdwImageButton as a bin, through Gtk.MenuButton', async () => {
        await it('is a DockLayout that stretches its last child', () => {
            const button = new Gtk.MenuButton();
            expect(button instanceof DockLayout).toBe(true);
            expect(stretchesLastChild(button)).toBe(true);
            expect(hasGridTracks(button)).toBe(false);
        });

        await it('centres its icon image, which is its only child', () => {
            const button = new Gtk.MenuButton({ iconName: 'open-menu-symbolic' });
            const child = onlyChild(button);
            expect(typeof child).toBe('object');
            expect((child as View).horizontalAlignment).toBe('center');
            expect((child as View).verticalAlignment).toBe('middle');
        });

        await it('takes a size request as a minimum, never as an exact size', () => {
            const button = new Gtk.MenuButton();
            button.widthRequest = 48;
            button.heightRequest = 48;
            expect((button as unknown as View).minWidth).toBe(48);
            expect((button as unknown as View).minHeight).toBe(48);
            expect((button as unknown as View).width).toBe('auto');
            expect((button as unknown as View).height).toBe('auto');
        });
    });
};

export default GtkButtonBinNsTest;
