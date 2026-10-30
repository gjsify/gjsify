// `Gtk.Box`, built as the REAL class against the platform double: the one-axis track list, the
// spare space an expanding child is handed, and the margins a box leaves alone.
//
// A layout PASS is not measurable here, so what is asserted is the `ItemSpec` list the box
// hands the platform and the cell each child is placed in — which IS the allocation rule: a `*`
// track gets the spare space, an `auto` track its natural size. The pure plan is held in
// `box-layout.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';
import { GridLayout, type ItemSpec, View } from './testing/ns-core.mjs';

const label = (): View => new Gtk.Label() as unknown as View;
const add = (box: Gtk.Box, view: View) => box.append(view as unknown as never);

/** The tracks along one axis as `kind` or `kind:px`, e.g. `['auto', 'pixel:12', 'star']`. */
function tracks(box: object, axis: 'columns' | 'rows'): string[] {
    const specs = (box as unknown as Record<string, ItemSpec[]>)[axis === 'columns' ? '_cols' : '_rows']!;
    return specs.map((spec) => (spec.gridUnitType === 'pixel' ? `pixel:${spec.value}` : spec.gridUnitType));
}

export const GtkBoxNsTest = async () => {
    await describe('Gtk.Box: orientation', async () => {
        await it('is horizontal by default, as GtkOrientable declares it', () => {
            expect(new Gtk.Box().orientation).toBe('horizontal');
        });

        await it('a vertical box stacks along the rows, a horizontal one along the columns', () => {
            const vertical = new Gtk.Box({ orientation: 'vertical' });
            const horizontal = new Gtk.Box();
            for (const box of [vertical, horizontal]) {
                add(box, label());
                add(box, label());
            }
            expect(tracks(vertical, 'rows')).toStrictEqual(['auto', 'pixel:0', 'auto']);
            expect(tracks(vertical, 'columns')).toStrictEqual(['star']);
            expect(tracks(horizontal, 'columns')).toStrictEqual(['auto', 'pixel:0', 'auto']);
            expect(tracks(horizontal, 'rows')).toStrictEqual(['star']);
        });

        await it('children sit in the even tracks, and an axis change moves them', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            const [a, b] = [label(), label()];
            add(box, a);
            add(box, b);
            expect([a, b].map((view) => GridLayout.getRow(view))).toStrictEqual([0, 2]);
            expect([a, b].map((view) => GridLayout.getColumn(view))).toStrictEqual([0, 0]);
            box.orientation = 'horizontal';
            expect([a, b].map((view) => GridLayout.getColumn(view))).toStrictEqual([0, 2]);
            expect([a, b].map((view) => GridLayout.getRow(view))).toStrictEqual([0, 0]);
        });

        await it('takes the Gtk.Orientation constant, and a word that is no nick leaves the default', () => {
            const box = new Gtk.Box();
            (box as unknown as Record<string, unknown>).orientation = 1;
            expect(box.orientation).toBe('vertical');
            (box as unknown as Record<string, unknown>).orientation = 'diagonal';
            expect(box.orientation).toBe('horizontal');
        });
    });

    await describe('Gtk.Box: spare space', async () => {
        await it('gives the spare height to a vexpand child of a vertical box — `*` for it, `auto` elsewhere', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            const [header, body, footer] = [label(), label(), label()];
            (body as unknown as Gtk.Label).vexpand = true;
            for (const view of [header, body, footer]) add(box, view);
            expect(tracks(box, 'rows')).toStrictEqual(['auto', 'pixel:0', 'star', 'pixel:0', 'auto']);
        });

        await it('reads hexpand in a horizontal box and ignores the cross axis', () => {
            const box = new Gtk.Box();
            const [a, b] = [label(), label()];
            (a as unknown as Gtk.Label).hexpand = true;
            (b as unknown as Gtk.Label).vexpand = true;
            add(box, a);
            add(box, b);
            expect(tracks(box, 'columns')).toStrictEqual(['star', 'pixel:0', 'auto']);
        });

        await it('re-plans when a child starts expanding after it was added', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            const child = label();
            add(box, child);
            expect(tracks(box, 'rows')).toStrictEqual(['auto']);
            (child as unknown as Gtk.Label).vexpand = true;
            expect(tracks(box, 'rows')).toStrictEqual(['star']);
            (child as unknown as Gtk.Label).vexpand = false;
            expect(tracks(box, 'rows')).toStrictEqual(['auto']);
        });

        await it('stops listening to a child that was removed', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            const [a, b] = [label(), label()];
            add(box, a);
            add(box, b);
            box.remove(a as unknown as never);
            (a as unknown as Gtk.Label).vexpand = true;
            expect(tracks(box, 'rows')).toStrictEqual(['auto']);
        });

        await it('a plain NativeScript view, which has no expand flag, is simply auto', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            add(box, new View());
            expect(tracks(box, 'rows')).toStrictEqual(['auto']);
        });

        await it('homogeneous makes every child `*`, expanding or not', () => {
            const box = new Gtk.Box({ homogeneous: true });
            add(box, label());
            add(box, label());
            expect(tracks(box, 'columns')).toStrictEqual(['star', 'pixel:0', 'star']);
            box.homogeneous = false;
            expect(tracks(box, 'columns')).toStrictEqual(['auto', 'pixel:0', 'auto']);
        });
    });

    await describe('Gtk.Box: spacing', async () => {
        await it('is a pixel track between children, so N children have N-1 gaps', () => {
            const box = new Gtk.Box({ orientation: 'vertical', spacing: 12 });
            for (let index = 0; index < 3; index++) add(box, label());
            expect(tracks(box, 'rows')).toStrictEqual(['auto', 'pixel:12', 'auto', 'pixel:12', 'auto']);
        });

        await it('re-plans when the spacing changes, and takes the XML string', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            add(box, label());
            add(box, label());
            (box as unknown as Record<string, unknown>).spacing = '6';
            expect(tracks(box, 'rows')[1]).toBe('pixel:6');
        });

        await it("LEAVES THE CHILDREN'S OWN MARGINS ALONE — the gap is a track, not a margin", () => {
            const box = new Gtk.Box({ orientation: 'vertical', spacing: 12 });
            const [a, b] = [label(), label()];
            b.marginTop = 7;
            b.marginLeft = 3;
            add(box, a);
            add(box, b);
            expect([b.marginTop, b.marginLeft]).toStrictEqual([7, 3]);
            expect(a.marginTop).toBe(0);
        });
    });

    await describe('Gtk.Box: the child verbs', async () => {
        await it('prepend, insert_child_after and reorder_child_after keep the cells in step with the order', () => {
            const box = new Gtk.Box({ orientation: 'vertical' });
            const [a, b, c] = [label(), label(), label()];
            add(box, a);
            add(box, b);
            box.prepend(c as unknown as never);
            expect([c, a, b].map((view) => GridLayout.getRow(view))).toStrictEqual([0, 2, 4]);
            expect(box.reorder_child_after(c as unknown as never, b as unknown as never)).toBe(true);
            expect([a, b, c].map((view) => GridLayout.getRow(view))).toStrictEqual([0, 2, 4]);
            const d = label();
            expect(box.insert_child_after(d as unknown as never, null)).toBe(true);
            expect(GridLayout.getRow(d)).toBe(0);
            expect(GridLayout.getRow(a)).toBe(2);
        });

        await it('a refused reorder leaves the plan alone', () => {
            const box = new Gtk.Box();
            const stranger = label();
            expect(box.reorder_child_after(stranger as unknown as never, null)).toBe(false);
        });
    });

    await describe('Gtk.Box: the tracks are applied as a diff', async () => {
        // Re-adding every `ItemSpec` and re-writing every cell on each child verb made a
        // 167-child box quadratic — `box-layout.ts`'s `boxTrackDiff` holds the measurement.
        // What has to stay true is that the box an incremental apply leaves behind is the box
        // a rebuild would have left, for every verb and in both directions.

        /** A vertical box with `count` plain children, and the children in order. */
        const grid = (count: number): { box: Gtk.Box; children: View[] } => {
            const box = new Gtk.Box({ orientation: 'vertical', spacing: 12 });
            const children = Array.from({ length: count }, () => label());
            for (const child of children) add(box, child);
            return { box, children };
        };

        /** Both track lists and every child's cell — the whole answer the platform was given. */
        const applied = (box: Gtk.Box, children: readonly View[]): string =>
            [
                tracks(box, 'rows').join(' '),
                tracks(box, 'columns').join(' '),
                children.map((view) => `${GridLayout.getRow(view)}/${GridLayout.getColumn(view)}`).join(' '),
            ].join(' | ');

        await it('an append reaches what building that many children at once reaches', () => {
            const grown = grid(3);
            const extra = label();
            add(grown.box, extra);
            const fresh = grid(4);
            expect(applied(grown.box, [...grown.children, extra])).toBe(applied(fresh.box, fresh.children));
        });

        await it('removing the tail from the END backwards leaves the shorter box exactly', () => {
            const big = grid(6);
            for (let index = 5; index >= 2; index--) big.box.remove(big.children[index] as unknown as never);
            const fresh = grid(2);
            expect(applied(big.box, big.children.slice(0, 2))).toBe(applied(fresh.box, fresh.children));
        });

        await it('re-appending a detached tail restores the box it was detached from', () => {
            const { box, children } = grid(6);
            const before = applied(box, children);
            for (let index = 5; index >= 2; index--) box.remove(children[index] as unknown as never);
            for (let index = 2; index < 6; index++) box.append(children[index] as unknown as never);
            expect(applied(box, children)).toBe(before);
        });

        await it('a removal from the MIDDLE renumbers every child behind it', () => {
            const { box, children } = grid(4);
            box.remove(children[1] as unknown as never);
            const fresh = grid(3);
            expect(applied(box, [children[0], children[2], children[3]])).toBe(applied(fresh.box, fresh.children));
        });

        await it('a spacing change rewrites the gap tracks and leaves the cells where they are', () => {
            const { box, children } = grid(3);
            const cells = children.map((view) => GridLayout.getRow(view));
            box.spacing = 6;
            expect(tracks(box, 'rows')).toStrictEqual(['auto', 'pixel:6', 'auto', 'pixel:6', 'auto']);
            expect(children.map((view) => GridLayout.getRow(view))).toStrictEqual(cells);
        });

        await it('flipping the axis twice leaves the old axis no tracks of its own', () => {
            const { box, children } = grid(3);
            const before = applied(box, children);
            box.orientation = 'horizontal';
            box.orientation = 'vertical';
            expect(applied(box, children)).toBe(before);
        });
    });

    await describe('Gtk.Box: style classes', async () => {
        await it('is transparent until a class is given, and keeps the verbs and the string door', () => {
            const box = new Gtk.Box();
            expect(box.className).toBe(undefined);
            box.add_css_class('card');
            expect(box.className).toBe('card');
            box.styleClasses = 'linked toolbar';
            expect(box.get_css_classes()).toStrictEqual(['linked', 'toolbar']);
            expect(box.has_css_class('card')).toBe(false);
        });
    });

    await describe('Gtk.Box: the shared-tree door', async () => {
        await it('builds the projected spelling: orientation nick, spacing, an expanding child, base props', () => {
            const box = build({
                tag: 'GtkBox',
                props: { orientation: 'vertical', spacing: 6, 'width-request': 200 },
                children: [{ tag: 'GtkLabel' }, { tag: 'GtkLabel', props: { vexpand: true } }],
            }) as unknown as Gtk.Box;
            expect(box.orientation).toBe('vertical');
            expect(box.widthRequest).toBe(200);
            expect(tracks(box, 'rows')).toStrictEqual(['auto', 'pixel:6', 'star']);
        });
    });
};
