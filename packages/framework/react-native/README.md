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

- **`justify-between`** is refused. ADR 0032 § 6 maps it to `Gtk.CenterBox`, and
  `Gtk.CenterBox` installs no `remove` method (measured), which the host's `slotted`
  placement policy requires. Use a `flex-1` spacer or `gap-*` until the policy grows
  a shape for it.
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

## Support

<!-- BEGIN generated support table -->

### Supported (4)

| export | tier | GTK | why |
|---|---|---|---|
| `useColorScheme` | P1 | Adw.StyleManager.dark | Follows the Adwaita colour scheme — the dark property, which is what the user is looking at, not color-scheme, which is what the application asked for. |
| `Appearance` | P2 | Adw.StyleManager | The imperative sibling of useColorScheme, over the SAME reader — getColorScheme reads Adw.StyleManager:dark (what the user is looking at) and setColorScheme writes :color-scheme (what the application asked for), which is exactly the split React Native’s getter and setter have. |
| `EventEmitter` | — | — | Pure JavaScript; nothing in it touches a platform. |
| `unstable_batchedUpdates` | — | — | React 19 batches automatically; this is the identity call it already is upstream. |

### Supported, with named limits (29)

| export | tier | GTK | why |
|---|---|---|---|
| `View` | P1 | Gtk.Box, or Gtk.Overlay when a child is absolutely positioned | The container primitive. Which widget it becomes depends on its children, not on the element. |
| `Text` | P1 | Gtk.Label | Wrapping is ON by default in React Native and OFF on a Gtk.Label, so the default is set explicitly. |
| `Pressable` | P1 | Gtk.Button (flat) | Press state is a GTK CSS :active pseudo-class; children-as-a-function is implemented over the state flag, and costs nothing when it is unused. |
| `ScrollView` | P1 | Gtk.ScrolledWindow + an implicit content box | contentContainerStyle styles the inner box, which is a second styleable node. |
| `ActivityIndicator` | P1 | Adw.Spinner | Direct counterpart. |
| `TextInput` | P1 | Gtk.Entry / Gtk.TextView | Single- versus multi-line is one prop in React Native and two different widgets in GTK. |
| `Linking` | P1 | Gtk.UriLauncher | openURL and canOpenURL only. |
| `Switch` | P1 | Gtk.Switch | Direct counterpart. |
| `Platform` | P1 | — | OS is "linux" \| "macos" \| "windows"; select() picks the default branch. |
| `Share` | P1 | Gdk.Clipboard | No desktop share sheet worth pretending about; copying the link is the honest mapping. |
| `AppRegistry` | P1 | Adw.Application + Adw.ApplicationWindow | The entry point. Nothing renders without a window, so this is P1 despite being a shim. |
| `StyleSheet` | P1 | Gdk.Monitor.scale for hairlineWidth | create/flatten/compose/hairlineWidth/absoluteFill. Style objects go through the same partition as classes (ADR 0032 § 4), which is why create can be identity. |
| `FlatList` | P2 | Gtk.ListView + Gio.ListStore, owned by the component | GTK virtualises for real. The list is NOT an ordinary element: a Gtk.ListView takes no children (measured — no append, add, insert, prepend, remove or set_child), so the component owns the view and drives the model from data, with React only inside the item factory. |
| `SectionList` | P2 | Gtk.ListView + one flattened Gio.ListStore | The same component as FlatList, handed sections instead of data. |
| `VirtualizedList` | P2 | Gtk.ListView | Its public surface is wide and mostly not worth honouring literally; the useful subset backs FlatList, and this name is that subset plus getItem/getItemCount. |
| `VirtualizedSectionList` | P2 | Gtk.ListView | The section-shaped sibling of VirtualizedList, which is SectionList here. |
| `Image` | P2 | Gtk.Picture | resizeMode becomes content-fit, and the default is inverted: React Native defaults to cover, a Gtk.Picture to contain (measured). |
| `ImageBackground` | P2 | Gtk.Picture in a Gtk.Overlay | A picture with the children stacked over it. The picture is the overlay’s MAIN child, because a Gtk.Overlay paints every overlay child ABOVE it. |
| `TouchableOpacity` | P2 | Gtk.Button (flat) | The same machinery as Pressable, written over it: one shared record of routes in the primitive table, one line of component. |
| `TouchableHighlight` | P2 | Gtk.Button (flat) | As TouchableOpacity. The pressed style is Adwaita’s own unless a variant says otherwise. |
| `TouchableWithoutFeedback` | P2 | Gtk.Box + Gtk.GestureClick | No chrome, so no button: a vertical Gtk.Box like a View, with a Gtk.GestureClick added to it. Measured: Gtk.Button emits activate and clicked, a Gtk.Box emits neither, and Gtk.GestureClick emits pressed/released/stopped/unpaired-release. |
| `Button` | P2 | Gtk.Button | The one component whose React Native styling story is "you cannot", which GTK agrees with. title, onPress and disabled. |
| `Dimensions` | P2 | Gtk.Window allocation, Gdk.Monitor geometry | get("window") is the window, not the screen — a desktop app is not full-screen, so the screen’s number would be wrong in the ordinary case. get("screen") is the monitor, because that is what it asks for. |
| `useWindowDimensions` | P2 | Gdk.Surface notify::width/height, Gtk.Window allocation | The hook form of Dimensions, through useSyncExternalStore so a resize between render and commit cannot tear. |
| `Alert` | P2 | Adw.AlertDialog | Direct counterpart, and buildable where Modal is not: Alert is a FUNCTION CALL, so no element is ever inserted into a widget. Measured on libadwaita 1.9.3 — present(null) from a plain function, with no parent and no window, returned with no diagnostic. |
| `SafeAreaView` | P2 | Gtk.Box | The INSET has no desktop meaning; the layout does. It is a View in every other respect, and it has to be a real export to be imported. |
| `StatusBar` | P2 | — | A desktop window has no status bar to configure, and <StatusBar/> is in the first ten lines of most React Native screens — so it renders NOTHING and says so, rather than failing to import. |
| `KeyboardAvoidingView` | P2 | Gtk.Box | No on-screen keyboard eats a desktop window layout, so the AVOIDING is the no-op. React Native’s KeyboardAvoidingView is a View that changes its own height; what is left here is the View. |
| `Keyboard` | P2 | — | Its events are on-screen-keyboard events, which do not occur — so the questions with a correct answer get it and the ones whose answer would have to be invented refuse. |

