# 32. A React Native view layer over the GTK host, split so every binding can use the shared half

- Status: **Proposed**
- Date: 2026-08-26
- Deciders: Pascal Garber
- Related: [ADR 0027 (GTK host layer)](0027-gtk-host-layer.md), [ADR 0028 (widget table provenance)](0028-widget-table-provenance.md), [ADR 0029 (`@girs/*` widget vocabulary)](0029-girs-widget-vocabulary.md), [ADR 0016 (status as data)](0016-status-as-data.md), [ADR 0012 (framework register ownership)](0012-framework-register-ownership.md), [ADR 0024 (`gjsify ship`)](0024-ship-installable-artifacts.md)

## Context

`@gjsify/gtk-host/react` renders React onto GTK, and it renders it in GTK's own
vocabulary: `<gtk-box orientation="vertical">`, GTK property names, `css-classes` as
a string array. An application already written for React **Native** speaks a
different one — `<View>`, `<Pressable>`, `className="flex-1 items-center mt-m"` — and
none of it lands.

React Native is the most widely used TypeScript UI framework for Android and iOS.
Making its view vocabulary render on GTK is what turns "gjsify can run React" into
"an existing React Native codebase can grow a desktop target".

### The measurement

The numbers below come from one real, production-shaped Expo / React Native
application: five tab screens, an article reader, audio and video playback, an
onboarding flow. 5 597 LOC of TSX in the view layer over a **platform-free core** of
4 425 LOC that imports no UI framework and no platform SDK. Expo SDK 56, React
Native 0.85, React 19.2, NativeWind 4.2, `expo-router` 56.2.

It is a measuring stick, not a commitment. What it is good for is that it makes
"would this be any good for a real React application" an answerable question.

**The component surface is twelve names.** 67 named imports from `react-native`:

| import | uses | GTK |
|---|---:|---|
| `View` | 55 | `Gtk.Box`, or `Gtk.Overlay` when a child is absolutely positioned |
| `Text` | 233 | `Gtk.Label` (4 direct, 229 through a local typography wrapper) |
| `Pressable` | 34 | `Gtk.Button` (flat) |
| `ScrollView` | 19 | `Gtk.ScrolledWindow` + an implicit content box |
| `ActivityIndicator` | 10 | `Adw.Spinner` |
| `TextInput` | 3 | `Gtk.Entry` / `Gtk.TextView` — one prop in RN, two widgets in GTK |
| `Linking` | 2 | `Gtk.UriLauncher` |
| `Switch`, `Share`, `Platform`, `Modal`, `useColorScheme` | 1 each | `Gtk.Switch`; clipboard; trivial; `Adw.Dialog`; `Adw.StyleManager.dark` |

Plus five type-only imports (`ViewProps`, `TextProps`, `PressableProps`,
`LayoutChangeEvent`, `ColorValue`), which cost nothing.

**The styling surface is smaller than its reputation.** 469 `className=` against 57
`style={`, and the class vocabulary is **86 distinct names** in total — one screen.
Four properties of it shape every decision below:

1. **No `dark:` variant occurs at all.** Dark mode runs through CSS variables that a
   root class redefines. On GTK that is one variable block per scheme with
   `Adw.StyleManager` switching between them, and `bg-grey-100` flips by itself.
2. **`active:` is the only variant** — 38 uses across four values
   (`active:opacity-60/70/80/90`). GTK CSS has `:active` natively.
3. **Spacing and colour are token names** (`mt-2xs`, `bg-emphasis`), generated from a
   design-token source into the Tailwind config. The vocabulary is already data the
   project owns.
4. **`absolute` occurs 5 times and always on the child** — never "this element
   positions itself" but always "this child sits on top of its parent".

24 `className={…}` sites are computed rather than literal, and 48 of the 57
`style={{…}}` are object literals carrying the same property names as the classes.

**Three things a first reading gets wrong, all measured:**

- **`Pressable` children-as-a-function-of-`{ pressed }`: zero occurrences.** The
  press state is entirely a styling variant. This is worth stating because it looks
  like the hard part and is not the one that blocks anything.
- **Reanimated and Worklets are not on the critical path.** Declared, never imported
  from application source. Eleven declared dependencies are unimported.
- **`expo-router` is two things and only one is large.** The API surface used is
  **five names** — `router` (19), `useLocalSearchParams` (7), `usePathname`, `Tabs`,
  `Stack`. What is large is the file convention: 27 route files using `(group)`,
  `[param]`, `_layout`, `+not-found`.

### The prior art that changed one decision

