// Readers over the REAL GTK tree, in one module because every one of them is a walk.
//
// The rule these serve is the one this package exists for: a vector must read the
// GTK tree, never our shadow tree, which would happily agree with itself.

import GObject from 'gi://GObject?version=2.0';
import type Gtk from '@girs/gtk-4.0';

/** Direct GTK children of a widget, in GTK's own order. */
export function gtkChildren(widget: Gtk.Widget): Gtk.Widget[] {
    const out: Gtk.Widget[] = [];
    const w = widget as unknown as { get_first_child?: () => Gtk.Widget | null };
    if (typeof w.get_first_child !== 'function') return out;
    for (
        let c = w.get_first_child();
        c;
        c = (c as unknown as { get_next_sibling(): Gtk.Widget | null }).get_next_sibling()
    ) {
        out.push(c);
    }
    return out;
}

/** GType names of a widget's direct children — the cheap shape assertion. */
export const gtkChildTypes = (widget: Gtk.Widget): string[] =>
    gtkChildren(widget).map((c) =>
        GObject.type_name((c as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype),
    );

/**
 * First STRICT descendant matching `pred`, breadth-first over the REAL GTK tree.
 *
 * Both showcase probes wrote this, identically. It excludes the root on purpose:
 * every caller is asking "what did the renderer put INSIDE this", and a root that
 * matches its own predicate answers a different question.
 *
 * Breadth-first is not incidental either — `findDescendant(root, w => w instanceof
 * Gtk.Box)` on an Adwaita window finds an INTERNAL box of the header bar before
 * anything the author wrote, which is why a probe that needs a specific widget
 * reaches it through a landmark (a button's `get_parent()`) rather than by type.
 * Measured: with a search-by-type version, authoring `orientation="horizontal"`
 * still printed PROBE: PASS with byte-identical output.
 */
export function findDescendant(root: Gtk.Widget, pred: (widget: Gtk.Widget) => boolean): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [root];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (widget !== root && pred(widget)) return widget;
        queue.push(...gtkChildren(widget));
    }
    return null;
}

/**
 * Every widget in a subtree, ROOT FIRST and depth-first — GTK's own document order.
 *
 * Depth-first and not breadth-first, because the callers that collect (rather than
 * search) are asserting on ORDER: "the rows land before the counter row" is only a
 * claim about the tree if the walk visits it the way the tree reads.
 */
export function descendants(root: Gtk.Widget): Gtk.Widget[] {
    const out: Gtk.Widget[] = [root];
    for (const child of gtkChildren(root)) out.push(...descendants(child));
    return out;
}

/** Recursive GType dump — what a devtools tree walk would show. */
export function dumpTree(widget: Gtk.Widget, depth = 0): string {
    const name = GObject.type_name(
        (widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype,
    );
    const lines = [`${'  '.repeat(depth)}${name}`];
    for (const child of gtkChildren(widget)) lines.push(dumpTree(child, depth + 1));
    return lines.join('\n');
}
