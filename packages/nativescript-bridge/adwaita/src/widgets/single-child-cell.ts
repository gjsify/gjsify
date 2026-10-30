// How a one-child container sizes its single `GridLayout` cell — the pure half of
// `single-child-base.ts`, free of `@nativescript/core` so the spec suite can drive it.
//
// A `star` cell takes the whole width the container was offered; an `auto` cell measures the
// child UNCONSTRAINED and lets the container shrink to it. GTK has no such switch, because a
// GTK widget is measured and then allocated: `Adw.Bin` with `halign: end` reports its child's
// natural width and is placed at the right edge of whatever it was given. `auto` is how that
// is said here, and `horizontalAlignment` was the whole of the question — until a container
// turned up whose width was ALREADY settled.
//
// THE INCIDENT. Learn6502's tutorial page is `Adw.Clamp { Adw.Bin { … } }` and the clamp does
// what libadwaita's does: it allocates the child a width and centres it. The port says that
// in NativeScript's vocabulary — `child.width = <dips>` and `child.horizontalAlignment =
// 'center'` — and the Bin read only the second half. It took an `auto` cell, measured its
// subtree with no width at all, and the ~350 wrapped `Gtk.Label`s inside the tutorial each
// measured at their full natural width: 17900px against a 1216px Bin. Every paragraph came
// out as one clipped line on Android while the same `.blp` wrapped correctly on GNOME and the
// web, which is exactly as hard to read as it sounds.
//
// So the question is "is this container's width already settled?", and alignment is only one
// of the two ways it can be. A definite `width` is the other: the container is that wide
// whatever its alignment says, so the cell inside it is the whole of that width — `star` —
// and the child is measured against it. `horizontalAlignment` still decides where the
// container itself sits, which is the part the clamp wanted.
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c (adw_clamp_layout_allocate)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * Whether a definite width has been written — NativeScript's `Length`, which is `'auto'`
 * when nothing has.
 *
 * A number is DIPs and an object is `{ value, unit }`; both count only when positive, because
 * a zero width is a container with nothing to give and `auto` is the honest answer for it.
 */
function widthIsSettled(width: unknown): boolean {
    if (typeof width === 'number') return Number.isFinite(width) && width > 0;
    if (typeof width !== 'object' || width === null) return false;
    const value = (width as { value?: unknown }).value;
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Whether the single cell of a one-child container is `star` rather than `auto`.
 *
 * `star` when the container's width is settled — either because it stretches to its parent,
 * or because a definite `width` was written on it. `auto` otherwise, so the container can
 * still report its child's natural width and be placed by its alignment.
 */
export function singleChildCellIsStar(horizontalAlignment: unknown, width: unknown): boolean {
    return horizontalAlignment === 'stretch' || widthIsSettled(width);
}
