# @gjsify/react-native

React Native's view vocabulary, rendered onto GTK4 and Adwaita.

This is the package a consumer's bundler aliases `react-native` to, so its export
surface mirrors React Native's own — all 92 public names. What is implemented is
exported normally; **what is not is exported as a value that refuses with a reason**,
because `MISSING_EXPORT` tells a reader the name is unknown while the support table
can tell them it is tier P2, maps onto `Gtk.ListView`, and is not built yet.

Architecture and the decisions behind it: [ADR 0032](../../../docs/adr/0032-react-native-on-the-gtk-host.md).

> **Status: the P1 surface.** All three layers the ADR describes exist — the style
> partition (`@gjsify/gtk-host/style`), the framework-agnostic primitive descriptors
> (`./primitives`), and the framework components, in **two** bindings: React at the
> package root and Solid at `@gjsify/react-native/solid`. Seven primitives and four
> APIs are implemented, each with its limits written out below. Everything else is a
> loud refusal. Read the table before pointing an application at this.

## The support table is the contract

One file, `src/support-table.ts`, gives every React Native export a status and a
one-line reason. Three readers share it and none of them keeps a copy:

- the **bundler gate** fails a build on an import that is not supported,
- the **runtime** throws the same sentence for anything reached dynamically,
- the **section below is generated from it** — do not edit it by hand.

`scripts/check-rn-surface.mjs` holds the key set against react-native's own
`index.js`. It always compares against a committed snapshot, and additionally against
a real `react-native` install when one is resolvable — and it prints which of the two
it did, because a gate that silently degrades to the weaker half is worse than one
that has only the weaker half.

## The PROP surface is a contract too, and it is published

The support table answers "may this application import this name". One grain finer
sits `src/primitives/table.ts`, which decides what each PRIMITIVE does with each
PROP — and until [ADR 0039](../../../docs/adr/0039-react-native-prop-surface.md) it
was not an entry point, so a refusal could only be discovered by RENDERING. That cost
a whole tree once: a `<Text onPress>` in a tab stack that mounts every tab from the
start route threw out of a render, and React unmounts the root when a render throws
with no error boundary above it — 92 125 bytes of widget dump clean against 12 848
with the throw, same screen, same host.

The refusal is right and it still throws: a prop that silently does nothing is
indistinguishable from a bug in the application, forever. What was missing is a way to
ask FIRST, and that is `@gjsify/react-native/prop-table`:

```ts
import { acceptsProp, explainProp } from '@gjsify/react-native/prop-table';

// in your own test suite, before a window exists
expect(acceptsProp('Text', 'onPress')).toBe(false);
expect(explainProp('Text', 'onPress')).toContain('Wrap it in a `<Pressable>`');
```

`explainProp` returns the very sentence a render would have thrown — one classifier
(`src/primitives/answers.ts`) serves both, so the static answer cannot drift from the
runtime one. [PROPS.md](PROPS.md) is the generated document, one section per
primitive, held byte for byte by `check-rn-surface.mjs`.

## `<TextInput>`'s ref is a handle, not the widget

React Native's `TextInput` is a class, so `useRef<TextInput>(null)` and
`ref.current?.focus()` are ordinary code. Here `TextInput` is a component function
merged with an instance interface, and the ref receives `focus`, `blur`, `clear`,
`isFocused` and `setSelection` over GTK, plus `widget` — the `Gtk.Entry` or
`Gtk.TextView` itself, which is where anything the handle does not answer lives.
`measure`, `measureInWindow`, `measureLayout` and `setNativeProps` are present and
**refuse by name**, because an absent method is `undefined is not a function`.

Every other primitive's ref is the `Gtk.Widget`, unchanged.

## Getting a window

```ts
import { registerRootComponent } from '@gjsify/react-native';
import App from './App.js';

await registerRootComponent(App, { applicationId: 'org.example.App', title: 'Example' });
```

`applicationId` is required, and it is the one declared divergence from React
Native: `AppRegistry.runApplication` there is handed a root tag by a host that
already exists, while on a desktop **the application is the host**. That limit is in
the table rather than only here.

## Three layers, and where each one lives

| layer | where | knows about |
|---|---|---|
| L1 — the style partition | `@gjsify/gtk-host/style` | GTK property names, GTK CSS, ParamSpec coercion. No framework, no React Native. |
| L2 — the primitive descriptors | `./primitives` (`primitives.resolvePrimitive`) | which widget a primitive becomes, and where each prop goes. **No React.** |
| L3 — the components | the package root (React), `./solid` (Solid) | `createElement` / signals, the parent-context carrier. Two lines each. |

L2 is exported (`import { primitives } from '@gjsify/react-native'`) so any binding
can render the same vocabulary without going through the React components.

### What a parent asks about its children, and what stays transparent