`gtkx` (v1.4.0, MPL-2.0, in `refs/`) ships `@gtkx/navigation`: **React Navigation 7's
`core` and `routers` packages, unpatched, with no React Native dependency**, rendering
`createStackNavigator` onto `AdwNavigationView` and `createTabNavigator` onto
`AdwViewStack`. Four navigators cost **163 lines** of own router logic; everything
else is `useNavigationBuilder` plus widget calls. Their test-to-source ratio there is
2.1 : 1, which is the honest signal of how many edge cases a navigator holds.

Read for its decisions only — its licence is not ours, and its substrate is a Rust
addon plus generated FFI bindings rather than `gi://`.

## Decision

### 1. Three layers, and the seam is where the shared half ends

- **L1 — the style partition.** A normalised property set →
  `{ css, props, intent }`. Pure TypeScript, no framework, testable without GTK.
- **L2 — primitive descriptors as data**, in `gtk-host`'s descriptor shape. No
  framework knowledge. Resolves `intent` against the shadow tree at attach time.
- **L3 — framework components.** React first; one non-React adapter is built in the
  same change as the proof.

L1 is the half every current and future binding can use: `class="flex-1"` on a Vue
template is the same question as `className="flex-1"` on a React element.

### 2. L1 is a subpath of `@gjsify/gtk-host`; L2 and L3 are a new package

`@gjsify/gtk-host/style` holds L1, because it *is* GTK knowledge — property names,
ParamSpec coercion, `css-classes` — and ADR 0027 rule 1 forbids exactly what a
separate package would create: widget knowledge in two places.

L2 and L3 become **`@gjsify/react-native`**. The name is the documentation of the
bundler alias line (`'react-native' → '@gjsify/react-native'`), and that alias only
works if the export surface mirrors React Native's.

L2 is written as **data**, not code, so lifting a framework-neutral primitive
vocabulary out of it later is a move rather than a rewrite. It is deliberately not
built abstractly over two dialects now: one dialect is not a measurement.

### 3. The class compiler owns the families and reads the values

Families are enumerable and declared (`mt`, `flex`, `items`, `bg`, `justify`,
`rounded`, …). **Values are read from the project's own Tailwind configuration.**
A compiler that knows the families and reads the scales covers the measured
application completely and the next one with no code change.

**Build-time table, runtime resolution.** Runtime because computed class names exist;
a build-time table because otherwise a configuration parser ends up in the bundle.
**An unknown class is a named throw, identically in both paths** — a silent drop in a
styling layer is invisible in CI and obvious on screen.

Rejected: reusing NativeWind / `react-native-css-interop` and implementing only
"style object → GTK". It would inherit Tailwind for free and drag NativeWind's
binding to React Native internals (`StyleSheet`, `Appearance`, `Dimensions`,
`PixelRatio`) into the critical path — the same two-lossy-mappings-stacked shape that
rules out `react-native-web` over a DOM.

### 4. One normalised property set, not two front ends

`className` → properties → partition. `style={{…}}` → the same properties → the same
partition. Two partitions would be two truths about one question, and the object
literals already carry the class families' own names.

### 5. `className` is consumed by the RN layer and erased

What reaches `gtk-host` is `{ cssClasses, props }`. Roughly two thirds of the measured
vocabulary becomes **widget properties**, one third becomes **GTK CSS**. Forwarding
`className` into `css-classes` unchanged would put a GTK CSS class named `flex-1` on
a widget, where it does nothing, while the property that would have done something is
missing.

The paint half keeps its names — `bg-grey-100` becomes a real GTK CSS class of the
same name, readable in the inspector. A separately authored `css-classes` is unioned,
never overwritten.

### 6. `flex-1` is resolved in L2, at attach time — and this is not an over-complication

**The same class compiles to `hexpand` or to `vexpand` depending on the PARENT's
orientation.** L1 therefore cannot be a pure per-element function. It emits
`{ expand: 'main-axis' }` as an *intent*, and L2 resolves it when the node is
attached, because the shadow tree is the truth and already knows the parent.

Recorded here because the alternative looks simpler and is worse: pushing it into L3
via a React context would put layout knowledge in the framework layer, which is the
rule ADR 0027 § 7 exists to hold. Anyone simplifying this back should first say how a
context reaches the Vue and Solid adapters.

`justify-between` is the one genuinely leaky mapping — GTK's box has no main-axis
justification. It becomes `Gtk.CenterBox` for two or three children and a **named
refusal** beyond that. An approximation there is worse than a refusal, because the
approximation is invisible until someone looks at the window.

### 7. Press state is a CSS pseudo-class, not React state

`active:*` becomes GTK CSS `:active`. GTK animates the state itself, and a reconciler
pass per finger-press is wasted on a desktop. Children-as-a-function belongs to the
"usable" milestone and is a **named build-time refusal** until then, never an
`undefined` render.

