// The Graphene slice `Gtk.Widget.compute_point` is written in: `Graphene.Point`, and the one
// computation behind `compute_point` for a widget that is a DOM element.
//
// A TRUE SUBSET of Graphene.Point: the `{ x, y }` constructor, `Point.zero()`, `init()` and the
// `x` / `y` fields. Everything else is absent. Remainder: Graphene stores float32, a Point here
// holds the number it was given.
//
// Reference: graphene src/graphene-point.c (graphene_point_init, graphene_point_zero),
// GTK gtk/gtkwidget.c (gtk_widget_compute_point)
// Copyright (c) GNOME contributors (Graphene, GTK). MIT / LGPLv2.1+.

/** `Graphene.Point`: a position in two dimensions. */
export class Point {
    x = 0;
    y = 0;

    constructor(props?: Partial<{ x: number; y: number }>) {
        if (props?.x !== undefined) this.x = props.x;
        if (props?.y !== undefined) this.y = props.y;
    }

    /** `graphene_point_zero`: the origin. */
    static zero(): Point {
        return new Point();
    }

    /** `graphene_point_init`. */
    init(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }
}

/** The slice of a DOM element `compute_point` reads; core has no DOM lib. */
export interface PointNode {
    getRootNode(): unknown;
    getBoundingClientRect(): { readonly left: number; readonly top: number };
}

/**
 * `gtk_widget_compute_point`: `point` in the coordinates of `source`, as a point in those of
 * `target`. Two elements have a common ancestor when they are in the same tree, which is the same
 * root node; a tree that does not reach the other gives `[false, (0, 0)]`, as GTK does.
 */
export function computePoint(source: PointNode, target: PointNode, point: Point): [boolean, Point] {
    if (source.getRootNode() !== target.getRootNode()) return [false, new Point()];
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    return [true, new Point({ x: point.x + (from.left - to.left), y: point.y + (from.top - to.top) })];
}
