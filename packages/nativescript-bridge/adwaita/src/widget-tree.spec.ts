// The `Gtk.Widget` tree members every NativeScript widget carries — `get_first_child` and its
// siblings, `get_parent`, `set_direction`. Built as the REAL classes against the platform double
// (the TREES entry), because a scroller's inner `ScrollView` is the case worth measuring: GTK has
// no such layer, so the walk must see through it.

import { describe, expect, it } from '@gjsify/unit';
import { Point } from '@gjsify/adwaita-core';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

export const GtkWidgetTreeNsTest = async () => {
    await describe('Gtk.Widget tree members', async () => {
        await it('walks first child to next sibling', () => {
            const box = new Gtk.Box();
            const first = new Gtk.Label();
            const second = new Gtk.Label();
            box.append(first);
            box.append(second);
            expect(box.get_first_child()).toBe(first);
            expect(box.get_last_child()).toBe(second);
            expect(first.get_next_sibling()).toBe(second);
            expect(second.get_prev_sibling()).toBe(first);
            expect(second.get_next_sibling()).toBeNull();
            expect(first.get_parent()).toBe(box);
        });

        await it("sees through the scroller's inner view to the widget", () => {
            const scrolled = new Gtk.ScrolledWindow();
            const child = new Gtk.Label();
            scrolled.set_child(child);
            expect(scrolled.get_first_child()).toBe(child);
        });

        await it('computes a point from window locations, in the unit getActualSize answers in', () => {
            const box = new Gtk.Box();
            const label = new Gtk.Label();
            box.append(label);
            const at = (view: object, x: number, y: number) =>
                ((view as { getLocationInWindow(): { x: number; y: number } }).getLocationInWindow = () => ({ x, y }));
            at(box, 10, 100);
            at(label, 14, 130);
            const [ok, point] = label.compute_point(box, Point.zero());
            expect(ok).toBe(true);
            expect(point.x).toBe(4);
            expect(point.y).toBe(30);
            const [back, offset] = box.compute_point(label, new Point({ x: 1, y: 2 }));
            expect(back).toBe(true);
            expect(offset.x).toBe(-3);
            expect(offset.y).toBe(-28);
        });

        await it('computes no point between widgets that share no tree', () => {
            const first = new Gtk.Label();
            const second = new Gtk.Label();
            const [ok, point] = first.compute_point(second, new Point({ x: 5, y: 5 }));
            expect(ok).toBe(false);
            expect(point.x).toBe(0);
            expect(point.y).toBe(0);
        });

        await it('reads back the direction it was given', () => {
            const bin = new Adw.Bin();
            expect(bin.get_direction()).toBe(Gtk.TextDirection.LTR);
            bin.set_direction(Gtk.TextDirection.RTL);
            expect(bin.get_direction()).toBe(Gtk.TextDirection.RTL);
            expect(() => bin.set_direction(9)).toThrow();
        });
    });
};
