# @gjsify/adwaita-react-native

Adwaita widgets with **one API surface and two implementations**: the real `Adw.*`
widget on GTK4, React Native primitives on a phone.

```tsx
import { AdwClamp } from '@gjsify/adwaita-react-native';

<AdwClamp maximumSize={400}>{content}</AdwClamp>;
```

On GTK that is `Adw.Clamp` through [`@gjsify/gtk-host`](../gtk-host). On Android and
iOS it is a `View` whose width and offset come from
[`@gjsify/adwaita-core`](../../web/adwaita-core)'s port of
`adw_clamp_layout_allocate` — libadwaita's own easing curve, not a `maxWidth`
approximation.

## What this is, honestly

**A walking skeleton, not yet a widget set.** The table below is the whole of it. Every
row carries the whole vertical — both platform halves, the resolution mechanism, the
`exports` entry, a gate, and a suite on each side that reads the REAL tree — and the
widgets that are not in it are repetition against a boundary that has been measured.

**The promise is the Adwaita design language on React Native, not "your app runs".**
Unlike [`@gjsify/react-native`](../react-native) — the opposite direction, which was
measured against a real production Expo application — this package has no third-party
codebase behind it. What it has is a shared arithmetic core and two renderers held to
the same numbers.

## Install

Not on npm yet: this is a new name, and the first publish plus its Trusted Publisher
bootstrap is a maintainer action deliberately not attempted from CI or a feature branch
([the procedure](../../../docs/publishing.md)). Until then it is consumable from a
workspace checkout.

```sh
npm install @gjsify/adwaita-react-native
```

`react` (>= 19.2) is a peer dependency. `react-native` (>= 0.87) is an **optional** peer:
a GTK-only consumer does not need it installed.

## Widgets

| widget | props | notes |
|---|---|---|
| `AdwBin` | `children` | One child, no layout of its own |
| `AdwClamp` | `children`, `maximumSize` (600), `tighteningThreshold` (400) | Constrain a child's width and centre it, on libadwaita's easing curve |
| `AdwHeaderBar` | `start`, `titleWidget`, `title`, `subtitle`, `end` | The three slots as PROPS, in draw order. No window controls: a phone has none |
| `AdwStatusPage` | `children`, `iconName`, `title`, `description` | A centred empty state. The icon draws on GTK only |
| `AdwToolbarView` | `children` (the content), `topBar`, `bottomBar`, `topBarStyle` (`flat`), `bottomBarStyle` (`flat`), `extendContentToTopEdge` (false), `extendContentToBottomEdge` (false) | Content framed by bars. The two styles reach the real widget on GTK and draw nothing on a phone |
| `AdwWindowTitle` | `title`, `subtitle` | Two labels; an EMPTY one takes no space, a blank one does |
| `AdwWrapBox` | `children` plus libadwaita's fourteen: `childSpacing`/`childSpacingUnit`, `lineSpacing`/`lineSpacingUnit`, `align`, `justify`, `justifyLastLine`, `lineHomogeneous`, `naturalLineLength`/`naturalLineLengthUnit`, `packDirection`, `wrapReverse`, `wrapPolicy`, `orientation` | Children flow onto new lines. The line DECISION is `@gjsify/adwaita-core`'s, the line BREAKING is Yoga's |

Props are libadwaita's own names, camelCased — `maximumSize` is `AdwClamp:maximum-size`,
not a React Native `maxWidth` — so the property you look up in libadwaita's documentation
is the property you write. Defaults are libadwaita's.

**A slot is a prop, never a `slot`-carrying child.** `AdwHeaderBar`'s three ends and
`AdwToolbarView`'s two bars are props because gtk-host routes a child by a `slot` prop on
the CHILD, and a prop of a React component is an arbitrary `ReactNode` with nothing to
write it on — `cloneElement` sets a prop on a COMPOSITE component, which forwards
nothing, so the slot would be silently dropped for exactly the children this package
ships. Each slot therefore gets one container widget on GTK, which is also what
libadwaita puts there itself.

**Neither half styles text.** Bold-and-dim is `@gjsify/adwaita-web`'s stylesheet and
`@gjsify/adwaita-nativescript`'s theme CSS; this package has no theme layer to read
`@gjsify/adwaita-core`'s tokens through, so what the React Native half carries is layout
and visibility. Inventing a styling seam is a decision this slice does not make.

## How the two halves are selected

Through the package's `exports` map and the `react-native` condition:

