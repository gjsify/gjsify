// What this layer answers for, and what it refuses — the one source three
// readers share.
//
// ADR 0032 § 8. The bundler gate fails a build on an import that is not
// `supported` or `partial`; the runtime throws the same reason for anything that
// reaches it dynamically; the README section is GENERATED from this file. A
// hand-maintained support table beside it is the second truth this repository has
// already collected several times.
//
// PROVENANCE OF THE KEY SET. The 92 names are `react-native`'s own public exports
// — the getters on `module.exports` in its `index.js`, read from the installed
// package rather than from documentation. `scripts/check-rn-surface.mjs` re-reads
// them and fails if the installed React Native gained or lost one, so a version
// bump cannot quietly widen the surface this table claims to cover.
//
// WHY EVERY NAME IS PRESENT, INCLUDING THE ONES WE WILL NEVER BUILD. An absent key
// is indistinguishable from an unknown one, and the gate would have to guess. A
// name that is here with `refused` produces a sentence; a name that is missing
// produces a shrug.

/** What this layer does about a React Native export. */
export type SupportStatus =
    /** Implemented. */
    | 'supported'
    /** Implemented with named limits — `limits` lists them. */
    | 'partial'
    /** On the map, not built yet. `tier` says how soon. */
    | 'planned'
    /** Will not be built, and there is a decision behind it. */
    | 'refused'
    /** Exists so an import resolves; does nothing, because a desktop window has no such concept. */
    | 'no-desktop-meaning'
    /** Cannot be built in this toolchain at all — not a scheduling statement. */
    | 'not-reachable';

/** Priority tiers, as ADR 0032 records them. */
export type SupportTier = 'P1' | 'P2' | 'P3';

export interface SupportEntry {
    readonly status: SupportStatus;
    /** Absent for `refused` / `not-reachable`, which are not scheduled at all. */
    readonly tier?: SupportTier;
    /** The GTK or Adwaita counterpart, where there is one. */
    readonly gtk?: string;
    /** One line. It is what the build error and the README both print. */
    readonly reason: string;
    /** For `partial`: what it does not do. */
    readonly limits?: readonly string[];
}

