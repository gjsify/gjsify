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
// and a string is the only thing that survives an XML attribute, and the CONSTANT is a
// second accepted spelling so a snippet ported off GJS keeps working. Like `gtk-align.ts`,
// then, this file carries a value table — and the constant is coerced in the CONSTRUCT-PROPS
// BAG and nowhere else: a setter widened to admit a number would drag it into the XML
// ATTRIBUTE door, which has no coercer. The table is only worth having with an oracle beside
// it, which is arm 7 of `check-nativescript-xml-doors.mjs`: it holds the derived constants
// against the typelib-read `ENUM_VALUES`, so the derivation is CHECKED, not asserted.
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

/**
 * Every `Gtk.IconSize` member, nick to constant.
 *
 * The positions ARE the values here, and that is a fact about THIS enum rather than a
 * shortcut: no member of `Gtk.IconSize` is an alias, so nothing shifts below anything.
 * `Gtk.Align` is the counter-example the sibling file is built around — `GTK_ALIGN_BASELINE`
 * was deprecated into an alias in GTK 4.12, so 2 of its 7 members are not their position —
 * which is why this is DERIVED from the nick order and then held against the committed,
 * typelib-read `ENUM_VALUES` in `packages/framework/gtk-host/src/generated/enum-values.mts`
 * by arm 7 of `check-nativescript-xml-doors.mjs`. A derivation that happens to be right is
 * worth nothing without the oracle beside it.
 */
export const GTK_ICON_SIZE: Readonly<Record<GtkIconSizeNick, number>> = Object.freeze(
    Object.fromEntries(GTK_ICON_SIZE_NICKS.map((nick, index) => [nick, index])),
) as Readonly<Record<GtkIconSizeNick, number>>;

/** Is `value` one of the three members? */
export function isGtkIconSizeNick(value: unknown): value is GtkIconSizeNick {
    return typeof value === 'string' && (GTK_ICON_SIZE_NICKS as readonly string[]).includes(value);
}

/**
 * A `Gtk.IconSize` value as its NICK — the nick itself, or the constant a GJS caller's
 * `Gtk.IconSize.LARGE` is.
 *
 * A NON-NUMBER goes back unchanged, for the SETTER to refuse with the one message that names
 * the three members — one refusal, not two. A number that is no member is refused HERE
 * instead, and the two are not the same mistake: by writing a number the caller has said
 * "constant", so the setter could only report it as a bad nick, where `24` is a size in DIPs
 * written under the wrong name and the throw can say exactly that.
 *
 * ADR 0034 § 4's second spelling, and it lives HERE rather than in the setter on purpose: a
 * setter that widened its declared type to admit the constant would drag the number into the
 * XML ATTRIBUTE door, which has no coercer. The construct-props bag is the one door that
 * carries a real JS value, so it is the one that coerces — the arrangement `Gtk.Align`
 * already has in `construct-props.ts`.
 */
export function iconSizeNickOf(value: unknown): unknown {
    if (typeof value !== 'number') return value;
    const nick = GTK_ICON_SIZE_NICKS.find((name) => GTK_ICON_SIZE[name] === value);
    if (nick !== undefined) return nick;
    throw new TypeError(
        `${value} is not a Gtk.IconSize constant. The three members are ` +
            `${GTK_ICON_SIZE_NICKS.join(', ')}, holding the values ` +
            `${GTK_ICON_SIZE_NICKS.map((name) => GTK_ICON_SIZE[name]).join(', ')}. For a size in ` +
            'DIPs use `pixelSize`, which is what `Gtk.Image:pixel-size` is.',
    );
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
 * `fallback` is NAMED IN THE MESSAGE and never returned — this throws. The widget's current
 * setting survives because nothing was assigned to it, not because of this parameter; the
 * parameter is there so the error can say which setting that is.
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
 * GTK's "`pixel-size` is not set" sentinel — what `gtk_image_get_pixel_size` answers when
 * the icon size is in charge.
 *
 * A sentinel rather than `null` because it is the value the PROPERTY carries: a getter that
 * answered the size the image happens to draw at would make `image.pixelSize =
 * image.pixelSize` PIN that size, and the setter falls back to the getter (every number
 * setter in this package does — `xmlNumber(raw, this.<prop>)`), so an unparseable
 * assignment would pin it too.
 */
export const PIXEL_SIZE_UNSET = -1;

/** An assignment to `pixel-size` as the value to store: a positive size, or the sentinel. */
export function storedPixelSize(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : PIXEL_SIZE_UNSET;
}

/**
 * The size to draw at, in DIPs: the explicit `pixelSize` when there is one, else what
 * `iconSize` resolves to.
 *
 * That precedence is `Gtk.Image`'s own — `gtk_image_set_pixel_size` documents -1 as "unset,
 * the icon size decides" and any other value as an override. Any non-positive or non-finite
 * value reads as unset here, because a 0-DIP image is not a rendering anyone asked for.
 */
export function iconPixelSize(iconSize: GtkIconSizeNick, pixelSize: number): number {
    if (Number.isFinite(pixelSize) && pixelSize > 0) return pixelSize;
    return GTK_ICON_SIZE_PIXELS[iconSize];
}
