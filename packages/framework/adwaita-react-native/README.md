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

**A walking skeleton, not a widget set.** Two widgets — `AdwBin` and `AdwClamp` —
carrying the whole vertical: both platform halves, the resolution mechanism, the
manifest declaration, a gate, suites on both sides, and a photograph of the GTK half.
The remaining widgets are repetition against a boundary that has been measured.

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

Props are libadwaita's own names, camelCased — `maximumSize` is `AdwClamp:maximum-size`,
not a React Native `maxWidth` — so the property you look up in libadwaita's documentation
is the property you write. Defaults are libadwaita's.

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
- **A second child is kept on React Native and dropped on GTK, silently.** `Adw.Bin` and
  `Adw.Clamp` are one-child widgets, and gtk-host's `single` child policy fills that slot
  with `set_child`, so a second child EVICTS the first — with no throw, no host error and
  no GLib message. A `View` has no such limit and renders both. Both behaviours are pinned
  by a test on each side, so neither can move alone. Refusing more than one child on both
  halves would close it and is a surface decision this slice does not make.
- **`Adw.ClampScrollable` has no counterpart and will not get one.** It binds its four
  scroll properties onto its child, which is a GTK adoption concern; on React Native
  scrolling belongs to the `ScrollView`, not to the clamp. This is an asymmetry, not a
  missing widget.