| condition | entry |
|---|---|
| `react-native` | `lib/esm/index.native.js` |
| `default` | `lib/esm/index.gtk.js` |
| `exports` ignored, `module` read | `lib/esm/index.js` — refuses, by name |

**A stock React Native 0.87 application needs no configuration.** `metro-config` enables
package exports and `@react-native/metro-config` supplies the `react-native` condition.

Two things follow that are easy to undo by accident, so both are held by
`scripts/check-adwaita-rn-platform-split.mjs` rather than by convention — its header
carries the resolver measurements behind them:

- **The condition ORDER is part of the map.** `exports` answers with the first match and
  `default` matches everything, so moving `default` ahead of `react-native` hands the GTK
  build to every phone.
- **Every barrel names its platform files literally.** Nothing relies on a resolver
  picking a `.native` sibling: that mechanism is real, and right for an *application*,
  but it does not carry a published library whose shipped imports carry a `.js` extension.

### Consuming it on GTK

Nothing to configure on the phone. On GTK, point JSX at the host that has a GTK element
list, so a stray `<div>` is a type error instead of a tag that type-checks and renders
nothing:

```json
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "@gjsify/gtk-host/react"
    }
}
```

## What is proven, and what is not

| claim | held by |
|---|---|
| both halves satisfy one declared surface | `tsc` — a platform module that renames, drops or invents a prop, or changes an arity, is a compile error |
| the `.native` half type-checks against **real** React Native | the `react-native` package's own types, never a subset |
| GTK: the widget is the real `Adw.*`, and it **renders** | the live GTK tree plus a GSK rasterisation, because GTK's failure mode is an empty window at exit 0 |
| React Native: which primitives, which props, which nesting | React's own reconciler over `react-test-renderer` |
| GTK: where the children actually END UP, not that they exist | numbers read off the live tree. Three 100-point children at `childSpacing` 20 in a 1000-point frame sit at x=0, 120 and 240, and `align={1}` moves a two-child line to x=780 and 900; a toolbar view's content starts at `topBarHeight` and is `height − topBarHeight − bottomBarHeight` tall, and extending the top edge moves it to y=0 while the bar KEEPS its height |
| GTK: a slot is the slot it was written into | the style class libadwaita puts on the box it packs into — `start`/`end` on the header bar, `top-bar`/`bottom-bar` on the toolbar view. `pack_start`, `pack_end`, `add_top_bar` and `add_bottom_bar` are all WRITE-ONLY, so an assertion that the child is merely present passes with the child in the wrong slot |
| both halves agree on the number | two frames, one of them ON the easing curve: 1000 points at `maximumSize` 400 gives width 400 at offset 300, and 700 points at the default 600/400 gives **575 at offset 62**, where a `min()` would give 600 |
| both halves answer the same for a property value GObject cannot store | `normalizeClampSize` from `@gjsify/adwaita-core`, run by **both** halves — the same call `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` make. `400.7` &rarr; 400, `NaN` &rarr; the default 600, `-5` &rarr; the range floor 0, asserted on both sides |

**Not proven: Yoga, and the device.** A `width` in a style object is an instruction to a
layout engine that no test here runs. The React Native half is type-checked and
tree-checked and has never been on a phone. That gap closes with an app on a real device,
and until then it is a gap, not a formality.

## Named divergences

These are places where the two halves cannot be made identical, written down rather
than smoothed over.

- **`AdwClamp` ignores the child's intrinsic minimum on React Native.** libadwaita's
  clamp is a two-pass measure-then-allocate, and a child minimum wider than the clamp
  RAISES all three thresholds — which is how such a child still gets its minimum
  instead of being cut off. React Native has no such pass: `onLayout` reports a size
  after layout and never the child's intrinsic minimum. So `childMin`/`childNat` are
  passed as 0, and a child wider than the clamp is compressed here and is not on GTK.
- **`AdwClamp`'s `small`/`medium`/`large` size class is not carried.** libadwaita stamps
  it on the child as a style class; React Native has no class system to stamp it into,
  and inventing a styling seam is a decision this slice does not make.
- **One unclamped frame.** Before the first `onLayout` there is no available width, so
  the child renders full-width for one frame.
- **A second child is kept on React Native and dropped on GTK, silently.** `Adw.Bin`,
  `Adw.Clamp`, `Adw.StatusPage:child` and `Adw.ToolbarView:content` are one-child slots,
  and gtk-host's `single` child policy fills them with `set_child`, so a second child
  EVICTS the first — with no throw, no host error and no GLib message. A `View` has no
  such limit and renders both. Both behaviours are pinned by a test on each side, so
  neither can move alone. Refusing more than one child on both halves would close it and
  is a surface decision this slice does not make.
