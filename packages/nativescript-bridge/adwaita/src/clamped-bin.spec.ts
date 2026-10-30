// A CLAMP AROUND A BIN — the shape that drew every tutorial paragraph as one clipped line.
//
// THE INCIDENT. Learn6502's Android tutorial page is `Adw.Clamp { Adw.Bin { Gtk.Box { ~350
// wrapped Gtk.Labels } } }`. On device the Bin laid out at 1216px, and the box inside it
// MEASURED at 17900 — every label at its full natural width, so none of them wrapped, while
// the same generated `.blp` wrapped correctly on GNOME and on the web.
//
// WHY. `AdwClamp` says libadwaita's allocation in NativeScript's vocabulary: it writes
// `child.width = <dips>` AND `child.horizontalAlignment = 'center'` (adw-clamp.ts). The Bin's
// `_syncColumnToAlignment` read only the alignment — "not stretch" meant "width unsettled",
// so it swapped its single cell from `star` to `auto` and measured its subtree with no width
// at all. A definite width is the other way a container's width is settled, which is what
// `widgets/single-child-cell.ts` now answers; the rule itself is driven there, off-device.
//
// THE SECOND HALF IS THE TIMING, and it is why this spec exists beside the pure one: the
// clamp allocates from its OWN `layoutChanged`, so the width lands AFTER the Bin's
// `onLoaded`. Reading the width once at load would have left the bug exactly where it was.
// The notification the Bin listens to is `widthChange` ON THE STYLE — `width` is a CSS
// property and that is the only object it is emitted on — and the first attempt listened to
// the view's `layoutChanged` instead, which rebuilt the track list from inside the pass that
// was reading it. Android refused the `requestLayout()` and the Bin settled at height 0 with
// the whole tutorial invisible, so "when" is pinned here as hard as "what".
//
// This lives on the TREES entry (`src/test.trees.mts`), not the pure one: it builds the
// port's real widget classes, which evaluate `@nativescript/core` at module scope and are
// reachable only under that entry's `--alias`. The package's AGENTS.md carries the rule.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

/** The unit of the Bin's single column — `'star'` takes the offered width, `'auto'` does not. */
function cellUnit(bin: Adw.Bin): string {
    const columns = (bin as unknown as { getColumns(): { gridUnitType: string }[] }).getColumns();
    return columns.length === 1 ? columns[0]!.gridUnitType : `${columns.length} columns`;
}

/** Put the widget through the load the framework performs when it enters a page. */
function load(view: object): void {
    (view as { callLoaded(): void }).callLoaded();
}

/** What `AdwClamp._allocate` writes onto its child once a layout pass has given it a width. */
function clampAllocates(child: { width: number | string }, width: number | string): void {
    child.width = width;
}

export const AdwClampedBinNsTest = async () => {
    await describe('Adw.Bin inside an Adw.Clamp', async () => {
        await it('starts as a star cell, the untouched stretching default', () => {
            const bin = new Adw.Bin();
            load(bin);
            expect(cellUnit(bin)).toBe('star');
        });

        await it('falls back to an auto cell when it is aligned and nothing settled its width', () => {
            const bin = new Adw.Bin();
            bin.horizontalAlignment = 'center';
            load(bin);
            expect(cellUnit(bin)).toBe('auto');
        });

        await it('keeps a star cell once a clamp has centred it AND given it a width', () => {
            const clamp = new Adw.Clamp();
            const bin = new Adw.Bin();
            bin.set_child(new Gtk.Box());
            clamp.set_child(bin);
            load(bin);

            // What `_allocate` writes, in the order it writes it: the clamp centres on
            // `set_child` and only sizes once a layout pass has given it a width.
            expect(bin.horizontalAlignment).toBe('center');
            clampAllocates(bin, 600);

            expect(cellUnit(bin)).toBe('star');
        });

        await it('picks the width up after onLoaded, which is when the clamp writes it', () => {
            const bin = new Adw.Bin();
            bin.horizontalAlignment = 'center';
            load(bin);
            expect(cellUnit(bin)).toBe('auto');

            clampAllocates(bin, 600);
            expect(cellUnit(bin)).toBe('star');
        });

        await it('goes back to auto when the clamp hands the width back', () => {
            const bin = new Adw.Bin();
            bin.horizontalAlignment = 'center';
            load(bin);
            clampAllocates(bin, 600);
            expect(cellUnit(bin)).toBe('star');

            clampAllocates(bin, 'auto');
            expect(cellUnit(bin)).toBe('auto');
        });

        await it('leaves the cell alone when the width is rewritten to what it already was', () => {
            const bin = new Adw.Bin();
            bin.horizontalAlignment = 'center';
            load(bin);
            clampAllocates(bin, 600);
            const before = (bin as unknown as { getColumns(): object[] }).getColumns()[0];
            clampAllocates(bin, 600);
            expect((bin as unknown as { getColumns(): object[] }).getColumns()[0]).toBe(before);
        });

        await it('stops listening once it leaves the page', () => {
            const bin = new Adw.Bin();
            bin.horizontalAlignment = 'center';
            load(bin);
            (bin as unknown as { callUnloaded(): void }).callUnloaded();
            clampAllocates(bin, 600);
            expect(cellUnit(bin)).toBe('auto');
        });
    });
};

export default AdwClampedBinNsTest;
