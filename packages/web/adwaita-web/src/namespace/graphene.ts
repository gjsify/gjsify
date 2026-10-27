// The Graphene half of `@gjsify/adwaita-web`'s vocabulary: `Graphene.Point`, the type
// `Gtk.Widget.compute_point` takes and returns. The behaviour lives once in `@gjsify/adwaita-core`
// (`graphene.ts`).
//
// `compute_point` is installed on `WidgetElement` HERE rather than in `widget-element.ts`: that file
// is the helper every element sits one hop below, and a value import of core there would mark every
// element core-backed. Loading this namespace is what puts the method on a built-in.
//
// A TRUE SUBSET: everything else in Graphene is absent, and the `gi://Graphene` arm refuses it by name.

import { computePoint, Point } from '@gjsify/adwaita-core';

import { WidgetElement } from '../widget-element.js';

declare module '../widget-element.js' {
    interface WidgetElement {
        /** `gtk_widget_compute_point`: `[false, (0, 0)]` when the two share no tree. */
        compute_point(target: WidgetElement, point: Point): [boolean, Point];
    }
}

WidgetElement.prototype.compute_point = function (this: WidgetElement, target, point) {
    return computePoint(this, target, point);
};

export { Point };