A few decisions cannot be taken by the element that authored them. `position: absolute`
is the clearest: it positions the element on top of its parent, so the **parent** has
to be a `Gtk.Overlay` — and a `View` becomes one as soon as one of its children asks.
The same shape decides whether a text child competes with a prop for a widget's text
sink, and `justify-between` is refused on a child count.

React's parent renders before its children exist, so it reads their **descriptors**.
Three things are therefore transparent to that read, and each is transparent because
an application writes it without meaning to change anything:

- **a Fragment.** `<>…</>` is transparent to layout in React, so it is transparent
  here: it is expanded away before anything is counted, its children keeping their own
  keys composed behind its own. A card whose `overlay={<>…</>}` holds the absolutely
  positioned child gets the overlay it asked for.
- **an array**, which is the same statement in a different spelling.
- **an `<Animated.View>`.** Its style carries `Animated.Value`s, which is exactly what
  the style partition refuses on a plain element — so a parent reads it through the
  same split the component itself uses. An animated fade and an `absolute` compose.

What is NOT transparent is a foreign composite component: `<MyCard className="…">` may
carry any vocabulary at all, and a parent must not throw for one it cannot route, so it
answers "no" and the child — if it ever reaches L2 — is refused by name. That boundary
is enumerated in `src/child-facts.spec.ts` as every fact a parent reads × every wrapper
it can arrive in, with the fact list derived from the record itself: a new fact has no
row until someone adds one, and the suite says so.

### The split is measured, not asserted

`@gjsify/react-native/solid` exports the same seven primitives as SolidJS components
over the **same** L2, and `src/solid/solid.spec.ts` renders one authored tree — held
in neither framework's spelling — through React's reconciler and through Solid's
non-reconciler, then asserts the two GTK widget trees are identical: widget types,
`css-classes` including the generated class name, and every probed property, at every
depth. Solid was chosen because it has no VDOM and no reconciler, so "L1 and L2
secretly depend on React" cannot survive it.

```ts
import { mount, View, Text } from '@gjsify/react-native/solid';

const dispose = mount(() => <View className="p-2"><Text>hello</Text></View>, window);
```

`solid-js` is an OPTIONAL peer: nothing in the React path imports it, and nothing in
the Solid path imports React.

Two things the Solid binding does differently, both consequences of a framework that
builds a tree bottom-up and never re-renders a subtree, and neither of them a change
to L2:

- **children must arrive lazily** — `get children() { … }`, which is what every Solid
  JSX compiler emits. An eagerly built child resolves outside its parent's context
  and would silently lose `flex-1` and any inherited alignment, so it is a named
  refusal.
- **a reactive update may not change the WIDGET.** `multiline` swapping `Gtk.Entry`
  for `Gtk.TextView` is fine on first render and refused as an update: a Solid
  element is created once, and there is no commit that could replace it.

## The token scales come from the project

ADR 0032 § 3: the class FAMILIES are declared in `@gjsify/gtk-host/style`, the VALUES
belong to the project. Nothing reads a Tailwind config at runtime, so hand them in
once, before the first render:

```ts
import { configureStyle } from '@gjsify/react-native';
import tokens from './design-tokens.json' with { type: 'json' };

configureStyle({ tokens });
```

Without it the default is `MINIMAL_TOKENS`, which is deliberately tiny — so the first
`className="mt-2xs"` is a named error listing what the scale does hold, rather than a
margin resolved against a value nobody chose.

## What the style layer refuses, and why that is the feature

An unknown utility, an unmapped prop, a combination GTK cannot express: every one is
a named error saying what arrived, why GTK has no answer, and what to write instead.
The reason is not strictness for its own sake — GTK's failure mode is **exit 0**.
`box.orientation = 'vertical'` keeps HORIZONTAL with no diagnostic; a CSS property
GTK does not know is dropped by its parser in silence; a prop this layer ignored is
indistinguishable from a bug in the application, forever.

A few that are worth knowing before they surprise you:

- **`justify-between`** is refused. ADR 0032 § 6 maps it to `Gtk.CenterBox` — a
  different WIDGET, not another property on this one, and WHICH widget it is depends
  on the child count. This layer resolves properties for the widget it was handed
  and has no children to count. Use a `flex-1` spacer or `gap-*`.
- **`active:`** is the only variant idiom that pays off, and it costs nothing: it
  becomes a GTK CSS `:active` pseudo-class on the generated class, so GTK animates a
  press with no re-render at all. A variant on a WIDGET property (`active:flex-1`) is
  refused — GTK has no pseudo-class form of one.
- **`<Modal>`** is not implemented, and not for lack of a mapping. An `Adw.Dialog` is
  PRESENTED against a parent, never parented by it: `box.append(dialog)` calls
  `g_error()` — SIGABRT and a core dump, measured. It needs a portal seam in the
  host, so it stays a refusing export instead of a `partial` that kills the process.

