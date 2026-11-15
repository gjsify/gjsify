// `Gtk.FlowBox`, built as the REAL class against the platform double: the per-child plan
// (line break, grow), the gap that rides on the margin without erasing it, the held selection
// properties and the shared-tree spelling.
//
// A layout PASS is not measurable here, so wrapping is asserted as the `setFlexWrapBefore`
// flag each child carries.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';
import { FlexboxLayout, type View } from './testing/ns-core.mjs';
import { flowBoxCount, flowBoxGap, flowBoxPlan } from './widgets/flow-box-state.js';

/** What a child of a flow box answers beyond `View`. */
interface Sibling {
    hexpand: boolean;
    get_next_sibling(): unknown;
}

const label = (): View => new Gtk.Label() as unknown as View;
const add = (box: Gtk.FlowBox, child: View): void => box.append(child as unknown as never);

/** The line-break flags of every child, in order. */
const breaks = (box: Gtk.FlowBox, children: View[]): boolean[] => {
    void box;
    return children.map((child) => FlexboxLayout.getFlexWrapBefore(child));
};

export const GtkFlowBoxNsTest = async () => {
    await describe('Gtk.FlowBox: the pure plan', async () => {
        await it('breaks the line before every max-th child and never before the first', () => {
            const plan = flowBoxPlan([false, false, false, false, false], 2, false);
            expect(plan.map((p) => p.wrapBefore)).toStrictEqual([false, false, true, false, true]);
        });

        await it('grows every child of a homogeneous box, and only the hexpand ones otherwise', () => {
            expect(flowBoxPlan([false, true], 7, true).map((p) => p.grow)).toStrictEqual([1, 1]);
            expect(flowBoxPlan([false, true], 7, false).map((p) => p.grow)).toStrictEqual([0, 1]);
        });

        await it('splits a gap in halves per facing edge', () => {
            expect(flowBoxGap(4, 10)).toStrictEqual({ left: 2, right: 2, top: 5, bottom: 5 });
        });

        await it('takes counts from the lowest to G_MAXINT, keeps a blank one, refuses the rest', () => {
            expect(flowBoxCount(3, 3, 7, 'maxChildrenPerLine', 1)).toBe(3);
            expect(flowBoxCount(Number.NaN, ' ', 7, 'maxChildrenPerLine', 1)).toBe(7);
            expect(() => flowBoxCount(0, 0, 7, 'maxChildrenPerLine', 1)).toThrow('is not a count');
            expect(() => flowBoxCount(1.5, 1.5, 7, 'maxChildrenPerLine', 1)).toThrow('is not a count');
            expect(flowBoxCount(0, 0, 7, 'minChildrenPerLine', 0)).toBe(0);
        });
    });

    await describe('Gtk.FlowBox: children and lines', async () => {
        await it('is a wrapping flexbox that keeps each child its own height', () => {
            const box = new Gtk.FlowBox();
            expect(box.flexWrap).toBe('wrap');
            expect(box.flexDirection).toBe('row');
            expect(box.alignItems).toBe('flex-start');
        });

        await it('defaults to at most 7 children per line, like GTK', () => {
            const box = new Gtk.FlowBox();
            const children = Array.from({ length: 8 }, label);
            for (const child of children) add(box, child);
            expect(box.maxChildrenPerLine).toBe(7);
            expect(breaks(box, children)).toStrictEqual([false, false, false, false, false, false, false, true]);
        });

        await it('re-plans every break when the maximum changes', () => {
            const box = new Gtk.FlowBox({ maxChildrenPerLine: 3 });
            const children = Array.from({ length: 5 }, label);
            for (const child of children) add(box, child);
            expect(breaks(box, children)).toStrictEqual([false, false, false, true, false]);
            box.maxChildrenPerLine = 2;
            expect(breaks(box, children)).toStrictEqual([false, false, true, false, true]);
        });

        await it('shifts the breaks when a child is prepended, inserted or removed', () => {
            const box = new Gtk.FlowBox({ maxChildrenPerLine: 2 });
            const a = label();
            const b = label();
            add(box, a);
            add(box, b);
            const first = label();
            box.prepend(first as unknown as never);
            expect(breaks(box, [first, a, b])).toStrictEqual([false, false, true]);
            const middle = label();
            box.insert(middle as unknown as never, 1);
            expect(breaks(box, [first, middle, a, b])).toStrictEqual([false, false, true, false]);
            box.remove(first as unknown as never);
            expect(breaks(box, [middle, a, b])).toStrictEqual([false, false, true]);
            box.insert(label() as unknown as never, -1);
            expect(box.getChildrenCount()).toBe(4);
        });

        await it('remove_all empties it and gives every margin back', () => {
            const box = new Gtk.FlowBox({ columnSpacing: 6 });
            const child = label();
            child.marginLeft = 2;
            add(box, child);
            box.remove_all();
            expect(box.getChildrenCount()).toBe(0);
            expect(child.marginLeft).toBe(2);
        });

        await it('walks its children with get_first_child / get_next_sibling', () => {
            const box = new Gtk.FlowBox();
            const a = label();
            const b = label();
            add(box, a);
            add(box, b);
            expect(box.get_first_child() === (a as unknown)).toBe(true);
            expect((a as unknown as Sibling).get_next_sibling() === (b as unknown)).toBe(true);
            expect((b as unknown as Sibling).get_next_sibling()).toBe(null);
        });
    });

    await describe('Gtk.FlowBox: grow', async () => {
        await it('homogeneous gives every child the same grow', () => {
            const box = new Gtk.FlowBox({ homogeneous: true });
            const a = label();
            const b = label();
            add(box, a);
            add(box, b);
            expect([FlexboxLayout.getFlexGrow(a), FlexboxLayout.getFlexGrow(b)]).toStrictEqual([1, 1]);
            box.homogeneous = false;
            expect([FlexboxLayout.getFlexGrow(a), FlexboxLayout.getFlexGrow(b)]).toStrictEqual([0, 0]);
        });

        await it('follows a child whose hexpand changes after it was added', () => {
            const box = new Gtk.FlowBox();
            const child = label();
            add(box, child);
            expect(FlexboxLayout.getFlexGrow(child)).toBe(0);
            (child as unknown as Sibling).hexpand = true;
            expect(FlexboxLayout.getFlexGrow(child)).toBe(1);
            (child as unknown as Sibling).hexpand = false;
            expect(FlexboxLayout.getFlexGrow(child)).toBe(0);
        });
    });

    await describe('Gtk.FlowBox: spacing', async () => {
        await it('puts half the gap on every facing edge', () => {
            const box = new Gtk.FlowBox({ columnSpacing: 4, rowSpacing: 8 });
            const child = label();
            add(box, child);
            expect([child.marginLeft, child.marginRight, child.marginTop, child.marginBottom]).toStrictEqual([
                2, 2, 4, 4,
            ]);
        });

        await it('SWAPS its share on a change and ADDS to the margin a child already carries', () => {
            const box = new Gtk.FlowBox({ columnSpacing: 4 });
            const child = label();
            child.marginLeft = 10;
            add(box, child);
            expect(child.marginLeft).toBe(12);
            box.columnSpacing = 8;
            expect(child.marginLeft).toBe(14);
            box.remove(child as unknown as never);
            expect(child.marginLeft).toBe(10);
        });

        await it('refuses a spacing the guint16 pspec would, and takes the XML string', () => {
            const box = new Gtk.FlowBox();
            expect(() => (box.rowSpacing = -1)).toThrow('is not a spacing');
            (box as unknown as Record<string, unknown>).columnSpacing = '3';
            expect(box.columnSpacing).toBe(3);
        });
    });

    await describe('Gtk.FlowBox: held properties and notifies', async () => {
        await it('holds selection-mode (default single) and takes a nick or the constant', () => {
            const box = new Gtk.FlowBox();
            expect(box.selectionMode).toBe('single');
            box.selectionMode = 'none';
            expect(box.selectionMode).toBe('none');
            (box as unknown as Record<string, unknown>).selectionMode = 3;
            expect(box.selectionMode).toBe('multiple');
            expect(() => ((box as unknown as Record<string, unknown>).selectionMode = 'many')).toThrow(
                'is not a Gtk.SelectionMode',
            );
        });

        await it('holds activate-on-single-click and min-children-per-line', () => {
            const box = new Gtk.FlowBox();
            expect(box.activateOnSingleClick).toBe(true);
            expect(box.minChildrenPerLine).toBe(0);
            box.activateOnSingleClick = false;
            box.minChildrenPerLine = 2;
            expect([box.activateOnSingleClick, box.minChildrenPerLine]).toStrictEqual([false, 2]);
        });

        await it('emits notify:: once per real change and not for a repeat', () => {
            const box = new Gtk.FlowBox();
            const seen: string[] = [];
            for (const name of ['column-spacing', 'homogeneous', 'max-children-per-line', 'selection-mode']) {
                box.addEventListener(`notify::${name}`, () => seen.push(name));
            }
            box.columnSpacing = 2;
            box.columnSpacing = 2;
            box.homogeneous = true;
            box.maxChildrenPerLine = 3;
            box.selectionMode = 'none';
            box.selectionMode = 'none';
            expect(seen).toStrictEqual(['column-spacing', 'homogeneous', 'max-children-per-line', 'selection-mode']);
        });

        await it('verbs on css-classes write the class name', () => {
            const box = new Gtk.FlowBox();
            box.add_css_class('card');
            expect(box.has_css_class('card')).toBe(true);
            expect(box.className).toBe('card');
            box.set_css_classes(['a', 'b']);
            expect(box.get_css_classes()).toStrictEqual(['a', 'b']);
            box.remove_css_class('a');
            expect(box.className).toBe('b');
        });
    });

    await describe('Gtk.FlowBox: the shared-tree door', async () => {
        await it('builds a card row the way auswertungen-view spells it', () => {
            const box = build({
                tag: 'GtkFlowBox',
                props: {
                    'selection-mode': 'none',
                    'min-children-per-line': 1,
                    'max-children-per-line': 3,
                    'column-spacing': 12,
                    'row-spacing': 12,
                    'activate-on-single-click': false,
                },
                children: [
                    { tag: 'GtkLabel', props: { label: 'A' } },
                    { tag: 'GtkLabel', props: { label: 'B' } },
                    { tag: 'GtkLabel', props: { label: 'C' } },
                    { tag: 'GtkLabel', props: { label: 'D' } },
                ],
            }) as unknown as Gtk.FlowBox;
            expect(box.selectionMode).toBe('none');
            expect(box.maxChildrenPerLine).toBe(3);
            expect(box.getChildrenCount()).toBe(4);
            const kids = Array.from({ length: 4 }, (_, i) => box.getChildAt(i) as unknown as View);
            expect(breaks(box, kids)).toStrictEqual([false, false, false, true]);
            expect(kids[0].marginLeft).toBe(6);
        });
    });
};
