# rn-design-system

An ordinary design-system layer — badge, button, card, chip, hairline rule, rail, screen
scaffold, section header, thumbnail, typography — written fresh under MIT against React
Native's vocabulary and rendered onto GTK4 by
[`@gjsify/react-native`](../../../packages/framework/react-native), with an in-process probe
that asserts the resulting widget tree.

This is [ADR 0032](../../../docs/adr/0032-react-native-on-the-gtk-host.md) § 11. The
application the layer was measured against is third-party and under a different licence, so
it cannot be the regression test; this showcase is the substitute, and it is what turns "a
React Native view layer can run on GTK" from a claim into a measurement.

```bash
gjsify run build:gjs && gjsify run start:gjs   # the window
gjsify run probe                               # the assertions, headless
gjsify run check                               # tsc over the JSX
```

## What it is made of

| file | holds |
|---|---|
| `src/tokens.ts` | the project's token scales — the half of ADR 0032 § 3 that is NOT gjsify's |
| `src/components.tsx` | the design system itself — every component, and no GTK anywhere |
| `src/screen.tsx` | one screen composed out of them, and all of the state |
| `src/app.tsx` | the window, and every assertion |

`src/components.tsx` contains no `gi://` import, no GTK property name, no widget name and no
`<gtk-*>` element. Every widget in the window is chosen by L2's descriptor table out of
`View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `Switch` and `ActivityIndicator` —
which is the claim, and the reason that file is worth reading before the probe.

Token and route names are deliberately generic (`surface`, `sunken`, `ink`, `accent`,
`caption`/`body`/`title`/`display`). Nothing here is shaped like a particular product.

## The class vocabulary it exercises

Colour and background (`bg-*`, `text-<colour>`), radius (`rounded-md`, `rounded-lg`,
`rounded-pill`), border (`border`, `border-t`, `border-r`, `border-<colour>`), opacity
(`opacity-60/80`), the `active:` variant (`active:opacity-70/80`, `active:bg-sunken`), flex
direction (`flex-row`, `flex-col`), alignment (`items-center`, `items-start`, `items-end`),
justification (`justify-end`), gap (`gap-xs/s/m`), margins in BOTH channels (`mt-*`, `ms-*`
as widget properties, `mx-*` as CSS), padding (`p-*`, `px-*`, `py-*`), expansion (`flex-1`,
`w-full`, `h-full`), sizing (`w-thumb`, `h-hairline`), clipping (`overflow-hidden`), type
(`font-*`, `uppercase`, `tracking-wide`, `leading-snug`, `text-center`), and one absolutely
positioned child (`absolute top-2xs right-2xs`) over the `Gtk.Overlay` its parent became.

Class lists are built the way real call sites build them: an array with a conditional inside
it, which is how 24 of the measured application's `className=` sites are written.

## What the probe asserts, and why a launch could not

GTK's failure mode is **exit 0**. `box.orientation = 'vertical'` keeps HORIZONTAL with no
diagnostic; a CSS property GTK does not know is dropped by its parser in silence; a
mis-parented widget floods `Gtk-WARNING` and the process still succeeds; a throw inside a
GLib callback prints `JS ERROR` and lets `activate` return. `scripts/showcase-smoke.mjs`
launches the app and waits, so on its own it reports "it started".

`runHostProbeApp` from `@gjsify/gtk-host` owns the harness — the `GJSIFY_HOST_PROBE` gate,
the diagnostics collector, the `check()` recorder that verifies ITSELF, the
`PROBE: PASS|FAIL <json>` protocol, the `app.hold()` discipline, and the rule that the GUI
path runs the same assertions before presenting. What this showcase adds is five groups of
claim:

- **Which widgets resulted.** Positive (every primitive became the GType L2 says it does) and
  negative — `census.get('GtkOverlay') === 2` holds the overlay switch to the two tiles that
  actually carry an absolutely positioned child, and `GtkTextView` is asserted ABSENT because
  no `TextInput` asked for `multiline`. A window looks plausible when L2 chooses wrongly.
- **Which `css-classes` landed, and what they mean.** `css-classes` is a whole-list property,
  so writing the generated name would REPLACE what GTK put there — the probe asserts that
  `Gtk.Orientable`'s own `vertical`/`horizontal` and the table's `flat` survived the union,
  that no node carries more than one generated class, and that a node this layer styles not
  at all keeps `["vertical"]` and nothing else. Then it looks each class up **in the
  generated document** and asserts the declarations, because a class whose rule is missing is
  a style that silently does not apply. That is why the showcase hands the layer its own
  `StyleSheet` instead of letting `configureStyle` build a private one.
- **The property half.** Two thirds of the vocabulary becomes widget properties and is
  invisible in the CSS: orientation, `valign` inherited by every child of a row, `hexpand`
  from `flex-1`, the box's own `halign` from `justify-end`, `spacing` from `gap-m`, size
  requests, `overflow`, `lines`+`ellipsize`+`wrap` from `numberOfLines`, `xalign`+`justify`
  from `text-center`, `sensitive` from `disabled`, `visible` from `animating` (both ways).
- **The return path, three ways.** A `clicked` reaching `onPress`, a `notify::active`
  reaching `onValueChange` **with the new value**, and a `notify::text` reaching
  `onChangeText` **exactly once** — the reason that route binds `notify::text` rather than
  `Gtk.Editable::changed`, which reports `["", "quarry"]` for one programmatic write because
  `gtk_editable_set_text` is a delete followed by an insert. Each event is emitted on GTK's
  side, never by calling the closure, which would prove only that the closure exists. Then
  the three kinds of update they cause, which no single one of them could distinguish: a
  **class swap** (two chips), a **keyed list** that shrinks while the surviving row stays the
  SAME widget, a **text sink** patch, and one **widget property** (`Gtk.Box:spacing` from
  `gap-s`). Both halves of the lane are asserted — the tree is unchanged the instant the
  signal returns, and patched once the main context runs — so a `render()` that had quietly
  become synchronous fails the first of them.
- **Zero GTK diagnostics**, counted by the harness AFTER `teardown` — which is exactly where
  a mis-parented tree reports itself, at finalize, at exit 0.

Every group was A/B'd rather than assumed. Measured on this showcase, each of these turns the
probe red on its own: dropping `absolute` from the flag (L1 refuses it by name), widening it
to `inset-0` (three placement assertions), `justify-end` → `justify-center` (one), a `Chip`
that ignores `selected` (two class assertions), and a `pump` whose budget is 0 (nine).

## What it deliberately does not do

- **It does not test the four APIs.** `Linking`, `Platform`, `Share` and `useColorScheme` are
  supported and are not a view layer; `useColorScheme` in particular would make the asserted
  tree depend on the desktop's colour scheme.
- **It does not draw an image.** `Image` is tier P2 and unbuilt, so `Thumbnail` is a tinted
  tile with initials in it. A design system's thumbnail is normally a picture.
- **It asserts no accessible names.** Every `accessibility*` prop is refused: GTK carries
  accessibility through `Gtk.Accessible.update_property()`, an imperative call rather than a
  property, so there is nothing for a data-driven layer to set. The rail's short labels are
  exactly the case that needs one.
- **It does not lay out a long list.** Four rows in a `ScrollView`; `FlatList` over
  `Gtk.ListView` is tier P2, and virtualisation is the thing GTK does better than the web.
- **It never sets a style with `StyleSheet.create`.** That export is tier P1 and unbuilt, so
  the one authoring route exercised here is `className`. `style={{…}}` objects go through the
  same partition by design (ADR 0032 § 4) and are covered by L1's own specs.

## One measurement in the result line

`ruleHeightPx: { filled: 1, border: 0 }`.

`HairlineRule` draws a rule as a filled one-pixel box (`h-hairline bg-line`) and `BorderRule`
draws the same rule as a border (`border-t border-line`). L1 routes the second faithfully —
the generated class carries `border-top-width: 1px` and `border-color`, and the probe asserts
it — and GTK draws nothing, because `border-style` has no utility in this vocabulary and
GTK's initial value is `none`, which zeroes the width. Measured on GTK 4.22.4:
`border-width: 4px` alone leaves a box's minimum size unchanged (9×18 px), and adding
`border-style: solid` grows it to 17×26.

Reported rather than asserted on purpose: a passing check that says "the border draws nothing"
would go red the day the gap is closed, and pinning a defect is not the same as recording it.

## What this showcase found on its first run

`Gtk.Widget:css-classes` is a `GStrv`, and `widget.set_property('css-classes', ['x'])` throws
`Could not guess unspecified GValue type` on gjs 1.88.1 / GTK 4.22.4 — while the JS accessor,
`set_css_classes()` and CONSTRUCTION all accept the same array. The host wrote every property
through `set_property`, so the first commit worked (it goes through construction) and every
later one that rewrote a class list raised inside `commitUpdate`, where React caught it as
"an error no boundary caught" and unmounted the tree at exit 0 with the diagnostics gate
still reading zero.

It is not limited to a class that changed: L2 builds a fresh `css-classes` array per render
and the React adapter's `diffProps` compares by reference, so an unchanged class list is
still reported as a change. **No styled node could re-render at all** — which is why a
design system, rather than a counter, is what found it. The fix is `writeProperty` in
`@gjsify/gtk-host`'s `host.ts`, with vectors in `host.spec.ts`.

## Build recipe, and it is not optional

```
--define 'process.env.NODE_ENV="production"'   --exclude-globals navigator
```

`react-reconciler/index.js` picks its bundle from `process.env.NODE_ENV`, and the development
one reaches for `document`, `HTMLCanvasElement` and `Path2D` — which makes `--globals auto`
inject the GTK-backed DOM registers and pull `gi://Gdk`, `GdkPixbuf`, `Pango` and
`PangoCairo` into a bundle that needs none of them. Even the production `scheduler` carries
`typeof navigator !== 'undefined' && navigator.scheduling`, dead code under GJS but still a
free identifier the detector answers with the same register. Two probe assertions hold the
recipe: no `document` and no `navigator` exist at runtime.

## The window is the application's, the content is React's

`createRoot(container)` renders INTO a widget and a toplevel window is not a child of
anything, so the application owns the `Adw.ApplicationWindow`, its `Adw.ToolbarView` and its
header bar — the same split `@gjsify/react-native`'s own `AppRegistry` makes. Those three are
the only GTK objects this showcase constructs by hand.

`import { View } from '@gjsify/react-native'` rather than from `'react-native'`: the bundler
alias ADR 0032 § 2 describes (`'react-native'` → `'@gjsify/react-native'`) is what makes an
unmodified application build, and it is not wired up yet. The import surface is identical
either way.

## License

MIT
