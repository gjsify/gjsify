// `GtkWidget:css-classes` for the NativeScript port — the style classes a widget carries
// BESIDE the one that says what it is.
//
// WHY THIS EXISTS RATHER THAN A PROPERTY PER LOOK. Adwaita's button variants and the flat
// header bar are not properties in GTK; they are STYLE CLASSES —
// `refs/libadwaita/src/stylesheet/widgets/_buttons.scss:220#suggested-action`,
// `refs/libadwaita/src/stylesheet/widgets/_buttons.scss:230#destructive-action` and
// `refs/libadwaita/src/stylesheet/widgets/_buttons.scss:323#pill` for the button looks,
// `refs/libadwaita/src/stylesheet/widgets/_deprecated.scss:456#headerbar.flat` for the
// header bar's, which `@extend`s
// `refs/libadwaita/src/stylesheet/widgets/_header-bar.scss:112#%headerbar-flat`.
//
// EVERY COORDINATE HERE CARRIES ITS ANCHOR, because a bare `:230` after a full path is a
// continuation `check-refs-citations` does not read, and the one line that WAS anchored
// pointed at `_header-bar.scss:89` — `.titlebar headerbar:not(.flat)`, a negation in the
// window-shadow block. The gate passed it: `flat` is a substring of `:not(.flat)`.
//
// The port had spelled them as an enum (`GtkButton.variant`) and a boolean
// (`AdwHeaderBar.flat`), which is one look each: `variant` could hold `pill` OR
// `suggested-action` and its own doc said so ("set the shape OR the accent intent"), where
// GTK holds a LIST and an application composes `.pill.suggested-action` freely. So the
// convergence is also the feature (ADR 0049).
//
// THE BASE CLASS IS NOT IN THE LIST, and that is GTK's rule rather than a convenience: a
// widget's CSS name (`button`, `headerbar`) is not a member of `css-classes`, and
// `gtk_widget_get_css_classes` never returns it. Here the base is `adw-button` /
// `adw-header-bar`, so `cssClasses` reads back exactly what the caller set, and the widget
// keeps the class that makes its own stylesheet apply.
//
// PASS-THROUGH, NOT VALIDATION. `gtk_widget_set_css_classes` takes any names; unknown ones
// simply match no rule. `@gjsify/adwaita-core`'s `ADW_BUTTON_STYLE_ALIASES` maps the WEB
// element's boolean ATTRIBUTE names (`suggested`) onto class names
// (`suggested-action`) — that is an attribute vocabulary, not this one, and resolving
// aliases here would make `cssClasses` mean something GTK does not.

/**
 * What a `cssClasses` write means here.
 *
 * THE DOOR TAKES A STRING AND THE READ-BACK IS A LIST, which is the DOM's own
 * `className`/`classList` split and not a compromise: the two places that WRITE this are a
 * NativeScript XML attribute and `View.className`, and both are strings, while
 * `GtkWidget:css-classes` holds a list and so does the getter. An array-taking door would
 * need a fourth attribute kind in `check-generated-website-data` — it has `number`,
 * `boolean` and `json`, and `json` there means "parses to a plain OBJECT", so not even
 * `'["pill"]'` reaches it — and inventing one to offer a second spelling of a door that
 * already works is the "second way to say what the table can already say" that gate's own
 * header refuses.
 *
 * NO ARRAY ARM. It had one, "because the widget's internals rebuild the list through it";
 * the internals are the two setters and both are typed `string | null | undefined`, so the
 * arm was unreachable and its `String(name)` coercion guarded nothing.
 */
export type AdwCssClassesInput = string | null | undefined;

/**
 * The class list a `cssClasses` write means: split on whitespace, trimmed, de-duplicated,
 * order preserved.
 *
 * A STRING IS THE XML DOOR. NativeScript's `setPropertyValue` ends in `instance[name] =
 * value`, so `<gtk:Button cssClasses="pill suggested-action">` hands the setter that whole
 * string — the same fact `xmlNumber`/`xmlBoolean` exist for, one type over.
 */
export function normalizeCssClasses(value: AdwCssClassesInput): string[] {
    if (value === null || value === undefined) return [];
    const seen = new Set<string>();
    for (const name of value.split(/\s+/)) {
        if (name) seen.add(name);
    }
    return [...seen];
}

/** `className` for a widget whose own class is `base` and which carries `classes`. */
export function classNameWith(base: string, classes: readonly string[]): string {
    return classes.length > 0 ? `${base} ${classes.join(' ')}` : base;
}