export const SUPPORT_TABLE: Readonly<Record<string, SupportEntry>> = {
    // --- P1: the twelve names a measured application actually imports ---------

    View: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Box, or Gtk.Overlay when a child is absolutely positioned',
        reason: 'The container primitive. Which widget it becomes depends on its children, not on the element.',
        limits: [
            'An absolutely positioned child is placed by alignment plus a margin, because Gtk.Overlay positions an overlay child by its halign/valign and has no coordinate pair. An offset on only ONE edge of an axis therefore leaves the other axis at GTK’s default (fill), where React Native would keep the child at its static position — a position GTK has no way to express for an overlay child.',
            'onLayout is refused: GTK reports allocation through Gtk.Widget.vfunc_size_allocate, a subclass override rather than a signal.',
            'pointerEvents answers auto and none only. box-none and box-only split hit-testing between a widget and its subtree, and Gtk.Widget:can-target is one boolean for both.',
        ],
    },
    Text: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Label',
        reason: 'Wrapping is ON by default in React Native and OFF on a Gtk.Label, so the default is set explicitly.',
        limits: [
            'A nested <Text> is refused by the host naming the tag: Gtk.Label takes no children (measured), so React Native’s inline-styling idiom has no counterpart. Use Pango markup through a ref, or separate labels.',
            'ellipsizeMode="clip" is refused: PangoEllipsizeMode is NONE, START, MIDDLE, END (measured) and has no clip member, so honouring it would add an ellipsis the author asked not to have.',
            'onPress is refused: a Gtk.Label emits no clicked signal (measured). Wrap it in a <Pressable>.',
        ],
    },
    Pressable: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Button (flat)',
        reason: 'Press state is a GTK CSS :active pseudo-class; children-as-a-function is P2.',
        limits: [
            'children-as-a-function-of-{ pressed } is a named refusal, at build time through the prop type and at runtime through a throw (ADR 0032 § 7). Write active:* instead — GTK animates :active itself with no re-render.',
            'onPressIn/onPressOut are refused for the same reason: the press state never reaches the reconciler.',
            'onLongPress is refused: a long press is a Gtk.GestureLongPress controller added to the widget, not a property or a signal on it.',
            'hitSlop is refused: GTK hit-tests the allocation and cannot grow it past the widget. Pad the button instead, which enlarges the real target.',
        ],
    },
    ScrollView: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.ScrolledWindow + an implicit content box',
        reason: 'contentContainerStyle styles the inner box, which is a second styleable node.',
        limits: [
            'onScroll and scrollEventThrottle are refused: GTK reports scroll position as notify::value on the Gtk.Adjustment behind hadjustment/vadjustment, an object rather than a signal on the scrolled window. Reach the adjustment through a ref.',
            'scrollEnabled is refused: a Gtk.ScrolledWindow has no switch that stops scrolling, and setting both policies to never clamps the child as well as hiding the bars.',
            'refreshControl is refused, matching RefreshControl’s own entry: GTK has no pull-to-refresh idiom.',
            'Layout utilities that need a box (items-*, gap-*, justify-*) are refused on style and belong on contentContainerStyle — which is React Native’s own rule, not a GTK one.',
        ],
    },
    ActivityIndicator: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Adw.Spinner',
        reason: 'Direct counterpart.',
        limits: [
            'animating={false} hides the widget. MEASURED: Adw.Spinner installs 36 properties and every one is Gtk.Widget’s — there is nothing that stops it while it is on screen, so "not animating" is "not shown". That is also exactly what hidesWhenStopped asks for, which is why hidesWhenStopped is a declared no-op.',
            'size="small"/"large" are 16 and 32 px — Gtk.IconSize’s own two steps — not React Native’s 20/36, which are Android dp and land between GTK’s steps. A numeric size is used verbatim.',
        ],
    },
    TextInput: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Entry / Gtk.TextView',
        reason: 'Single- versus multi-line is one prop in React Native and two different widgets in GTK.',
        limits: [
            'multiline={true} is a Gtk.TextView, whose content lives in a Gtk.TextBuffer rather than in a property — MEASURED: 61 properties, no text. So value, defaultValue and onChangeText are refused by name on a multiline input, as are placeholder, maxLength and secureTextEntry, none of which Gtk.TextView installs. Single-line is complete.',
            'onFocus/onBlur are refused: focus arrives through a Gtk.EventControllerFocus, a controller rather than a signal on the widget.',
            'autoFocus is refused: Gtk.Widget.grab_focus() only works once the widget is mapped, which is a moment this layer does not own. Call it from a ref in an effect.',
            'keyboardType maps onto Gtk.Entry:input-purpose; returnKeyType, autoCapitalize, autoCorrect and keyboardAppearance are declared no-ops, because they describe an on-screen keyboard.',
        ],
    },
    Linking: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.UriLauncher',
        reason: 'openURL and canOpenURL only.',
        limits: [
            'openURL asks can_launch FIRST and rejects when the answer is no. MEASURED: Gtk.UriLauncher.launch never calls back for a scheme with no handler (3 000 ms, no callback, exit 0), and a promise that never settles is worse than a rejection.',
            'getInitialURL always resolves null. A desktop deep link arrives as Gio.Application::open AFTER startup, so there is no value to read before it — which is also what React Native returns for a normal launch.',
            'addEventListener/addListener are refused: URL delivery is the application object’s own wiring (HANDLES_OPEN plus the open signal), above this layer.',
            'openSettings and sendIntent are refused: a per-app settings page and an Android Intent have no desktop counterpart.',
        ],
    },
    Switch: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Switch',
        reason: 'Direct counterpart.',
        limits: [
            'onValueChange binds notify::active, not state-set: state-set runs BEFORE the state changes and must return false to let the default handler proceed, and a handler that forgets makes the switch stick at exit 0.',
            'trackColor and thumbColor are refused: Adwaita paints the switch from the theme accent and its track is a CSS subnode, not a property. Style it from the application stylesheet.',
        ],
    },
    Platform: {
        status: 'partial',
        tier: 'P1',
        reason: 'OS is "linux" | "macos" | "windows"; select() picks the default branch.',
        limits: [
            'OS reports "linux", which is not a member of React Native’s own PlatformOSType. Reporting "macos" on a Linux desktop would be a lie select() cannot recover from, and "web" implies a DOM.',
            'select() does NOT consult a native branch, for ADR 0032 § 9’s reason: a native branch is written for a React Native runtime, and handing it to a GTK build is a failure that surfaces in a window. A spec with neither this OS nor default is a named refusal rather than undefined.',
            'Version throws by name: it is a mobile OS version and a desktop has no counterpart meaning the same thing.',
            'constants throws by name: it is the native bridge’s constants object, and there is no bridge here.',
        ],
    },
    Modal: {
        status: 'planned',
        tier: 'P1',
        gtk: 'Adw.Dialog',
        reason: 'An Adw.Dialog cannot be an ordinary element. MEASURED on libadwaita 1.10: box.append(dialog) calls g_error() — SIGABRT and a core dump, not a catchable exception — but ONLY when the box is rooted in a window. A detached box accepts the append in silence, so a re-test on a bare box appears to disprove this and puts the primitive back. A dialog is PRESENTED against a parent, never parented by it, so this is a PORTAL and needs a host seam that does not exist yet.',
    },
    useColorScheme: {
        status: 'supported',
        tier: 'P1',
        gtk: 'Adw.StyleManager.dark',
        reason: 'Follows the Adwaita colour scheme — the dark property, which is what the user is looking at, not color-scheme, which is what the application asked for.',
    },
    Share: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gdk.Clipboard',
        reason: 'No desktop share sheet worth pretending about; copying the link is the honest mapping.',
        limits: [
            'action is always sharedAction. dismissedAction means the user closed a share sheet without choosing, and nothing here asks the user anything — reporting a dismissal would be inventing an event. The constant is still exported, so a comparison against it resolves instead of failing to import.',
            'activityType is always undefined: there is no activity to name.',
            'Gtk.UriLauncher is NOT used here, although the planning entry named it. Launching a URI OPENS it in another application, which is a share sheet’s behavioural inverse — that call is Linking.openURL’s, and it is there.',
        ],
    },
    AppRegistry: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Adw.Application + Adw.ApplicationWindow',
        reason: 'The entry point. Nothing renders without a window, so this is P1 despite being a shim.',
        limits: [
            'runApplication takes gjsify options (applicationId is required) rather than React Native’s { rootTag, initialProps } — a phone host supplies the application identity, a desktop one IS the application.',
            'unmountApplicationComponentAtRootTag throws: there is no root tag to address.',
        ],
    },
    StyleSheet: {
        status: 'planned',
        tier: 'P1',
        reason: 'create/flatten/hairlineWidth/absoluteFill. Style objects go through the same partition as classes.',
    },

    // --- P2: absent from one measured application, standard in most -----------

    FlatList: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.ListView + Gio.ListStore',
        reason: 'GTK virtualises for real, so this fits better here than it does on the web.',
    },
    SectionList: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.ListView + a section model',
        reason: 'Sections map onto GTK section models.',
    },
    VirtualizedList: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.ListView',
        reason: 'Its public surface is wide and mostly not worth honouring literally; the useful subset backs FlatList.',
    },
    VirtualizedSectionList: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.ListView',
        reason: 'The section-shaped sibling of VirtualizedList.',
    },
    Image: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Picture / Gdk.Texture',
        reason: 'resizeMode becomes content-fit.',
    },
    ImageBackground: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Picture in a Gtk.Overlay',
        reason: 'A picture with children over it.',
    },
    TouchableOpacity: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Button (flat)',
        reason: 'The same machinery as Pressable, and nearly free once it exists.',
    },
    TouchableHighlight: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Button (flat)',
        reason: 'As TouchableOpacity, with a different pressed style.',
    },
    TouchableWithoutFeedback: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.GestureClick',
        reason: 'A gesture controller on the child, with no button chrome.',
    },
    Button: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Button',
        reason: 'The one component whose React Native styling story is "you cannot", which GTK agrees with.',
    },
    Dimensions: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gdk.Surface',
        reason: 'Window size, not screen size — a desktop app is not full-screen.',
    },
    useWindowDimensions: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gdk.Surface',
        reason: 'The hook form of Dimensions, re-rendering on resize.',
    },
    Alert: { status: 'planned', tier: 'P2', gtk: 'Adw.AlertDialog', reason: 'Direct counterpart.' },
    Appearance: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Adw.StyleManager',
        reason: 'The imperative sibling of useColorScheme.',
    },
    SafeAreaView: {
        status: 'no-desktop-meaning',
        tier: 'P2',
        reason: 'Insets are zero on a desktop window, but it has to exist to be imported.',
    },
    StatusBar: { status: 'no-desktop-meaning', tier: 'P2', reason: 'A desktop window has no status bar to configure.' },
    KeyboardAvoidingView: {
        status: 'no-desktop-meaning',
        tier: 'P2',
        reason: 'No on-screen keyboard eats a desktop window layout.',
    },
    Keyboard: {
        status: 'no-desktop-meaning',
        tier: 'P2',
        reason: 'Its events are on-screen-keyboard events, which do not occur.',
    },
    RefreshControl: {
        status: 'refused',
        reason: 'GTK has no pull-to-refresh idiom and should not grow one. Give the desktop build a refresh action instead.',
    },
    AppState: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.Application / Gdk.Surface state',
        reason: 'active/background from window focus and visibility.',
    },
    PixelRatio: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gdk.Surface.scale-factor',
        reason: 'The scale factor of the surface the widget is on.',
    },
    PlatformColor: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adwaita named colours',
        reason: 'Maps unusually well — GTK’s palette is exactly this idea.',
    },

    // --- P3: the long tail ----------------------------------------------------

    AccessibilityInfo: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.Accessible / AT-SPI',
        reason: 'The highest-value P3 entry: GTK’s accessibility model is strong and the props map onto it well.',
    },
    Animated: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adw.TimedAnimation / Adw.SpringAnimation',
        reason: 'Genuinely mappable, but it is a subsystem rather than a component. Doing it badly is worse than not doing it.',
    },
    Easing: { status: 'planned', tier: 'P3', reason: 'Pure maths; it lands with Animated or not at all.' },
    LayoutAnimation: {
        status: 'planned',
        tier: 'P3',
        reason: 'Needs an animated layout pass, which is the same subsystem as Animated.',
    },
    InteractionManager: {
        status: 'planned',
        tier: 'P3',
        reason: 'Deferring work until interactions settle; a main-loop idle source is the counterpart.',
    },
    useAnimatedValue: { status: 'planned', tier: 'P3', reason: 'Part of the Animated subsystem.' },
    useAnimatedValueXY: { status: 'planned', tier: 'P3', reason: 'Part of the Animated subsystem.' },
    useAnimatedColor: { status: 'planned', tier: 'P3', reason: 'Part of the Animated subsystem.' },
    PanResponder: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.Gesture* controllers',
        reason: 'The controllers exist; the arbitration model is not React Native’s, so this is its own project.',
    },
    usePressability: {
        status: 'planned',
        tier: 'P3',
        reason: 'The hook behind the Touchable family; it lands with the gesture work.',
    },
    DrawerLayoutAndroid: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adw.OverlaySplitView',
        reason: 'The pattern survives on a desktop even though the component is Android-only.',
    },
    I18nManager: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.Widget.direction',
        reason: 'RTL is a widget-direction question on GTK.',
    },
    LogBox: {
        status: 'no-desktop-meaning',
        tier: 'P3',
        reason: 'A development overlay for a phone; the console is the desktop equivalent.',
    },
    Systrace: { status: 'no-desktop-meaning', reason: 'Android systrace has no desktop counterpart.' },
    Vibration: { status: 'no-desktop-meaning', reason: 'A desktop machine does not vibrate.' },
    ToastAndroid: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adw.Toast',
        reason: 'Android-only by name, and Adwaita has the exact widget.',
    },
    InputAccessoryView: {
        status: 'no-desktop-meaning',
        reason: 'An iOS keyboard accessory bar; there is no keyboard to accessorise.',
    },
    TouchableNativeFeedback: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.Button',
        reason: 'Android-only ripple; shimmed to its portable sibling.',
    },
    ActionSheetIOS: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adw.AlertDialog with responses',
        reason: 'iOS-only by name; the pattern is a dialog with choices.',
    },
    PushNotificationIOS: {
        status: 'refused',
        reason: 'Platform notification plumbing. A desktop app uses Gio.Notification directly.',
    },
    PermissionsAndroid: {
        status: 'refused',
        reason: 'Android runtime permissions have no desktop counterpart; portals are asked for at use time.',
    },
    Settings: {
        status: 'refused',
        reason: 'An iOS user-defaults bridge. GSettings is the desktop answer and is not this API.',
    },
    Clipboard: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gdk.Clipboard',
        reason: 'Deprecated upstream in favour of a community package, but trivial here.',
    },
    BackHandler: {
        status: 'planned',
        tier: 'P3',
        reason: 'An Android hardware back button. Maps to the navigation view’s own back, so it lands with routing.',
    },
    DynamicColorIOS: {
        status: 'planned',
        tier: 'P3',
        reason: 'A light/dark colour pair; the Adwaita scheme already provides the switch.',
    },
    processColor: {
        status: 'planned',
        tier: 'P3',
        reason: 'Colour string to a platform value; a Gdk.RGBA on this side.',
    },
    UTFSequence: {
        status: 'planned',
        tier: 'P3',
        reason: 'A table of unicode constants. Pure data, no platform in it.',
    },
    experimental_LayoutConformance: {
        status: 'refused',
        reason: 'An experimental switch between two React Native layout implementations. Neither is used here.',
    },
    unstable_VirtualView: { status: 'refused', reason: 'Unstable React Native internal.' },
    VirtualViewMode: { status: 'refused', reason: 'Unstable React Native internal.' },
    unstable_NativeText: { status: 'refused', reason: 'Unstable React Native internal.' },
    unstable_NativeView: { status: 'refused', reason: 'Unstable React Native internal.' },
    unstable_TextAncestorContext: { status: 'refused', reason: 'Unstable React Native internal.' },
    ReactNativeVersion: {
        status: 'planned',
        tier: 'P3',
        reason: 'The version this layer targets, reported honestly rather than spoofed.',
    },
    DeviceInfo: { status: 'refused', reason: 'A native module surface describing a phone.' },
    DevMenu: { status: 'no-desktop-meaning', reason: 'The shake-to-open developer menu.' },
    DevSettings: { status: 'no-desktop-meaning', reason: 'Development-client settings for a phone runtime.' },

    // --- refused because they are the native bridge itself --------------------
    //
    // These are not components; they are how React Native talks to Java and
    // Objective-C. There is no bridge here — this layer renders onto GTK in the
    // same process. A shim answering them would be lying about a native module
    // being present, and the failure would surface as a call into `undefined`
    // rather than as an import that did not resolve.

    NativeModules: {
        status: 'refused',
        reason: 'The native-module bridge. There is no bridge here; this layer renders in-process onto GTK.',
    },
    TurboModuleRegistry: { status: 'refused', reason: 'The TurboModule lookup. Same reason as NativeModules.' },
    NativeComponentRegistry: {
        status: 'refused',
        reason: 'Fabric component registration. The host owns widget creation.',
    },
    requireNativeComponent: {
        status: 'refused',
        reason: 'Looks up a native view manager. Write a GTK widget descriptor instead.',
    },
    codegenNativeComponent: { status: 'refused', reason: 'React Native codegen for Fabric components.' },
    codegenNativeCommands: { status: 'refused', reason: 'React Native codegen for Fabric commands.' },
    UIManager: { status: 'refused', reason: 'The legacy view-manager surface. The GTK host is the view manager here.' },
    findNodeHandle: {
        status: 'refused',
        reason: 'Returns a native view tag. A ref here is the Gtk.Widget itself, which is more useful.',
    },
    registerCallableModule: {
        status: 'refused',
        reason: 'Registers a module callable from the native side. There is no native side.',
    },
    Networking: { status: 'refused', reason: 'React Native’s XHR internals. Use fetch, which gjsify provides.' },
    NativeDialogManagerAndroid: {
        status: 'refused',
        reason: 'An Android dialog native module. Alert is the portable spelling.',
    },
    ProgressBarAndroid: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.ProgressBar',
        reason: 'Android-only by name; GTK has the widget.',
    },
    Touchable: { status: 'refused', reason: 'The legacy mixin behind the Touchable family, not a public component.' },

    // --- event emitters -------------------------------------------------------
    //
    // Plain JavaScript, and they work today because nothing in them is native.
    // Listed as supported rather than omitted, because "it happens to work" and
    // "we answer for it" are different promises.

    EventEmitter: { status: 'supported', reason: 'Pure JavaScript; nothing in it touches a platform.' },
    NativeEventEmitter: {
        status: 'planned',
        tier: 'P3',
        reason: 'It would construct and subscribe, but nothing native would ever emit into it — shipping that needs a decision, not a class.',
    },
    DeviceEventEmitter: {
        status: 'planned',
        tier: 'P3',
        reason: 'The global emitter. Lands with NativeEventEmitter, and for the same reason.',
    },
    NativeAppEventEmitter: { status: 'refused', reason: 'The legacy iOS app-event emitter.' },
    RootTagContext: {
        status: 'refused',
        reason: 'A React Native surface identifier. This layer has one root per Adw window.',
    },
    unstable_batchedUpdates: {
        status: 'supported',
        reason: 'React 19 batches automatically; this is the identity call it already is upstream.',
    },

    // --- not reachable in this toolchain -------------------------------------

    // Nothing in `react-native`'s own export list is worklet-based, but the
    // libraries that are (`react-native-reanimated`, `react-native-gesture-handler`)
    // are the reason this status exists: they need a Babel transform that is not in
    // this build chain, so they are not a scheduling question. Recorded here rather
    // than only in the ADR, because this file is what a consumer reads.
};

