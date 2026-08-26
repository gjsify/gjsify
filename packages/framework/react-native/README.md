# @gjsify/react-native

React Native's view vocabulary, rendered onto GTK4 and Adwaita.

This is the package a consumer's bundler aliases `react-native` to, so its export
surface mirrors React Native's own — all 92 public names. What is implemented is
exported normally; **what is not is exported as a value that refuses with a reason**,
because `MISSING_EXPORT` tells a reader the name is unknown while the support table
can tell them it is tier P2, maps onto `Gtk.ListView`, and is not built yet.

Architecture and the decisions behind it: [ADR 0032](../../../docs/adr/0032-react-native-on-the-gtk-host.md).

> **Status: early.** The three layers the ADR describes — the style partition, the
> primitive descriptors, and the components — are not built yet. What works today is
> the entry point and the mechanism that makes every gap loud. Read the table below
> before pointing an application at this.

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

## Support

<!-- BEGIN generated support table -->

### Supported (2)

| export | tier | GTK | why |
|---|---|---|---|
| `EventEmitter` | — | — | Pure JavaScript; nothing in it touches a platform. |
| `unstable_batchedUpdates` | — | — | React 19 batches automatically; this is the identity call it already is upstream. |

### Supported, with named limits (1)

| export | tier | GTK | why |
|---|---|---|---|
| `AppRegistry` | P1 | Adw.Application + Adw.ApplicationWindow | The entry point. Nothing renders without a window, so this is P1 despite being a shim. |

### Planned (54)

| export | tier | GTK | why |
|---|---|---|---|
| `View` | P1 | Gtk.Box, or Gtk.Overlay when a child is absolutely positioned | The container primitive. Which widget it becomes depends on its children, not on the element. |
| `Text` | P1 | Gtk.Label | Wrapping is ON by default in React Native and OFF on a Gtk.Label, so the default is set explicitly. |
| `Pressable` | P1 | Gtk.Button (flat) | Press state is a GTK CSS :active pseudo-class; children-as-a-function is P2. |
| `ScrollView` | P1 | Gtk.ScrolledWindow + an implicit content box | contentContainerStyle styles the inner box, which is a second styleable node. |
| `ActivityIndicator` | P1 | Adw.Spinner | Direct counterpart. |
| `TextInput` | P1 | Gtk.Entry / Gtk.TextView | Single- versus multi-line is one prop in React Native and two different widgets in GTK. |
| `Linking` | P1 | Gtk.UriLauncher | openURL and canOpenURL only. |
| `Switch` | P1 | Gtk.Switch | Direct counterpart. |
| `Platform` | P1 | — | OS is "linux" | "macos" | "windows"; select() picks the default branch. |
| `Modal` | P1 | Adw.Dialog | A dialog rather than a full-screen overlay, which is what a desktop expects. |
| `useColorScheme` | P1 | Adw.StyleManager.dark | Follows the Adwaita colour scheme. |
| `Share` | P1 | clipboard + Gtk.UriLauncher | No desktop share sheet worth pretending about; copying the link is the honest mapping. |
| `StyleSheet` | P1 | — | create/flatten/hairlineWidth/absoluteFill. Style objects go through the same partition as classes. |
| `FlatList` | P2 | Gtk.ListView + Gio.ListStore | GTK virtualises for real, so this fits better here than it does on the web. |
| `SectionList` | P2 | Gtk.ListView + a section model | Sections map onto GTK section models. |
| `VirtualizedList` | P2 | Gtk.ListView | Its public surface is wide and mostly not worth honouring literally; the useful subset backs FlatList. |
| `VirtualizedSectionList` | P2 | Gtk.ListView | The section-shaped sibling of VirtualizedList. |
| `Image` | P2 | Gtk.Picture / Gdk.Texture | resizeMode becomes content-fit. |
| `ImageBackground` | P2 | Gtk.Picture in a Gtk.Overlay | A picture with children over it. |
| `TouchableOpacity` | P2 | Gtk.Button (flat) | The same machinery as Pressable, and nearly free once it exists. |
| `TouchableHighlight` | P2 | Gtk.Button (flat) | As TouchableOpacity, with a different pressed style. |
| `TouchableWithoutFeedback` | P2 | Gtk.GestureClick | A gesture controller on the child, with no button chrome. |
| `Button` | P2 | Gtk.Button | The one component whose React Native styling story is "you cannot", which GTK agrees with. |
| `Dimensions` | P2 | Gdk.Surface | Window size, not screen size — a desktop app is not full-screen. |
| `useWindowDimensions` | P2 | Gdk.Surface | The hook form of Dimensions, re-rendering on resize. |
| `Alert` | P2 | Adw.AlertDialog | Direct counterpart. |
| `Appearance` | P2 | Adw.StyleManager | The imperative sibling of useColorScheme. |
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
| `BackHandler` | P3 | — | An Android hardware back button. Maps to the navigation view’s own back, so it lands with routing. |
| `DynamicColorIOS` | P3 | — | A light/dark colour pair; the Adwaita scheme already provides the switch. |
| `processColor` | P3 | — | Colour string to a platform value; a Gdk.RGBA on this side. |
| `UTFSequence` | P3 | — | A table of unicode constants. Pure data, no platform in it. |
| `ReactNativeVersion` | P3 | — | The version this layer targets, reported honestly rather than spoofed. |
| `ProgressBarAndroid` | P3 | Gtk.ProgressBar | Android-only by name; GTK has the widget. |
| `NativeEventEmitter` | P3 | — | It would construct and subscribe, but nothing native would ever emit into it — shipping that needs a decision, not a class. |
| `DeviceEventEmitter` | P3 | — | The global emitter. Lands with NativeEventEmitter, and for the same reason. |

### No meaning on a desktop window (10)

| export | tier | GTK | why |
|---|---|---|---|
| `SafeAreaView` | P2 | — | Insets are zero on a desktop window, but it has to exist to be imported. |
| `StatusBar` | P2 | — | A desktop window has no status bar to configure. |
| `KeyboardAvoidingView` | P2 | — | No on-screen keyboard eats a desktop window layout. |
| `Keyboard` | P2 | — | Its events are on-screen-keyboard events, which do not occur. |
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
