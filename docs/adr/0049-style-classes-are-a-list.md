# 49. A look is a style class, and a widget carries a LIST of them

- Status: **Proposed**
- Date: 2026-09-05
- Deciders: Pascal Garber
- Related: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md), [ADR 0042 (portable menu model)](0042-portable-menu-model.md), [ADR 0046 (portable list model)](0046-portable-list-model.md), [ADR 0047 (portable adjustment)](0047-portable-adjustment.md), [ADR 0048 (page selection by identity)](0048-page-selection-by-identity.md)

## Context

Adwaita's button looks and the flat header bar are **not properties in GTK**. They are style
classes, and the stylesheet is where they live:

| the look | where it is defined |
|---|---|
| `.suggested-action` | `refs/libadwaita/src/stylesheet/widgets/_buttons.scss:220` |
| `.destructive-action` | `:230` |
| `.pill` | `:323` |
| `.flat` on a header bar | `refs/libadwaita/src/stylesheet/widgets/_header-bar.scss:89` |

A GTK widget carries them in one property, `GtkWidget:css-classes`, which is a **list**.

`@gjsify/adwaita-nativescript` had spelled them as two different kinds of thing, and the
property ledger counted both:

| the port's spelling | what it could express |
|---|---|
| `GtkButton.variant` — an enum, one member | ONE look |
| `AdwHeaderBar.flat` — a boolean | one look, on one widget, with a property of its own |

**The enum's own documentation records the cost**: *"`pill` is the rounded SHAPE and
combines with no other variant here (set the shape OR the accent intent)"*. On GTK
`.pill.suggested-action` is an ordinary button; through the enum it was unreachable. So this
convergence is also a feature, which is the opposite of the usual trade in this series.

## Decision

### 1. `cssClasses` on both widgets, and the base class is not in it

`GtkButton.variant` and `AdwHeaderBar.flat` become `cssClasses`, the counterpart's own
property name.

The list excludes the class that says what the widget IS — `adw-button`, `adw-header-bar` —
because that is GTK's rule and not a convenience: a widget's CSS name is not a member of
`css-classes`, and `gtk_widget_get_css_classes` never returns it. The widget keeps that
class on its `className` so its own stylesheet still applies; `cssClasses` reads back
exactly what the caller wrote.

### 2. The names are CLASS names, and nothing is resolved

`suggested-action`, not `suggested`. `gtk_widget_set_css_classes` takes any names and
unknown ones simply match no rule, so the port neither validates nor rewrites.

`@gjsify/adwaita-core`'s `ADW_BUTTON_STYLE_ALIASES` — which maps `suggested` →
`suggested-action` — stays exactly where it was: it is the **web element's attribute**
vocabulary (`<gtk-button suggested>`), and an attribute name is not a class name. Resolving
aliases inside `cssClasses` would make the property mean something GTK's does not.

### 3. The door takes a string; the read-back is a list

```ts
get cssClasses(): string[]
set cssClasses(value: string | null | undefined)   // space-separated, as in XML
```

This is the DOM's own `className` / `classList` split rather than a compromise. The two
places that WRITE this are a NativeScript XML attribute and `View.className`, and both are
strings; `GtkWidget:css-classes` holds a list, and so does the getter.

An array-taking door would need a **fourth attribute kind** in
`check-generated-website-data`: it knows `number`, `boolean` and `json` (the last added by
[ADR 0047](0047-portable-adjustment.md)'s change for `adjustment`), and a space-separated
list is none of them. Measured while writing this — annotating the setter
`string | readonly string[]` files it as `json` and the gate then demands the gallery block
write `cssClasses='["pill"]'`. Inventing a kind to offer a second spelling of a door that
already works is the *"second way to say what the table can already say"* that gate's own
header refuses.

`normalizeCssClasses` still accepts an array at runtime, because the widget's internals
rebuild the list through it.

## Consequences

- **Breaking**, on one published package:
  `button.variant = 'suggested'` → `button.cssClasses = 'suggested-action'`;
  `header.flat = true` → `header.cssClasses = 'flat'`;
  `<gtk:Button variant="pill">` → `cssClasses="pill"`;
  `AdwButtonVariant` is gone as an exported type.
- **A composed look is expressible for the first time**: `cssClasses = 'pill suggested-action'`.
- The vocabulary ledger loses its last two `should converge` property entries that are a
  SPELLING rather than a structure.
- No `@gjsify/adwaita-core` change. The class table and the alias map were already shared,
  and this ADR moves nothing into or out of them.

## What this does not decide

- **`@gjsify/adwaita-web` keeps its boolean attributes** (`<gtk-button flat suggested>`) on
  six elements. The property half of ADR 0034's rule is scoped to the NativeScript surface
  by construction — `check-vocabulary-alignment.mjs` says so in the line it prints — and
  the web's attribute vocabulary is a second corpus that has never been read. Converging it
  is its own change with its own migration, and this ADR does not pre-empt the answer.
- **`AdwHeaderBar.title` / `.subtitle` stay.** They are the remaining ledger entries on this
  widget and they are structural, not spelling: `Adw.HeaderBar` has no `title` property at
  all (measured — `titleWidget` is the only title-shaped key in `AdwHeaderBarProps`), all
  three renderers carry the same derived-title divergence, and `@gjsify/adwaita-core` models
  it as `HeaderBarRenderState.derivedSubtitle`. Two strings collapsing into one widget-typed
  key is the case ADR 0034 § *What the remainder is* already describes.
- **Nothing about `AdwImageButton`**, the last widget-name entry, whose convergent name is
  taken by the plain button.
