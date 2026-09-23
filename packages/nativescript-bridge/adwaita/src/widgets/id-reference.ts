// An object-valued property written as an ID, resolved against the tree the view is in —
// the XML door's half of what `builderReferences` does for the shared-tree builder.
//
// WHY THE XML DOOR NEEDS ITS OWN HALF. NativeScript's `Builder.load` assigns every attribute
// as the raw string (`instance[name] = value`), so `<adw:CarouselIndicatorDots
// carousel="carousel" />` hands the widget the string "carousel", and at that moment the
// indicator is not in a tree yet — Builder adds a child to its parent after the child's
// attributes are written. GtkBuilder answers the same question after the whole file is
// parsed; the platform's equivalent point is the `loaded` event, emitted once the view is
// attached to a loaded tree, by which time every view the file made exists. So a widget keeps the id
// and resolves it there, and an id nothing in the tree carries is refused, as GtkBuilder
// refuses an unknown object id, rather than left as a binding that never happens.

import type { View } from '@nativescript/core';

/**
 * The id of another view in the same tree, as an object-valued setter takes it from XML.
 * A plain string at runtime; the NAME is the declaration `check-nativescript-xml-doors.mjs`
 * reads, so a setter annotated `<Something> | ViewId` is held to resolving it through
 * {@link resolveIdReference} rather than keeping the string.
 */
export type ViewId = string;

/** The topmost view `view` is mounted under — the tree an id in its file names into. */
function rootOf(view: View): View {
    let root = view;
    while (root.parent !== null && root.parent !== undefined) root = root.parent;
    return root;
}

/**
 * The view with `id` in the tree `view` is mounted in, which must be an instance of `Type`,
 * or throw naming the property and the id.
 */
export function resolveIdReference<T extends View>(
    view: View,
    property: string,
    id: string,
    Type: abstract new (...args: never[]) => T,
): T {
    const found = rootOf(view).getViewById(id);
    if (found instanceof Type) return found;
    throw new Error(
        `${view.constructor.name}.${property}="${id}" names no ${Type.name} in this tree: ` +
            (found === undefined ? `nothing carries the id '${id}'.` : `'${id}' is a ${found.constructor.name}.`),
    );
}