### 8. Gaps are loud, from one data source

A JSON file in the package lists every React Native export with a status
(`supported` / `partial` / `refused` / `no-desktop-meaning`) and a one-line reason.
The **bundler plugin** reads it and fails the build on an unsupported import; the
**runtime** reads the same file for anything dynamic; the **README is generated** from
it. This is ADR 0016 applied to a new field. A hand-maintained support table beside it
is the second truth this repository has already collected several times.

This is what makes the project's actual goal true. The goal is **not** one source
tree that runs everywhere; it is that porting is cheap and every divergence is
*knowable at build time* rather than discoverable in a window.

### 9. Platform file resolution: `.gtk` → `.<os>` → `.desktop` → base

```
foo.gtk.tsx      →  GTK-specific
foo.linux.tsx    →  OS-specific (likewise .macos / .windows)
foo.desktop.tsx  →  any desktop target
foo.tsx          →  base
```

Implemented by extending the existing `platformResolvePlugin` (today `.android` /
`.ios` / `.native`), never as a second plugin, so the tree has one resolution order.

**`.native` is deliberately NOT in this chain, and `.web` never is.** This looks like
an oversight and is the opposite: a `.native.tsx` is by definition written for a React
Native runtime and reaching for it would silently feed the GTK build code that expects
`NativeModules` — found only in the window. Falling through to the base file is the
honest outcome. `.web` is worse still: it looks like the right choice for a desktop
target and carries exactly the DOM assumptions this design rules out.

### 10. Routing reuses `@react-navigation/core`

`expo-router` is built on React Navigation, and React Navigation 7's `core` and
`routers` run unmodified without React Native — measured in the prior art above, at
163 lines of own router logic for four navigators. The five `expo-router` names become
a thin layer over it rather than a second router beside it.

Two things the prior art proves are not optional, and both are cheap to forget:

- **A route key must be the widget's join key.** `AdwNavigationView` owns a real
  navigation stack and React Navigation owns another; the two are reconciled by tag.
  React declares membership, GTK owns ordering.
- **The reverse direction exists.** A user pops with a swipe, Escape, Alt+Left or the
  mouse back button, and the widget's own `popped` signal must become a
  `StackActions.pop`. Without it `usePreventRemove` is a lie on every gesture.

Full `expo-router` compatibility is rejected: it drags react-navigation's own
peers — `react-native-screens`, `gesture-handler` — which the measured application
never imports. Reproducing a dependency cloud nobody calls is not compatibility.

### 11. The proof lives in this repository

A showcase reproducing an ordinary design-system layer — badge, button, card, chip,
hairline, rail, screen, section header, thumbnail, typography — written fresh under
MIT against the same class vocabulary, self-verifying through `runHostProbeApp`. The
measured application is a third-party codebase under a different licence and cannot be
the regression test.

### 12. The build chain belongs to the consumer

gjsify supplies the plugin (`@gjsify/vite-plugin-gjsify`, or a sibling for another
bundler). It does not own the application's build. NativeWind is therefore not
*supported* but *replaced*: the same class vocabulary is consumed, none of its
toolchain is.

## Consequences

- **One capability is genuinely out of reach, not deferred.** Worklet-based libraries
  (`react-native-reanimated`) need a Babel transform that is not in this chain. That
  belongs in the support table as *not reachable*, not as *later*.
- **`@gjsify/react-native` carries a peer on `react` and on
  `@react-navigation/core`.** The first is unavoidable; the second is a deliberate
  external dependency in the routing path, bought with a measurement.
- **The support table becomes a published contract.** Its shape is covered by the
  manifest-conformance machinery like every other declared field.
- **Windows and macOS run this through Node + `@gjsify/node-gi` +
  `@gjsify/gtk-runtime-<os>-<arch>`** — there is no GJS host on Windows (ADR 0024 § 4).
  node-gi is the lead runtime on all three; GJS on Linux is the parity check, not a
  second matrix. Producing an installable artifact for macOS and Windows is ADR 0024
  stages 4 and 5, which do not exist yet, and is tracked as its own work.

## What this does not decide

- **The NativeScript component vocabulary.** `packages/nativescript-bridge` is a fine
  thing on its own terms and shortens this path by nothing. Lifting L2 into a
  framework-neutral primitive vocabulary that RN and NativeScript both spell is the
  reachable version of that idea, and it needs a second dialect measured before it is
  a decision rather than a guess.
- **A `.web` export over `@gjsify/adwaita-web`.** ADR 0027 § 9 already records "one
  vocabulary across every surface" as a goal whose alignment check does not exist yet,
  and names the criterion that would close it. This ADR does not move that line.
