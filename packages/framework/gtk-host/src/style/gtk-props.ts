// Which WIDGET properties exist, and on which class — measured, not read.
//
// `gtk-css.ts` answers the same question for GTK's CSS parser. This file is its
// other half, and the layout partition needs both because the two authorities
// disagree about exactly the properties layout cares about: GTK CSS has
// `margin-left` and no `margin-start`; `Gtk.Widget` has `margin-start` and no
// `margin-left`. A layer that knew only one of the two lists would route half its
// input into a mechanism that does not have it.
//
// The failure mode is milder than the CSS one — the host's `applyProps` looks a
// property up in the class's ParamSpecs and refuses an unknown name — but it is
// milder in the wrong place: it fails at attach time, in a CONSUMER's window,
// against a class this package chose. Committing the measurement moves that
// failure into this package's own test run.
//
// Measured on GTK 4.22.4 via `list_properties()` on the class. THREE results
// carry the layout partition, and all three are the NEGATIVE direction:
//
//   1. **No widget has `padding` of any kind.** Padding is CSS-only on GTK, with
//      no second route. That is why `p-*` never becomes a widget property while
//      `m-*` partly does.
//   2. **No widget has `margin-left`/`margin-right`.** The widget's margins are
//      LOGICAL (`margin-start`/`margin-end`, which flip under RTL); the physical
//      spelling exists only in CSS. The two are not interchangeable, and the
//      split in `layout.ts` is that sentence turned into code.
//   3. **`orientation` and `spacing` are NOT on `Gtk.Widget`.** They are
//      `Gtk.Box`'s (via `Gtk.Orientable` for the first), so `flex-row` and
//      `gap-*` are properties L1 can name but only L2 can legally apply — a
//      `Gtk.Label` has neither, and `Gtk.CenterBox` has `orientation` and no
//      `spacing` at all.
//
// The value type is measured with the name because "the property exists" and
// "this value fits" are different questions and only the pair is testable:
// `margin-top` is a `gint` of device pixels, which is why a spacing token spelled
// in `rem` reaches the CSS channel unchanged and is refused by this one.

/**
 * Properties GTK installs, with the GType of their value.
 *
 * `GtkWidget` rows are the universal set — every widget in the table inherits
 * them, which is what lets `layout.ts` emit them without knowing the tag.
 */
export const GTK_WIDGET_PROPERTY_PROBES: ReadonlyArray<readonly [gtype: string, property: string, valueType: string]> =
    [
        ['GtkWidget', 'margin-top', 'gint'],
        ['GtkWidget', 'margin-bottom', 'gint'],
        ['GtkWidget', 'margin-start', 'gint'],
        ['GtkWidget', 'margin-end', 'gint'],
        ['GtkWidget', 'halign', 'GtkAlign'],
        ['GtkWidget', 'valign', 'GtkAlign'],
        ['GtkWidget', 'hexpand', 'gboolean'],
        ['GtkWidget', 'vexpand', 'gboolean'],
        ['GtkWidget', 'width-request', 'gint'],
        ['GtkWidget', 'height-request', 'gint'],
        ['GtkWidget', 'overflow', 'GtkOverflow'],
        ['GtkWidget', 'visible', 'gboolean'],
        ['GtkBox', 'orientation', 'GtkOrientation'],
        ['GtkBox', 'spacing', 'gint'],
        ['GtkLabel', 'xalign', 'gfloat'],
        ['GtkLabel', 'justify', 'GtkJustification'],
    ];

/**
 * Properties the class does NOT install, and the claim each one carries.
 *
 * Without this direction the table above could name every property in GTK and
 * still pass — and every routing decision in `layout.ts` rests on an absence
 * rather than on a presence.
 */
export const NOT_GTK_WIDGET_PROPERTIES: ReadonlyArray<readonly [gtype: string, property: string]> = [
    // Physical margins and padding of every kind: CSS's, not the widget's.
    ['GtkWidget', 'margin-left'],
    ['GtkWidget', 'margin-right'],
    ['GtkWidget', 'padding'],
    ['GtkWidget', 'padding-top'],
    ['GtkBox', 'padding'],
    ['GtkBox', 'margin-left'],
    // The web layout model, absent here exactly as it is absent from GTK CSS.
    ['GtkWidget', 'gap'],
    ['GtkBox', 'gap'],
    ['GtkWidget', 'flex'],
    // Not universal, which is the whole reason `flex-row` and `gap-*` cannot be
    // applied without knowing the widget.
    ['GtkWidget', 'orientation'],
    ['GtkWidget', 'spacing'],
    ['GtkLabel', 'orientation'],
    ['GtkLabel', 'spacing'],
    ['GtkCenterBox', 'spacing'],
    ['GtkFlowBox', 'spacing'],
    // Only a text widget aligns text, which is why `text-center` is an intent.
    ['GtkWidget', 'xalign'],
    ['GtkBox', 'xalign'],
];

/**
 * The property NAMES of {@link GTK_WIDGET_PROPERTY_PROBES}, for a membership test.
 *
 * NAMES ONLY, deliberately weaker than the table: L1 does not know which widget a
 * class list will land on, so the strongest guard it can run is "GTK installs a
 * property by this name SOMEWHERE in the vocabulary". `orientation` passes it on
 * an element that turns out to be a `Gtk.Label`, and refusing that is L2's job,
 * with the tag in hand. Reading this set as "every widget has these" is the one
 * mistake it invites, and `GTK_WIDGET_PROPERTY_PROBES` is the table that answers
 * the per-class question.
 */
export const GTK_WIDGET_PROPERTIES: ReadonlySet<string> = new Set(
    GTK_WIDGET_PROPERTY_PROBES.map(([, property]) => property),
);
