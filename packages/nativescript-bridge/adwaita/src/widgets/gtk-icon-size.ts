// `Gtk.IconSize` on a target that has no GI — the three members, what each renders at,
// and how an explicit pixel size overrides them.
//
// WHY IT EXISTS. `Gtk.Image` carries TWO size properties and the port carried one of them
// under the other's name (#1584): `iconSize` took a number of DIPs, which is
// `Gtk.Image:pixel-size`'s meaning, while `Gtk.Image:icon-size` is this three-member enum.
// A name that agrees and a value that does not is worse than a name that never matched,
// because the disagreement is invisible at the call site and to every gate — and
// `check-vocabulary-alignment` counted the pair as agreement, comparing names against a key
// set and never reading a type. `<gtk:Image iconSize="large" />` — which is what a reader of
// the GTK documentation writes, and one of exactly three legal values there — went through
// `xmlNumber`, failed to parse, fell back, and rendered at 16 DIPs with nothing reported.
//
// ADR 0034 § 4: for an enum the convergent spelling is the NICK, because a nick is a string
// and a string is the only thing that survives an XML attribute. Unlike `gtk-align.ts` this
// file declares NO constants: the numeric spelling would have to be coerced to a nick inside
// the construct-props bag (a setter must not widen to admit it, or the number reaches the
// ATTRIBUTE door, which has no coercer), and that coercion needs its own gate arm to be
// worth having. `status/open-todos.md` carries it as an open item rather than as a table
// nothing checks.
//
// THE SIZES ARE MEASURED, not remembered. On GTK 4.22.4 under gjs 1.88.1, one `Gtk.Image`
// per member with an icon-name set, presented and then `measure()`d on both axes:
//
//   | member  | min = natural | css class      |
//   |---------|---------------|----------------|
//   | inherit | 16x16         | (none)         |
//   | normal  | 16x16         | `normal-icons` |
//   | large   | 32x32         | `large-icons`  |
//
// Reference: refs/gtk gtk/gtkenums.h (GtkIconSize), gtk/theme/Default (`-gtk-icon-size`).
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/**
 * Every `Gtk.IconSize` member, in GIR declaration order.
 *
 * Held against `GtkIconSizeNick` in `packages/framework/gtk-host/src/generated/props.ts` by
 * arm 7 of `scripts/check-nativescript-xml-doors.mjs` — in-repo, GIR-derived, emitted by a
 * generator that has never heard of this port — so this array is a copy that cannot drift
 * rather than a second source. No member is an alias, so unlike `Gtk.Align` the positions
 * ARE the values.
 */
export const GTK_ICON_SIZE_NICKS = ['inherit', 'normal', 'large'] as const;

/** One of the three `Gtk.IconSize` members, spelled as its nick. */
export type GtkIconSizeNick = (typeof GTK_ICON_SIZE_NICKS)[number];

/**
 * What each member renders at, in DIPs — the measurement in this file's header.
 *
 * `inherit` means "take the size from the context" on GTK, where a parent's
 * `-gtk-icon-size` cascades. NativeScript has no such cascade — an `Image` is sized by its
 * own `width`/`height` and nothing inherits one — so there is nothing here to inherit FROM,
 * and the honest reading of `inherit` is the size GTK itself falls back to when no ancestor
 * sets one, which the measurement puts at 16. That it equals `normal` is not a coincidence
 * to be tidied away: the two agree on GTK too, and they would stop agreeing the day this
 * port grows a context that carries a size.
 */
export const GTK_ICON_SIZE_PIXELS: Readonly<Record<GtkIconSizeNick, number>> = {
    inherit: 16,
    normal: 16,
    large: 32,
};

/** The size an icon draws at when neither property was set — the Adwaita 16px symbolic grid. */
export const DEFAULT_ICON_PIXEL_SIZE = GTK_ICON_SIZE_PIXELS.inherit;

/** Is `value` one of the three members? */
export function isGtkIconSizeNick(value: unknown): value is GtkIconSizeNick {
    return typeof value === 'string' && (GTK_ICON_SIZE_NICKS as readonly string[]).includes(value);
}

/**
 * `value` as a `Gtk.IconSize` member, or a THROW naming what it was and what is accepted.
 *
 * The one setter in this package that refuses rather than falling back, and the reason is
 * the defect it replaces: a number setter fed `'large'` substituted its default, so a typo,
 * a value copied out of the GTK documentation and a deliberate choice all produced the same
 * silent 16 DIPs. There are exactly three legal values and no range to be lenient about, so
 * "not one of them" is a caller mistake and nothing else — the same reasoning
 * `parseWidgetSelector`'s empty-selector refusal follows, and the opposite of `xmlNumber`,
 * which is lenient because a number genuinely has a sensible default.
 *
 * `fallback` is the value the caller keeps, and it is a parameter rather than a constant so
 * a widget's existing setting survives a rejected assignment.
 */
export function gtkIconSizeNick(value: unknown, fallback: GtkIconSizeNick): GtkIconSizeNick {
    if (isGtkIconSizeNick(value)) return value;
    throw new TypeError(
        `Gtk.IconSize: ${JSON.stringify(value)} is not a member — it takes one of ` +
            `${GTK_ICON_SIZE_NICKS.join(', ')} (staying at '${fallback}'). For a size in DIPs use ` +
            '`pixelSize`, which is what `Gtk.Image:pixel-size` is.',
    );
}

/**
 * The size to draw at, in DIPs: the explicit `pixelSize` when there is one, else what
 * `iconSize` resolves to.
 *
 * That precedence is `Gtk.Image`'s own — `gtk_image_set_pixel_size` documents -1 as "unset,
 * the icon size decides" and any other value as an override. Here a non-positive or
 * non-finite `pixelSize` means the same thing, because a 0-DIP image is not a rendering
 * anyone asked for.
 */
export function iconPixelSize(iconSize: GtkIconSizeNick, pixelSize: number | null): number {
    if (pixelSize !== null && Number.isFinite(pixelSize) && pixelSize > 0) return pixelSize;
    return GTK_ICON_SIZE_PIXELS[iconSize];
}
