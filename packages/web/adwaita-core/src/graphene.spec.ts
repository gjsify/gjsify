// The Graphene.Point subset and the computation behind `Gtk.Widget.compute_point`, on stand-in
// nodes: core has no DOM, so a node here is a root and a box.

import { describe, expect, it } from '@gjsify/unit';

import { Point, computePoint, type PointNode } from './graphene.js';

const node = (root: object, left: number, top: number): PointNode => ({
    getRootNode: () => root,
    getBoundingClientRect: () => ({ left, top }),
});

export default async () => {
    await describe('Graphene.Point', async () => {
        await it('is the origin by default and from zero()', () => {
            expect(new Point().x).toBe(0);
            expect(new Point().y).toBe(0);
            expect(Point.zero().x).toBe(0);
            expect(Point.zero().y).toBe(0);
        });

        await it('takes x and y from the constructor props, each optional', () => {
            const point = new Point({ x: 3, y: -4 });
            expect(point.x).toBe(3);
            expect(point.y).toBe(-4);
            expect(new Point({ y: 2 }).x).toBe(0);
        });

        await it('init() sets both and returns the point', () => {
            const point = new Point();
            expect(point.init(5, 6)).toBe(point);
            expect(point.x).toBe(5);
            expect(point.y).toBe(6);
        });
    });

    await describe('computePoint', async () => {
        await it('moves the point by the offset of the source from the target', () => {
            const root = {};
            const [ok, point] = computePoint(node(root, 14, 130), node(root, 10, 100), new Point({ x: 1, y: 2 }));
            expect(ok).toBe(true);
            expect(point.x).toBe(5);
            expect(point.y).toBe(32);
        });

        await it('does not touch the point it was given', () => {
            const root = {};
            const given = new Point({ x: 1, y: 2 });
            computePoint(node(root, 14, 130), node(root, 10, 100), given);
            expect(given.x).toBe(1);
            expect(given.y).toBe(2);
        });

        await it('gives false and the origin when the nodes share no tree', () => {
            const [ok, point] = computePoint(node({}, 14, 130), node({}, 10, 100), new Point({ x: 1, y: 2 }));
            expect(ok).toBe(false);
            expect(point.x).toBe(0);
            expect(point.y).toBe(0);
        });
    });
};
