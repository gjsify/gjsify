# 119. GTK CSS loaded through `Gtk.CssProvider` applies on the web, translated through one node table per widget

- Status: **Accepted** (2026-10-19)
- Date: 2026-10-19
- Deciders: Pascal Garber
- Depends on: [ADR 0004 (headless Adwaita core)](0004-headless-adwaita-core.md), the platform
  slice in `adwaita-core/src/gtk-platform.ts` that carries `Gtk.CssProvider`
- Amends: [ADR 0010 (adwaita-web style isolation)](0010-adwaita-web-style-isolation.md) § 1 (the
  skin moves into a cascade layer, § 4 below)
- Related: [ADR 0090](0090-platform-design-languages-on-top-of-adwaita.md) (layer-1 design tokens
  are an app-level `CssProvider`), [ADR 0009](0009-native-adwaita-app-shell.md) (the GTK shell's
  `css` option), [ADR 0027](0027-gtk-host-layer.md) and
  [ADR 0029](0029-girs-widget-vocabulary.md) (GTK's names are the vocabulary),
  [ADR 0116](0116-app-gresources-are-embedded-at-build-time-for-web-and-nativescript.md)
  (CSS from a resource stays refused there), [ADR 0030](0030-one-corpus-gjs-as-oracle.md) (GJS is
  the oracle); `packages/web/adwaita-core/src/gtk-platform.ts`,
  `packages/framework/gtk-host/src/style/gtk-css.ts`

## Rule for every stage

The API is GTK's. A stage may implement a strict SUBSET: the same names with GTK's semantics, and
what is not implemented is refused, naming it. For CSS a refusal is what GTK's own parser does with
an error: the rule or declaration is skipped and a warning names the construct. Later stages only
add; a stylesheet written against an earlier stage is never rewritten. A claim needs a conformance
vector against real GTK.

## Context

The web and NativeScript ports carry `Gtk.CssProvider.load_from_string` and
`Gtk.StyleContext.add_provider_for_display` (`adwaita-core/src/gtk-platform.ts`). The bookkeeping is shared and correct (priority order,
stable at equal priority). The STRING is not translated: on the web, `webPlatformHost.setStyles`
writes it into a `<style>` element verbatim; on NativeScript, `Application.addCss` receives it
verbatim.

GTK CSS selects CSS NODES, not DOM elements. A grouped `Gtk.CheckButton` is the node tree
`checkbutton > radio, label` (measured on GTK 4.22.5: `get_css_name()` is `checkbutton`, its
children are `radio` and `label`). adwaita-web renders the same widget as
`<gtk-check-button checked>` with `span.adw-check-indicator` and `span.adw-check-label` inside it.
So `checkbutton.primary radio` and `checkbutton.primary:checked` match nothing in the browser.

The consumer that shows it is Learn6502's preferences dialog. Its three colour selectors
(`packages/ui/src/preferences/*-selector.css`) turn each `CheckButton` into a filled round swatch
with a ring when checked, and hide the `radio` glyph. On GNOME that works. On the web every swatch
renders as a plain grey radio circle (screenshots in Chromium and Firefox, taken 2026-10-19). The
app's web entry today injects these files through its own `<style>` element (`app-web/src/app/
styles.ts`) instead of the `CssProvider` its GNOME entry uses. Rewriting them as web CSS in the app
would be an app-side workaround for a core gap, which the true-subset rule forbids.

What GTK's parser accepts is measured, not assumed (GTK 4.22.5, under `headless-run`):

| input | GTK |
|---|---|
| CSS nesting (`.a { b { … } &:checked { … } }`) | refused: "No property named "b"" |
| `:root { --x: 3px }`, `var(--x)`, `color-mix(in oklab, …)`, `alpha(@window_bg_color, 0.5)` | accepted |
| `@define-color foo #fff; .a { color: @foo }`, `#name`, `*`, `>`, `~`, `+` | accepted |
| `:backdrop`, `:not(.b)`, `:focus-visible`, `:hover`, `:active` | accepted |
| `:has(b)` | refused: "Unknown pseudoclass" |
| `display: flex` | refused: "No property named "display"" |
| `padding: 12` (no unit) | refused: "Unit is missing." |

Learn6502's GNOME build flattens nesting with lightningcss before GTK sees the string
(`css-as-string`, `targets: { firefox: 60 << 16 }` on `--app gjs`). The last row matters for the
inventory below: `ui/src/main-button.css` writes `padding: 12` and `padding-bottom: 16`, so GTK
drops both declarations on GNOME today.

### The inventory that bounds the subset

Every selector the real consumers hand to a `CssProvider`, after nesting is lowered:

- **Learn6502** (`ui/src/**/*.css`, `app-gnome/src/utils.css`, `variables.css`, the files
  `app-gnome/src/main.css` imports): 59 selectors in 11 files, plus the runtime string
  `theme.service.ts` builds (`:root { --learn-…: var(--accent-…) }`).
- **gjsify's storybook** (`packages/framework/storybook/src/styles.ts`): 16 selectors, plus two
  runtime strings in `appearance.ts` (`:root { --accent-bg-color: … }`, and `checkbutton { … }`
  on a per-widget provider).

75 selectors and three run-time strings in total. What they use:

| construct | uses |
|---|---|
| style classes, compound (`checkbutton.primary.primary-blue`) | almost all |
| node names | `checkbutton`, `radio`, `button`, `revealer`, `label`/`link`, `box`, GtkSourceView's `text`, `gutter`, `current-line` |
| widget names (`#name`) | `#gamepad`, `#buttonCenter`, `#main-button` |
| pseudo-classes | `:checked`, `:disabled`, `:not(.class)` |
| combinators | descendant, `>` (`.storybook-controls > .sidebar > *`, `.story-range-row > box`) |
| `:root` with custom properties, `var()` | Learn6502 `variables.css`, `theme.service.ts`, storybook appearance |
| named colours | `@window_bg_color`, `@accent_color`, `alpha(…)` |
| properties | `background-color`, `background`, `background-image`, `background-clip`, `padding*`, `box-shadow`, `min-width`, `min-height`, `border`, `border-*-radius`, `border-bottom`, `opacity`, `filter`, `transform`, `font-family`, `font-weight`, `font-variant-numeric`, `color`, `-gtk-icon-source` |

No consumer uses `:backdrop`, `:hover`, `:active`, `:focus*`, `:selected`, `~`, `+`, `@media`,
`@import` at run time, `shade()`, `mix()`, `lighter()`, `darker()` or a GTK animation.

## Decision

### 1. Where it lives

The translation lives once in `@gjsify/adwaita-core`, as `gtk-css/`: a parser for the GTK CSS
subset, the node tables (§ 3), and a translator that turns the parsed sheet into selectors over a
port's DOM. It reaches no DOM itself. `CssProvider.load_from_string` keeps the source text
(`to_string()` returns it unchanged, as GTK does) and hands the translated sheet to the host.

`gtk-host/src/style/gtk-css.ts` holds the measured table of the properties GTK accepts. It moves to
`adwaita-core` so the GTK side and the translator read one table; its spec keeps running against a
real `Gtk.CssProvider`.

Translation runs when the string is loaded, not at build time. Providers receive strings built at
run time (`theme.service.ts`, the storybook accent, devtools' `swapCss`).

### 2. The input is what GTK's parser receives

The translator accepts exactly the grammar GTK's parser accepts, and refuses the rest the way GTK
does. Nesting is refused, as in the table above. A source file reaches the provider flattened
because the BUILD lowers it: `css-as-string` passes the same lowering targets on `--app browser`
and the NativeScript build as on `--app gjs`, so every target hands its provider the same text.

### 3. One node table per widget

Every widget that adwaita-web renders declares its GTK CSS node tree in a table, read from GTK's
documented "CSS nodes" section and checked against `get_css_name()` and the children GJS reports.
One row per node:

```ts
GtkCheckButton: {
    node: 'checkbutton',
    element: 'gtk-check-button',
    states: { checked: '[checked]', indeterminate: '[indeterminate]', disabled: '[disabled]' },
    children: [
        { node: 'check', part: 'span.adw-check-indicator', when: ':not([radio])' },
        { node: 'radio', part: 'span.adw-check-indicator', when: '[radio]' },
        { node: 'label', part: 'span.adw-check-label' },
    ],
    gtkProperties: { '-gtk-icon-source': { node: 'check|radio', pseudo: '::after' } },
},
```

- A node name maps to every element and part that carries it: `button` becomes
  `:is(gtk-button, gtk-toggle-button, …)`, derived from the tables as an inverse index, never typed
  by hand.
- A `state` maps a GTK pseudo-class that is widget state (`:checked`, `:indeterminate`,
  `:disabled`) to the attribute the element publishes. `:hover`, `:active`, `:focus`,
  `:focus-visible` and `:focus-within` map to the browser's own pseudo-classes, which mean the same.
- A style class stays a class: `add_css_class` already writes `classList` (`gobject-elements.ts`).
- A widget name (`#name`) becomes `[gtk-name="name"]`, the attribute the element publishes for
  `Gtk.Widget:name`. Publishing it is part of the implementation, since adwaita-web does not
  publish the name today.
- `gtkProperties` maps a GTK-only property to the part that draws it. `-gtk-icon-source: none` on
  `radio` hides the glyph the skin draws in `::after`. A GTK-only property without a row is refused.

The emitted selector keeps GTK's specificity: a node compiles to `<element>:where(<rest>)`, so a
type node stays one type selector and a state stays one attribute selector. Rules of one provider
then order among themselves as they do in GTK.

The tables are written per widget as consumers reach them. Learn6502's inventory owes rows for
`GtkCheckButton`, `GtkButton` (and the elements whose node is `button`), `GtkRevealer`, `GtkLabel`
with its `link` node, `GtkBox`, and `GtkSourceView`'s `text`, `gutter` and `current-line`. A
widget without a table is refused by node name.

### 4. Priority wins over specificity, through cascade layers

In GTK a provider of higher priority wins whatever the specificity. Measured on GTK 4.22.5:
`checkbutton { color: red }` at priority 800 beats `box checkbutton.primary { color: blue }` at
600. Specificity decides only inside one provider. The web
host keeps that order with CSS cascade layers:

- Each priority is a layer named after it (`gtk-p0001`, `gtk-p0200`, … `gtk-p0800`). The host
  writes one `@layer` order statement first and rewrites it when a new priority appears.
- adwaita-web's skin is the theme. It moves into `gtk-p0200`
  (`STYLE_PROVIDER_PRIORITY_THEME`), where libadwaita's stylesheet sits on GNOME.
- A design-language token sheet (ADR 0090 layer 1) is an app-level provider and lands in its
  priority's layer like any other.
- Page CSS that is not loaded through a provider stays unlayered and outranks every layer. Learn6502's
  `html, body` sheet and its `learn-tutorial` content stylesheet are page CSS, not GTK CSS, and
  stay that way.

This amends ADR 0010 § 1. Declared values still beat inheritance, so a host page's inherited
typography still stops at each widget. A host rule that targets the elements directly (`* {
box-sizing: content-box }`, a bare `button { }`) now outranks the layered reset. ADR 0010 already
names hostile third-party embedding as the trigger for Shadow DOM, and that stays the answer.

### 5. Named colours and colour functions

- `@define-color name value;` becomes a custom property `--gtk-color-name` on `:root` inside the
  provider's layer, and `@name` reads it.
- `@name` for a libadwaita colour (`@window_bg_color`, `@accent_color`, …) reads the skin's token
  (`var(--window-bg-color)`), the same alias libadwaita defines.
- `alpha(c, a)` becomes `color-mix(in srgb, c calc(a * 100%), transparent)`.
- `shade()`, `mix()`, `lighter()` and `darker()` have no consumer and are refused by name.
- `var()`, `color-mix()` and custom properties pass through.

### 6. Properties

A declaration passes when GTK accepts the property (the moved table, § 1) and the value parses as
GTK parses it. A declaration GTK drops is dropped on the web too, with GTK's message: Learn6502's
`padding: 12` must not apply on the web when it does not apply on GNOME. `min-width` and
`min-height` keep GTK's content-box meaning; whether the emitter sets `box-sizing` on the matched
element or folds padding and border in is decided by the vectors (§ 9).

### 7. What is refused, and how

Two kinds of refusal, both on `console.warn` in GTK's format
(`Theme parser error: <data>:<line>:<col>: <message>`), each once per provider and load:

1. **GTK refuses it.** The message is GTK's own, word for word (vectors check it). The rule or
   declaration is skipped at the granularity GTK skips it: a selector error drops the rule, a
   property error drops the declaration.
2. **GTK accepts it, the subset does not carry it.** The message names the construct and this ADR:
   `":backdrop" is not carried on the web (ADR 0119)`. The rule is skipped.

Refused in this stage, until a consumer needs them: `:backdrop` (the browser's window focus is not
GTK's), `:selected`, `:dir()`, `:drop()`, the structural pseudo-classes (`:first-child` and kin),
`~` and `+` between nodes whose DOM order differs from the node order, `@media` (a browser media
query reads the OS, not `Adw.StyleManager`), `@import`, `@keyframes` and GTK transitions, `shade()`,
`mix()`, `lighter()`, `darker()`, and every widget without a node table. `parsing-error` as a
signal on `CssProvider` stays absent until the subset carries signals on it.

A provider added to one widget (`get_style_context().add_provider`, deprecated since GTK 4.10, used
by the storybook's appearance dialog) is refused by name. The storybook runs it on GNOME only.

### 8. NativeScript

NativeScript gets the same parser and the same node tables, with one more column per row: the
class names the NativeScript widget publishes (`.adw-check-button`, `.adw-check-indicator.radio`,
the `checked` class for `:checked`). Its emitter is a second stage, deferred for two measured
reasons:

- `Application.addCss` is append-only (`platform-host.ts`, `widgets/adw-accent.ts`), so a provider
  that is removed or reloaded cannot take its rules back. Priority order needs replaceable sheets,
  or a host that re-emits the full ordered set.
- The port's `adwaita.css` states that NativeScript does not resolve `var()`. Most of the inventory
  reads custom properties, so that claim has to be measured on the current NativeScript before the
  emitter is designed.

Until the second stage lands, the NativeScript host warns once per provider that GTK CSS is not
translated there, instead of appending text that cannot match.

### 9. Conformance

`GTK_CSS_VECTORS` in `adwaita-core/conformance`, written before the translator. A vector is a
stylesheet, a widget tree built from GTK names, a state change, and the values to read:

- **The oracle** is GTK under `gjs`, run with `scripts/headless-run -- gjs …`, never on the
  desktop. GTK exposes no computed style, so the vector reads what GTK does expose:
  `Gtk.Widget.get_color()` for `color`, `measure()` for minimum sizes and padding, and the pixels
  of a `Gtk.WidgetPaintable` rendered to a texture for paint properties (`background-color`,
  `box-shadow`, `opacity`, `filter`). The `parsing-error` messages are recorded too.
- **The web side** builds the same tree in Chromium and Firefox and reads `getComputedStyle`, the
  element's box, and pixels at the same points.
- Every selector of the inventory is a vector row. The first rows are Learn6502's three colour
  selectors, unchecked, checked and disabled.

## Consequences

- Learn6502's web entry loads its GTK stylesheets through `Gtk.CssProvider`, as `app-gnome` does,
  and `styles.ts` keeps only page CSS. The preferences swatches render as on GNOME.
- An app sees on the web what GTK would do with its CSS, including what GTK drops. A declaration
  that only ever worked in the browser stops working there.
- adwaita-web's skin moves into a cascade layer. Host-page rules that target widget elements
  directly now outrank the skin's reset (§ 4).
- Each widget that gains a node table becomes stylable by GTK node name. Widgets without one refuse
  their node name, and the gap report lists it.
- The node tables are a second statement of GTK's node trees beside GTK's own. The vectors keep
  them honest against a GTK upgrade, the same standing cost ADR 0090 accepts for libadwaita's
  node names.

## Alternatives rejected

- **App-side web CSS.** Forbidden by the true-subset rule: every app would restate GTK's node
  trees for one target.
- **Rename the DOM to GTK's node names** (`<checkbutton>`, `<radio>`). The custom-element tags are
  a published surface (ADR 0010, ADR 0034), and one GTK node name maps to several widgets.
- **Translate at build time.** Provider strings are built at run time, and a build step would see
  only the files.
- **Order by specificity padding instead of layers** (adding id-level weight per priority). It
  keeps ADR 0010's reset unlayered, but puts fake ids into every emitted selector and fails once a
  provider uses more `#name` selectors than the padding. Layers are the CSS mechanism for exactly
  this order.
- **Translate the whole GTK CSS grammar now.** Most of it has no consumer, and every construct
  needs its own oracle rows.

## What this does not decide

- CSS from a resource (`load_from_resource`, `load_from_path`, `load_from_file`): ADR 0116 § 6
  keeps it refused.
- The NativeScript emitter (§ 8, second stage).
- The `parsing-error` signal and per-widget providers.
- Design-language token sheets themselves (ADR 0090).

## Resolved at acceptance

- **ADR 0010's reset (§ 4).** Accepted as stated: direct host rules outrank the layered reset, and
  Shadow DOM stays ADR 0010's answer for hostile hosts.
- **`padding: 12` in Learn6502's `main-button.css`.** Fixed to `12px` in Learn6502; this ADR only
  makes the web agree with GNOME.
- **The widget-name attribute** (§ 3): adwaita-web publishes `Gtk.Widget:name` as the `gtk-name`
  attribute, and `#name` compiles to `[gtk-name="name"]`. Not `id`, which the DOM requires to be
  unique while GTK widget names may repeat; not `name`, which form elements already own.

## Implementation

Not in this PR. Tracked in `status/open-todos/adwaita-core.md`. One PR per step:

1. `GTK_CSS_VECTORS` against GJS under `headless-run`: the inventory's rows, the measured parser
   errors, and Learn6502's colour selectors.
2. `adwaita-core/src/gtk-css/`: the parser, the moved property table, the `GtkCheckButton` table,
   and the web emitter; `CssProvider` hands translated sheets to the host.
3. The web host: cascade layers per priority, the skin in `gtk-p0200`, the ADR 0010 amendment
   recorded there.
4. `css-as-string` lowers nesting for `--app browser` and the NativeScript build.
5. Node tables for the rest of Learn6502's inventory (`button`, `revealer`, `label`/`link`, `box`,
   GtkSourceView's nodes) and the widget-name attribute.
6. NativeScript, second stage (§ 8), after `var()` is measured there.

First consumer: Learn6502's preferences dialog, whose `styles.ts` then switches to
`Gtk.CssProvider` in its own repository once a release carries steps 1–4.