/** Every name `react-native` publicly exports, as this table claims to cover it. */
export const SUPPORTED_NAMES: readonly string[] = Object.keys(SUPPORT_TABLE);

/** Statuses a build may import. Everything else is a named refusal. */
const IMPORTABLE: ReadonlySet<SupportStatus> = new Set<SupportStatus>(['supported', 'partial']);

export const isImportable = (name: string): boolean => {
    const entry = SUPPORT_TABLE[name];
    return entry !== undefined && IMPORTABLE.has(entry.status);
};

/**
 * The sentence a build error and a runtime throw both print.
 *
 * One function so the two cannot drift into describing the same gap differently —
 * which is the whole reason the table is data rather than prose in two places.
 */
export function explainUnsupported(name: string): string {
    const entry = SUPPORT_TABLE[name];
    if (entry === undefined) {
        return (
            `@gjsify/react-native: "${name}" is not a React Native export this layer knows about. ` +
            `If the installed react-native really exports it, the support table is out of date — ` +
            `run scripts/check-rn-surface.mjs, which compares the two.`
        );
    }
    const where = entry.tier ? ` (tier ${entry.tier})` : '';
    const gtk = entry.gtk ? ` The GTK counterpart is ${entry.gtk}.` : '';
    switch (entry.status) {
        case 'supported':
        case 'partial':
            return `@gjsify/react-native: "${name}" is available.`;
        case 'planned':
            return `@gjsify/react-native: "${name}" is not implemented yet${where}. ${entry.reason}${gtk}`;
        case 'refused':
            return `@gjsify/react-native: "${name}" will not be implemented. ${entry.reason}`;
        case 'no-desktop-meaning':
            return `@gjsify/react-native: "${name}" has no meaning on a desktop window${where}. ${entry.reason}`;
        case 'not-reachable':
            return `@gjsify/react-native: "${name}" cannot be implemented in this build chain. ${entry.reason}`;
    }
}
