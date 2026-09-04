// `@gjsify/react-native` — the React Native view vocabulary, rendered onto GTK4.
//
// The package a consumer's bundler aliases `react-native` to. Its export surface
// therefore mirrors React Native's own, name for name: 92 of them, every one
// carrying a status in `support-table.ts` (ADR 0032 § 8). What is implemented is
// exported normally; what is not is exported as a value that refuses with the
// table's own sentence, so a reader gets a reason rather than a `MISSING_EXPORT`.
//
// The build-time half of that promise is the bundler gate, which knows the file and
// the line and refuses before anything runs. This module is the runtime backstop for
// what a gate cannot see.

// `lastWindowChromeProblems` is on the ROOT surface and not only inside the module,
// because ADR 0043's amendment publishes it and the frameworks page tells a consumer to
// assert it — a reader nothing can import answers nobody.
export { AppRegistry, lastWindowChromeProblems, registerRootComponent } from './app-registry.js';
export type { ComponentProvider, RunApplicationOptions } from './app-registry.js';

export { EventEmitter } from './event-emitter.js';
export type { EventSubscription } from './event-emitter.js';

// The components — ADR 0032 § 1's L3, thin React wrappers over the
// framework-agnostic descriptors in `./primitives`.
export {
    ActivityIndicator,
    Button,
    Image,
    ImageBackground,
    KeyboardAvoidingView,
    Modal,
    Pressable,
    SafeAreaView,
    ScrollView,
    StatusBar,
    Switch,
    Text,
    TextInput,
    TouchableHighlight,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from './components.js';
export type {
    ActivityIndicatorProps,
    ButtonProps,
    CommonProps,
    ImageBackgroundProps,
    ImageProps,
    ImageURISource,
    KeyboardAvoidingViewProps,
    ModalProps,
    PressableProps,
    PressableState,
    ScrollViewProps,
    StatusBarProps,
    SwitchProps,
    TextInputProps,
    TextProps,
    TouchableHighlightProps,
    TouchableProps,
    TouchableWithoutFeedbackProps,
    ViewProps,
} from './components.js';

// The list family. One component under four names (ADR 0032: the useful subset of
// `VirtualizedList` is what backs `FlatList`), and the only one in the surface that
// owns its widget rather than being an element — `lists/controller.ts` says why, with
// the measurements.
export { FlatList, SectionList, VirtualizedList, VirtualizedSectionList } from './lists/components.js';
export type {
    FlatListProps,
    ListRenderItemInfo,
    ListSeparators,
    ListSlot,
    SectionListProps,
    SectionListSection,
    VirtualizedListProps,
} from './lists/components.js';

// The imperative APIs. `useColorScheme` and `useWindowDimensions` are hooks and live
// with the hooks; the rest are plain objects over `gi://`.
export { Alert, Appearance, Dimensions, Keyboard, Linking, Platform, Share } from './apis/index.js';
export type {
    AlertButton,
    AlertOptions,
    AppearancePreferences,
    ColorSchemeName,
    DimensionKey,
    DimensionsPayload,
    DisplayMetrics,
    PlatformOS,
    PlatformSelectSpec,
    ShareAction,
    ShareContent,
} from './apis/index.js';
export { useColorScheme, useWindowDimensions } from './hooks.js';

// `Animated` and `Easing`. The subset ADR 0032 measured — a value, a timing and a
// view — over `Adw.TimedAnimation`, with every other member of `Animated` present
// as functions that refuse with their own reason. `animated/value.ts` records why the
// VALUE and not the widget property is the source of truth, and `animated/easing.ts`
// carries the measured curve-by-curve mapping onto `AdwEasing`.
export { Animated, Easing } from './animated/index.js';
export type { CompositeAnimation, EasingFunction, EndCallback, TimingConfig } from './animated/index.js';

// `StyleSheet`, whose `create` is identity and whose `hairlineWidth` is a getter —
// `stylesheet.ts` says why both are the honest answer rather than a shortcut.
export { StyleSheet } from './stylesheet.js';
export type { NamedStyles } from './stylesheet.js';

// NOT React Native names, and part of the surface anyway: a project's token scales
// have to arrive from somewhere (ADR 0032 § 3 — the class families are declared here,
// the values belong to the project), and there is no React Native prop or API that
// carries them. `check-rn-surface.mjs` holds the SUPPORT TABLE's key set against
// react-native's exports, not this module's, so an addition here widens the package
// without weakening that gate.
//
// THE BUILD GATE STILL HAD TO LEARN THEM. This file is the derivation's SOURCE:
// `generated/own-exports.ts` is every value exported here that no support table
// judges, and `isImportable` reads it, so `--dialect react-native` stops refusing the
// three names below. Add an export and run `gjsify workspace @gjsify/react-native run
// generate`; forget to, and `check-rn-surface.mjs` and `support-table.spec.ts` both
// say so.
export { configureStyle, resetStyleConfig, styleConfig } from './style-config.js';
export type { StyleConfig } from './style-config.js';

// L2, so a non-React binding can render the same vocabulary without going through
// the components above. This is the seam ADR 0032 § 1 exists to keep open, and
// exporting it is what makes "L2 is below the framework" checkable from outside.
export * as primitives from './primitives/index.js';
export { PrimitiveError } from './primitives/errors.js';
export type { TextInputHandle } from './primitives/handles.js';

/**
 * React 19 batches every update on its own, so this is the identity call it already
 * is upstream — kept because application code and libraries still wrap in it, and an
 * absent export would refuse something that costs nothing to honour.
 */
export function unstable_batchedUpdates<T, R>(callback: (argument: T) => R, argument: T): R {
    return callback(argument);
}

// Everything this layer does not answer for yet. Generated from the support table
// (`scripts/generate-exports.mjs`), because a bundler needs static export names to
// resolve an import at all and a loop cannot produce them.
export * from './generated/unsupported-react-native.js';

// The table itself is public: a consumer building their own tooling — a lint rule, a
// dashboard, a migration script — should read the same data the gate reads rather
// than scrape the README that was generated from it.
export {
    OWN_EXPORT_NAMES,
    SUPPORT_TABLE,
    SUPPORTED_NAMES,
    explainUnsupported,
    isImportable,
    isOwnExport,
    type SupportEntry,
    type SupportStatus,
    type SupportTier,
} from './support-table.js';

// The PROP surface, for the same reason and one level down. `support-table` answers
// "may this application IMPORT this name"; nothing answered "does this primitive take
// this prop" without RENDERING — and a refused prop is a render-time throw, which
// with no error boundary above it ends the whole React tree (the measurement is in
// `prop-table.ts`). `@gjsify/react-native/prop-table` is its own subpath, exactly as
// the gate's table is, so a consumer's build-time test imports the answers without
// pulling GTK; these re-exports keep the root module able to answer for itself.
export {
    PRIMITIVE_VARIANTS,
    acceptsProp,
    explainProp,
    propAnswer,
    propNames,
    propTable,
    type PropAnswer,
    type PropStatus,
    type PropVariant,
} from './prop-table.js';

export { UnsupportedError } from './unsupported.js';
