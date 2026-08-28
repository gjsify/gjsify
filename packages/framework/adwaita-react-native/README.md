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

## How the two halves are selected

Through the package's `exports` map and the `react-native` condition. Every barrel
names its platform files **literally** (`./widgets/clamp.native.js` /
`./widgets/clamp.gtk.js`); nothing relies on a resolver picking a sibling.

| condition | entry |
|---|---|
| `react-native` | `lib/esm/index.native.js` |
| `default` | `lib/esm/index.gtk.js` |
| `exports` ignored, `module` read | `lib/esm/index.js` — refuses, by name |

A stock React Native 0.87 application gets the native half with no configuration:
`metro-config` sets `unstable_enablePackageExports: true`, and
`@react-native/metro-config` sets `unstable_conditionNames: ['react-native']`.

**The ORDER of those conditions is the map**, not a formatting detail: `exports` answers
with the first one that matches and `default` matches everything, so moving `default`
ahead of `react-native` hands the GTK build to every phone — measured through
`metro-resolver@0.87.0`, which then resolves this package to `lib/esm/index.gtk.js` on
ios and android alike. `scripts/check-adwaita-rn-platform-split.mjs` asserts the order
for that reason; a key lookup cannot see it.

The refusal's audience is narrower than "a tool that ignores export conditions", and the
measurement says so: Node honours `exports` whenever it is present, and metro with
package exports switched off reads `['browser', 'main']`, neither of which this package
declares — it fails to resolve rather than reaching the base barrel. What is left is a
bundler that ignores `exports` and reads `module`, which is where `lib/esm/index.js` and
its named throw are for.

### Why not `.native.tsx` beside `.tsx`

Because it does not work for a published library, and this was measured rather than
assumed. Metro's `resolveSourceFile` tries the **literal** path first — no platform, no
`preferNativePlatform` — and our shipped modules import each other with the `.js`
extension. Metro finds `clamp.js` and never looks at `clamp.native.js`. The `.native`
step wins only for extensionless specifiers, which a `lib/esm` build does not emit.
(NativeScript escapes this because its platform files are resolved in the *consumer's*
build; Metro resolves at resolution time.)

Both mechanisms still exist and are still right for an *application*. Neither carries
this library.

The price is that the `exports` map and the three barrels are hand-maintained, which is
why `scripts/check-adwaita-rn-platform-split.mjs` is a condition of the design rather
than a nicety: every widget has both platform modules, the map names both, the base
module refuses, and each platform module carries the `@jsxImportSource` its half needs.

## Consuming it

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
| both halves satisfy one declared surface | `tsc`, through `parity.spec.ts` — a platform module that renames, drops or invents a prop, or changes an arity, is a compile error. The prop half is a key-set comparison, not assignability: `AdwClampProps` is all-optional, and structural assignability accepts a rename between two such types |
| the `.native` half type-checks against **real** React Native | the 32 MB `react-native` devDependency and its `types_generated`, never against a subset |
| GTK: the widget is the real `Adw.*`, and it **renders** | `clamp.gtk.spec.tsx` — the live GTK tree plus a GSK rasterisation through `shotEvidence`, because GTK's failure mode is an empty window at exit 0 |
| React Native: which primitives, which props, which nesting | `clamp.native.spec.tsx` — React's own reconciler over `react-test-renderer`, against a type-pinned double |
| both halves agree on the number | two frames, one of them ON the easing curve: 1000 points at `maximumSize` 400 gives width 400 at offset 300, and 700 points at the default 600/400 gives **575 at offset 62** where a `min()` would give 600 — each asserted as a GTK allocation on one side and a style object on the other. The first pair alone would not be enough: `tightening-threshold` defaults to 400, so `maximumSize={400}` collapses `lower`/`max`/`upper` onto one point and the eased region has zero width there |
| the properties take the range GObject enforces | `normalizeClampSize` from `@gjsify/adwaita-core`, the same call `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` make — measured against the real widget, `maximumSize={400.7}` allocates 400 (an int property truncates) and `maximumSize={NaN}` keeps the default 600 (GObject refuses the assignment) |

**Not proven: Yoga, and the device.** A `width` in a style object is an instruction to a
layout engine that no test here runs. The React Native half is type-checked and
tree-checked and has never been on a phone. That gap closes with an Expo app on a real
device, and until then it is a gap, not a formality.

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
- **A value GObject would clamp is clamped, not refused.** `maximum-size` is
  `g_param_spec_int (…, 0, G_MAXINT, …)`, and a negative assignment on GTK is rejected
  outright — the property keeps its previous value, measured: `maximumSize={-100}` leaves
  the real `Adw.Clamp` at 600. `normalizeClampSize` clamps it to the range floor, 0,
  because it also serves an attribute string where there is no GObject to refuse
  anything. So a negative gives 600 on GTK and 0 here.
- **`Adw.ClampScrollable` has no counterpart and will not get one.** It binds its four
  scroll properties onto its child, which is a GTK adoption concern; on React Native
  scrolling belongs to the `ScrollView`, not to the clamp. This is an asymmetry, not a
  missing widget.

## Publishing

`@gjsify/adwaita-react-native` is a new npm name. The first publish and the Trusted
Publisher bootstrap are a maintainer action (`gjsify onboard`, twice — the trust
configuration 404s immediately after the first publish), deliberately not attempted from
CI or from a feature branch.