- **`AdwHeaderBar` resolves an unauthored title on GTK and leaves it blank on a phone.**
  Authoring neither `title` nor `subtitle` installs no title widget at all, so
  libadwaita's `update_title` (adw-header-bar.c:475) walks navigation page → dialog →
  window → application name and puts what it finds in the centre; a phone has none of
  those to walk. Both sides are asserted — the GTK suite reads the window's own title
  back out of the bar, the React Native suite reads two collapsed labels.
- **`AdwHeaderBar` has a `title`/`subtitle` that `Adw.HeaderBar` does not.** The real
  widget has no `title` property; its derived centre is a plain `gtk_label_new (NULL)`
  with no subtitle at all, and an app that wants one sets an `AdwWindowTitle` as its
  title widget. A declarative surface wants the attribute, so authoring either installs
  an `AdwWindowTitle` centre. This is the same divergence `@gjsify/adwaita-web` and
  `@gjsify/adwaita-nativescript` carry, recorded as `HeaderBarRenderState.derivedSubtitle`
  in `@gjsify/adwaita-core`.
- **`AdwStatusPage` draws no icon on React Native.** `icon-name` names an entry in an
  ICON THEME and React Native has none — no `Image` source a GNOME symbolic name resolves
  to, and no renderer for the SVG `@gjsify/adwaita-nativescript` substituted instead.
  Drawing the name as text would put the literal `folder-symbolic` on screen. The prop is
  carried so a GTK consumer's props stay portable, and the ABSENCE of an icon node is
  asserted, so the day one appears it is a decision and not a drift.
- **`AdwToolbarView` does not run libadwaita's allocation on React Native, and cannot.**
  `adw_toolbar_view_size_allocate` is two chained CLAMPs over the bars' MINIMUM and
  NATURAL heights — ported as `toolbarViewAllocate` and held to vectors — and React
  Native hands a component an already-laid-out size and never a child's intrinsic
  minimum. Feeding the measurement in as both `min` and `nat` would turn each CLAMP into
  the identity and dress a pass-through up as libadwaita's arithmetic. The consequence is
  one-directional: a STRETCHY bar keeps its natural height where libadwaita would shrink
  it toward its minimum to protect the content.
- **`AdwToolbarView`'s four style classes have nowhere to land on a phone.** `raised`,
  `border`, `undershoot-top` and `undershoot-bottom` are what `topBarStyle` and
  `bottomBarStyle` derive; React Native has no class system to stamp them into. Both
  props are carried and reach no style, which is asserted on the React Native side and
  measured against libadwaita's own `update_undershoots` on the GTK side.
- **`AdwWrapBox`'s `naturalLineLength` is a MAX SIZE on React Native.** libadwaita caps
  the box's NATURAL size REQUEST and leaves a larger allocation free to happen; neither
  CSS nor Yoga has a property that caps only the intrinsic contribution, so this half
  writes `maxWidth`/`maxHeight`. `@gjsify/adwaita-web` records the same deliberate
  deviation. Limiting line length inside a popover — the intended use — behaves the same
  either way.
- **`AdwWrapBox` wraps every child in a `View` of its own.** `flex-grow` and `flex-shrink`
  belong to the CHILD, and this component does not own its children's styles:
  NativeScript sets them as attached properties and the browser publishes a custom
  property its stylesheet reads, and neither seam exists here. The wrapper is therefore
  visible in the tree and is asserted rather than left as an implementation detail.
- **`AdwWrapBox`'s `align` is snapped to three positions on both non-GTK renderers.** C
  offsets the whole line block by `roundf (length_delta * align)` — a continuum — and
  flexbox has `flex-start`, `center` and `flex-end`. The snap is the renderers'
  approximation and not libadwaita's rule, which is why it lives in
  `@gjsify/adwaita-core`'s `wrapBoxFlexStyle` rather than in a conformance vector. The
  GTK half runs none of it: `Adw.WrapBox` is `adw-wrap-layout.c` itself, and the suite
  reads the continuum back off the live tree.
- **`Adw.ClampScrollable` has no counterpart and will not get one.** It binds its four
  scroll properties onto its child, which is a GTK adoption concern; on React Native
  scrolling belongs to the `ScrollView`, not to the clamp. This is an asymmetry, not a
  missing widget.