### Planned (28)

| export | tier | GTK | why |
|---|---|---|---|
| `Modal` | P1 | Adw.Dialog | An Adw.Dialog cannot be an ordinary element. MEASURED on libadwaita 1.9.3: box.append(dialog) calls g_error() — SIGABRT and a core dump, not a catchable exception — but ONLY when the box is rooted in a window. A detached box accepts the append in silence, so a re-test on a bare box appears to disprove this and puts the primitive back. A dialog is PRESENTED against a parent, never parented by it, so this is a PORTAL and needs a host seam that does not exist yet. |
| `AppState` | P3 | Gtk.Application / Gdk.Surface state | active/background from window focus and visibility. |
| `PixelRatio` | P3 | Gdk.Surface.scale-factor | The scale factor of the surface the widget is on. |
| `PlatformColor` | P3 | Adwaita named colours | Maps unusually well — GTK’s palette is exactly this idea. |
| `AccessibilityInfo` | P3 | Gtk.Accessible / AT-SPI | The highest-value P3 entry: GTK’s accessibility model is strong and the props map onto it well. |
| `Animated` | P3 | Adw.TimedAnimation / Adw.SpringAnimation | Genuinely mappable, but it is a subsystem rather than a component. Doing it badly is worse than not doing it. |
| `Easing` | P3 | — | Pure maths; it lands with Animated or not at all. |
| `LayoutAnimation` | P3 | — | Needs an animated layout pass, which is the same subsystem as Animated. |
| `InteractionManager` | P3 | — | Deferring work until interactions settle; a main-loop idle source is the counterpart. |
| `useAnimatedValue` | P3 | — | Part of the Animated subsystem. |
| `useAnimatedValueXY` | P3 | — | Part of the Animated subsystem. |
| `useAnimatedColor` | P3 | — | Part of the Animated subsystem. |
| `PanResponder` | P3 | Gtk.Gesture* controllers | The controllers exist; the arbitration model is not React Native’s, so this is its own project. |
| `usePressability` | P3 | — | The hook behind the Touchable family; it lands with the gesture work. |
| `DrawerLayoutAndroid` | P3 | Adw.OverlaySplitView | The pattern survives on a desktop even though the component is Android-only. |
| `I18nManager` | P3 | Gtk.Widget.direction | RTL is a widget-direction question on GTK. |
| `ToastAndroid` | P3 | Adw.Toast | Android-only by name, and Adwaita has the exact widget. |
| `TouchableNativeFeedback` | P3 | Gtk.Button | Android-only ripple; shimmed to its portable sibling. |
| `ActionSheetIOS` | P3 | Adw.AlertDialog with responses | iOS-only by name; the pattern is a dialog with choices. |
| `Clipboard` | P3 | Gdk.Clipboard | Deprecated upstream in favour of a community package, but trivial here. |
| `BackHandler` | P3 | — | An Android hardware back button. Routing has landed and this did NOT arrive with it, which the earlier reason assumed it would: BackHandler INTERCEPTS a back press and consumes it, and MEASURED on libadwaita 1.9.3, Adw.NavigationView emits `popped` AFTER the fact and has no vetoable "about to pop" signal at all — its only prevention is Adw.NavigationPage:can-pop, a property rather than an event. The honest counterpart is usePreventRemove, which the routing layer does honour through its popped bridge; this name needs a key controller of its own on the window. |
| `DynamicColorIOS` | P3 | — | A light/dark colour pair; the Adwaita scheme already provides the switch. |
| `processColor` | P3 | — | Colour string to a platform value; a Gdk.RGBA on this side. |
| `UTFSequence` | P3 | — | A table of unicode constants. Pure data, no platform in it. |
| `ReactNativeVersion` | P3 | — | The version this layer targets, reported honestly rather than spoofed. |
| `ProgressBarAndroid` | P3 | Gtk.ProgressBar | Android-only by name; GTK has the widget. |
| `NativeEventEmitter` | P3 | — | It would construct and subscribe, but nothing native would ever emit into it — shipping that needs a decision, not a class. |
| `DeviceEventEmitter` | P3 | — | The global emitter. Lands with NativeEventEmitter, and for the same reason. |

