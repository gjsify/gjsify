// `GtkWidget:css-classes` for the NativeScript port, spelled `styleClasses` — the style classes a widget carries
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
// `gtk_widget_get_css_classes` never returns it (measured under gjs 1.88.1: a fresh
// `Gtk.Button` answers `[]`). Here the base is `adw-button` / `adw-header-bar`, so
// `styleClasses` reads back exactly what the caller set, and the widget keeps the class
// that makes its own stylesheet apply.
//
// SPELLED `styleClasses`, NOT `cssClasses`, AND THAT IS NOT A PREFERENCE. `cssClasses` is
// TAKEN on this platform: `ViewBase` declares `readonly cssClasses: Set<string>` and its
// constructor assigns it, and `classNameProperty.valueChanged` clears and repopulates that
// very Set on every `className` write. A subclass accessor SHADOWS the constructor's
// assignment, so the Set never exists and the first `className` write — the one in
// `GtkButton`'s own constructor — dies on `cssClasses.has is not a function`. Measured
// against @nativescript/core 9.1.0-alpha.11 with the two bodies run verbatim; the port's
// own `ns-core.d.ts` now declares the member, so the compiler says it too (TS2611).
// libadwaita's own documentation calls these STYLE CLASSES, so the name is a true one and
// the ledger carries `cssClasses` as the convergence target it cannot reach.
//
// GTK'S OWN READ-BACK ORDER IS NOT THE CALLER'S — measured: `set_css_classes(['pill',
// 'suggested-action'])` answers `["suggested-action","pill"]`, and both orders of
// `['zzz-one','aaa-two']` answer `["zzz-one","aaa-two"]`, because the list is held in
// GQuark order. That is an interning artifact, not a contract, so this port keeps the
// order written. It de-duplicates as GTK does; it also TRIMS, where GTK does not
// (`set_css_classes(['  x  '])` answers `["  x  "]`), because splitting a string is what
// makes a name here.
//
// PASS-THROUGH, NOT VALIDATION. `gtk_widget_set_css_classes` takes any names; unknown ones
// simply match no rule. `@gjsify/adwaita-core`'s `ADW_BUTTON_STYLE_ALIASES` maps the WEB
// element's boolean ATTRIBUTE names (`suggested`) onto class names
// (`suggested-action`) — that is an attribute vocabulary, not this one, and resolving
// aliases here would make `styleClasses` mean something GTK does not.

/**
 * What a `styleClasses` write means here.
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
export type AdwStyleClassesInput = string | null | undefined;

/**
 * The class list a `styleClasses` write means: split on whitespace, trimmed,
 * de-duplicated, order preserved.
 *
 * A STRING IS THE XML DOOR. NativeScript's `setPropertyValue` ends in `instance[name] =
 * value`, so `<gtk:Button styleClasses="pill suggested-action">` hands the setter that
 * whole string — the same fact `xmlNumber`/`xmlBoolean` exist for, one type over.
 */
export function normalizeStyleClasses(value: AdwStyleClassesInput): string[] {
    if (value === null || value === undefined) return [];
    const seen = new Set<string>();
    for (const name of value.split(/\s+/)) {
        if (name) seen.add(name);
    }
    return [...seen];
}

/**
 * `className` for a widget whose own class is `base` and which carries `classes`.
 *
 * AN EMPTY `base` IS A WIDGET WITH NO CLASS OF ITS OWN, and two of them ship: `Gtk.Box`
 * and `Gtk.Label` are transparent — there is no Adwaita fill, radius or typography to give
 * a box or a bare label, so they carry only what a caller puts on them. The empties are
 * filtered rather than joined, because `` `${''} ${'title-1'}` `` is a leading space and
 * NativeScript's `className` splitter turns that into an empty class name.
 */
export function classNameWith(base: string, classes: readonly string[]): string {
    return [base, ...classes].filter((name) => name !== '').join(' ');
}

/**
 * The list after `gtk_widget_add_css_class(name)` — GTK's own method, and the door a GJS
 * snippet reaches for.
 *
 * WHY THE METHODS EXIST BESIDE THE `styleClasses` PROPERTY. A NativeScript XML attribute
 * can only carry a string, which is what `styleClasses` is for; a TypeScript caller ported
 * off GJS writes `button.add_css_class('pill')`, and that line is in every Adwaita snippet
 * that gives a button a look. The two doors hold the SAME list, so a widget that offers
 * both cannot have them disagree — which is why the mutation is a pure function over the
 * list rather than a second `className` rewrite per method.
 *
 * ADDS AT THE END, AND ONLY IF ABSENT. `gtk_widget_add_css_class` is a no-op for a class
 * the widget already has (the quark is already in the list), so a second add does not move
 * it — measured under gjs 1.88.1: `add_css_class('a'); add_css_class('b');
 * add_css_class('a')` reads back two classes.
 *
 * ONE NAME, TRIMMED. GTK takes a single class name and would happily intern `'a b'` as one
 * unmatchable class; here the string door already means "a whitespace-separated list", so a
 * name with whitespace in it is the caller confusing the two doors. It is trimmed, and an
 * empty name is dropped rather than added as a class nothing can be.
 */
export function withCssClass(classes: readonly string[], name: string): string[] {
    const wanted = (name ?? '').trim();
    if (wanted === '' || classes.includes(wanted)) return [...classes];
    return [...classes, wanted];
}

/** The list after `gtk_widget_remove_css_class(name)`. Absent is a no-op, as in C. */
export function withoutCssClass(classes: readonly string[], name: string): string[] {
    const wanted = (name ?? '').trim();
    return classes.filter((held) => held !== wanted);
}