## Routing

`@gjsify/react-native/router` is the `expo-router` surface — five names and four file
conventions — over **`@react-navigation/core` and `@react-navigation/routers`, run
unmodified**. Both are **peer** dependencies (ADR 0032 § 10), and that kind is not a
detail: `@react-navigation/core` holds 19 module-level `createContext` calls, so a
consumer pinning a different major would get a nested second copy, this navigator
would write one set of contexts and their screen would read the other, and the symptom
would be react-navigation's own *"Couldn't find a navigation object"*. As a peer, the
same input is an install-time `ERESOLVE` naming both ranges. It also keeps `react`
optional here: `@react-navigation/core` declares `react` as a NON-optional peer, so
depending on it would make a Solid-only consumer install React.

```tsx
// app/_layout.tsx
import { Stack } from '@gjsify/react-native/router';
export default function Layout() {
  return <Stack><Stack.Screen name="index" options={{ title: 'Home' }} /></Stack>;
}
```

```ts
// the entry
import { AppRegistry } from '@gjsify/react-native';
import { RouterRoot } from '@gjsify/react-native/router';
import { manifest } from 'virtual:gjsify-rn-routes';   // the bundler plugin

AppRegistry.registerComponent('main', () => () => <RouterRoot manifest={manifest} />);
```

| convention | means |
|---|---|
| `(group)` | a directory that groups without contributing a URL segment |
| `[param]` | a dynamic segment; its value lands in `useLocalSearchParams()` |
| `_layout` | the file that owns its directory — it renders the navigator |
| `+not-found` | the fallback route, whose pattern is `*` |

A directory with **no** `_layout` is not a navigator: its routes flatten into the
nearest ancestor that is one, under a slash-joined name. So `detail/[id].tsx` works
with no `detail/_layout.tsx`, and adding one turns that directory into its own stack.

`Stack` renders `Adw.NavigationView`; `Tabs` renders `Adw.ViewStack` with an
`Adw.ViewSwitcher` in the header bar. The switcher is the better widget rather than a
substitute for a tab bar: it is driven by the stack's own page model, so a route file
adds a button with no tab-bar bookkeeping, its labels are also its accessible names,
and its NARROW/WIDE policy is what lets an application's breakpoint restyle it as the
window widens from one declaration. A React Native tab bar has one shape and the
application owns every pixel of the other.

The conventions are parsed **in this package, not in the plugin**, so a consumer on
another bundler — or one writing the nine-line manifest by hand — gets the same
refusals. The plugin walks a directory and emits what it found.

### One header bar per window, owned by the outermost navigator

An `Adw.NavigationPage` carries its own `Adw.HeaderBar`, so a `_layout` inside a
`_layout` describes a header bar inside a header bar. Measured on a five-tab
application entered at its index route, that drew **three** bars with **three close
buttons**, only one of which closed the window (#1460). Nothing in a file-system route
tree says which level owns the chrome, so this package decides it:

- The **outermost navigator owns the window's chrome** while it has a header bar on
  screen. It claims the bar `AppRegistry` puts in the window; the window takes it back
  when the root unmounts, and when the screen on top asks for none — an `Adw.Window`
  carries no titlebar of its own, so a `headerShown: false` screen that also took the
  window's bar away would be a window with nothing to close or move it with. For
  `<Stack>` ownership means the pages carry the chrome, which is Adwaita's own
  composition and the only one where the back button and the page title appear at all.
- An **inner `<Tabs>` contributes its `Adw.ViewSwitcher`** to the enclosing page's
  header bar title, where a hand-written Adwaita application puts it, instead of
  building a second bar. `headerShown: false` on the enclosing screen leaves no bar to
  contribute to, and the tab level then renders its own.
- **The window controls go on the outermost bar of each path.** An inner `<Stack>`'s
  pages still need their own back buttons, so their bars stay — without window
  controls. `Adw.NavigationSplitView` splits the same decoration across its two
  visible bars, which is why the rule that holds this is *one set of window controls
  per side*, not *one header bar*.

That rule is machine-checked from outside, over the widgets that actually DRAW:
`windowChromeProblems()` in `@gjsify/gtk-host/conformance` counts mapped, non-empty
`GtkWindowControls` per side of a presented window and names every duplicate — and
also refuses a window whose chrome draws nothing at all, which is the failure the fix
above can overshoot into. `headerRight`, `headerLeft` and a custom header component
are still not answered for; the support table says so by name.

## Support

See **[SUPPORT.md](SUPPORT.md)** — one section per declared surface, generated from
`src/support-table.ts` in registry order. It is a separate document because
`react-native`'s section alone is about a hundred table rows and the eighteen surfaces
together are several hundred; putting them here would bury everything above.