### No meaning on a desktop window (6)

| export | tier | GTK | why |
|---|---|---|---|
| `LogBox` | P3 | — | A development overlay for a phone; the console is the desktop equivalent. |
| `Systrace` | — | — | Android systrace has no desktop counterpart. |
| `Vibration` | — | — | A desktop machine does not vibrate. |
| `InputAccessoryView` | — | — | An iOS keyboard accessory bar; there is no keyboard to accessorise. |
| `DevMenu` | — | — | The shake-to-open developer menu. |
| `DevSettings` | — | — | Development-client settings for a phone runtime. |

### Refused (25)

| export | tier | GTK | why |
|---|---|---|---|
| `RefreshControl` | — | — | GTK has no pull-to-refresh idiom and should not grow one. Give the desktop build a refresh action instead. |
| `PushNotificationIOS` | — | — | Platform notification plumbing. A desktop app uses Gio.Notification directly. |
| `PermissionsAndroid` | — | — | Android runtime permissions have no desktop counterpart; portals are asked for at use time. |
| `Settings` | — | — | An iOS user-defaults bridge. GSettings is the desktop answer and is not this API. |
| `experimental_LayoutConformance` | — | — | An experimental switch between two React Native layout implementations. Neither is used here. |
| `unstable_VirtualView` | — | — | Unstable React Native internal. |
| `VirtualViewMode` | — | — | Unstable React Native internal. |
| `unstable_NativeText` | — | — | Unstable React Native internal. |
| `unstable_NativeView` | — | — | Unstable React Native internal. |
| `unstable_TextAncestorContext` | — | — | Unstable React Native internal. |
| `DeviceInfo` | — | — | A native module surface describing a phone. |
| `NativeModules` | — | — | The native-module bridge. There is no bridge here; this layer renders in-process onto GTK. |
| `TurboModuleRegistry` | — | — | The TurboModule lookup. Same reason as NativeModules. |
| `NativeComponentRegistry` | — | — | Fabric component registration. The host owns widget creation. |
| `requireNativeComponent` | — | — | Looks up a native view manager. Write a GTK widget descriptor instead. |
| `codegenNativeComponent` | — | — | React Native codegen for Fabric components. |
| `codegenNativeCommands` | — | — | React Native codegen for Fabric commands. |
| `UIManager` | — | — | The legacy view-manager surface. The GTK host is the view manager here. |
| `findNodeHandle` | — | — | Returns a native view tag. A ref here is the Gtk.Widget itself, which is more useful. |
| `registerCallableModule` | — | — | Registers a module callable from the native side. There is no native side. |
| `Networking` | — | — | React Native’s XHR internals. Use fetch, which gjsify provides. |
| `NativeDialogManagerAndroid` | — | — | An Android dialog native module. Alert is the portable spelling. |
| `Touchable` | — | — | The legacy mixin behind the Touchable family, not a public component. |
| `NativeAppEventEmitter` | — | — | The legacy iOS app-event emitter. |
| `RootTagContext` | — | — | A React Native surface identifier. This layer has one root per Adw window. |

<!-- END generated support table -->

### Routing surface

<!-- BEGIN generated router support table -->

### Supported, with named limits (5)

| export | tier | GTK | why |
|---|---|---|---|
| `router` | P1 | Adw.NavigationView (push/pop) via React Navigation’s StackActions | push, back, replace and navigate — the four methods the measured application calls, 19 of the 27 calls being push. |
| `useLocalSearchParams` | P1 | — | The current route’s params — the [param] values and the query string — read through React Navigation’s own useRoute(). |
| `usePathname` | P1 | — | The current URL without its query string, from React Navigation’s getPathFromState over the published root state. |
| `Stack` | P1 | Adw.NavigationView + Adw.NavigationPage | The stack navigator: React declares which pages exist, the widget owns their order, and the route key is the tag that joins the two. |
| `Tabs` | P1 | Adw.ViewStack + Adw.ViewSwitcher | The tab navigator. The switcher is driven by the stack’s own page model, so a route file adds a button with no tab-bar bookkeeping. |

### Planned (13)

| export | tier | GTK | why |
|---|---|---|---|
| `Link` | P2 | Gtk.Button (flat) or Gtk.LinkButton | An href as an element rather than a call. Cheap once `router` exists, and the honest widget question — button or link — is worth measuring first. |
| `Redirect` | P2 | — | A declarative navigate-on-render. It needs a rule for what happens when it redirects during the first commit, which is the commit that must not be empty. |
| `Slot` | P2 | Adw.Bin | A layout that renders its child route with no navigator around it. It is the one layout shape that has no widget of its own. |
| `useRouter` | P2 | — | The hook form of `router`. Identical behaviour, and it exists so a test can substitute the object — which is worth having once there is something to substitute. |
| `useSegments` | P2 | — | The current route split into segments. Derivable from the published root state, and unused in the measured application. |
| `useGlobalSearchParams` | P2 | — | The params of the focused route anywhere in the tree, rather than of the calling screen. It re-renders on every navigation by design, which is why expo-router documents preferring the local form. |
| `useNavigation` | P2 | — | React Navigation’s own hook, re-exported by expo-router. It works already through @react-navigation/core; exporting it from here is a decision about what this surface promises, not a build. |
| `useFocusEffect` | P2 | — | As useNavigation: it is core’s, and it works. The open question is the same one. |
| `useRootNavigationState` | P3 | — | The root state as a hook. The store `usePathname` reads is already there; this is a second selector over it. |
| `Drawer` | P3 | Adw.OverlaySplitView | A sidebar navigator. The pattern survives on a desktop better than it does on a phone, and Adwaita has the exact widget — it is a third navigator, not a variation on these two. |
| `withLayoutContext` | P3 | — | The escape hatch that lets a third-party navigator take its screens from the file tree. It is exactly `useRouteNode` plus screen synthesis, made public — worth doing once a third navigator exists to prove the shape. |
| `Navigator` | P3 | — | expo-router’s low-level navigator primitive. It belongs with withLayoutContext and for the same reason. |
| `ErrorBoundary` | P3 | Adw.StatusPage | A per-route error screen. React 19 routes an uncaught error to the root’s handler and @gjsify/gtk-host/react rethrows it from render() — deliberately, so a refusal is not swallowed — and a boundary here has to be reconciled with that rather than bolted beside it. |

### Refused (4)

| export | tier | GTK | why |
|---|---|---|---|
| `ExpoRoot` | — | — | It takes a Metro `require.context`, which does not exist in this build chain. `RouterRoot` takes the manifest a bundler plugin emits instead — the same job, with the one input that is available. |
| `useUnstableGlobalHref` | — | — | Unstable by its own name, and it answers the question usePathname already answers for the only surface this layer has. |
| `useNavigationContainerRef` | — | — | The container ref is this layer’s own (one process routes one tree), and handing it out would let a consumer dispatch around the refusals `router` exists to give. |
| `SplashScreen` | — | — | A native splash screen belongs to a phone launcher. A GTK application maps its window when it is ready, which is the desktop equivalent and is Gio.Application’s job, not the router’s. |

<!-- END generated router support table -->
