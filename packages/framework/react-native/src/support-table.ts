// What this layer answers for, and what it refuses — the one source three
// readers share.
//
// ADR 0032 § 8. The bundler gate fails a build on an import that is not
// `supported` or `partial`; the runtime throws the same reason for anything that
// reaches it dynamically; the README section is GENERATED from this file. A
// hand-maintained support table beside it is the second truth this repository has
// already collected several times.
//
// PROVENANCE OF THE KEY SET. The names are `react-native`'s own public exports —
// the getters on `module.exports` in its `index.js`, read from an installed copy
// rather than from documentation, and committed as `react-native-surface.json`.
// `scripts/check-rn-surface.mjs` compares this table against that snapshot on every
// run, which is what stops a name going missing here or being invented. It compares
// the SNAPSHOT against an installed `react-native` only when one is resolvable —
// and says which of the two modes it ran in, because with no `react-native` on disk
// an upstream version bump CAN widen the real surface with nothing here noticing.
// Claiming the stronger half unconditionally is how this comment read before.
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
    /**
     * When. Required on `planned` and `partial`, absent on `refused` and
     * `not-reachable` — neither is a schedule. Optional elsewhere: a `supported`
     * or `no-desktop-meaning` name was answered rather than scheduled, so the
     * converse ("not refused, therefore tiered") is measurably false and
     * `support-table.spec.ts` pins the narrower rule that holds.
     */
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
        reason: 'Press state is a GTK CSS :active pseudo-class; children-as-a-function is implemented over the state flag, and costs nothing when it is unused.',
        limits: [
            'children-as-a-function-of-{ pressed } reads the widget’s Gtk.StateFlags.ACTIVE through Gtk.Widget::state-flags-changed, because Gtk.Button installs no active property (measured). An element that does NOT use the function form subscribes to nothing — press styling written as active:* is CSS and never reaches the reconciler (ADR 0032 § 7), and pressWatchCount() is what holds the two apart.',
            'onPressIn/onPressOut are refused: they report the press as an EVENT, and the state flag reports it as a state. Use the function form, or active:*.',
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
        reason: 'An Adw.Dialog cannot be an ordinary element. MEASURED on libadwaita 1.9.3: box.append(dialog) calls g_error() — SIGABRT and a core dump, not a catchable exception — but ONLY when the box is rooted in a window. A detached box accepts the append in silence, so a re-test on a bare box appears to disprove this and puts the primitive back. A dialog is PRESENTED against a parent, never parented by it, so this is a PORTAL and needs a host seam that does not exist yet.',
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
        status: 'partial',
        tier: 'P1',
        gtk: 'Gdk.Monitor.scale for hairlineWidth',
        reason: 'create/flatten/compose/hairlineWidth/absoluteFill. Style objects go through the same partition as classes (ADR 0032 § 4), which is why create can be identity.',
        limits: [
            'create is IDENTITY, which is also what React Native’s own is now (it once registered styles and returned numeric ids). It cannot validate: half the vocabulary resolves against the parent (flex-1 is hexpand on a row and vexpand on a column), and create has no tree. The style object is validated where className is, at element resolution.',
            'hairlineWidth is a GETTER, not a constant: Gdk.Display.get_default() is null before Gtk.init() (measured) and real code reads this at module scope, so before the display exists it answers 1. It takes the SMALLEST monitor scale, because GTK4 has no primary monitor (measured — get_primary_monitor is gone) and a hairline that is sub-pixel on a monitor can vanish, while one that is a device pixel too thick cannot.',
            'setStyleAttributePreprocessor throws by name: it installs a process-wide transform on every style value, and configureStyle({ tokens }) is the scoped hook that already does that job.',
        ],
    },

    // --- P2: absent from one measured application, standard in most -----------

    FlatList: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.ListView + Gio.ListStore, owned by the component',
        reason: 'GTK virtualises for real. The list is NOT an ordinary element: a Gtk.ListView takes no children (measured — no append, add, insert, prepend, remove or set_child), so the component owns the view and drives the model from data, with React only inside the item factory.',
        limits: [
            'data, renderItem, keyExtractor, ListEmptyComponent, ListHeaderComponent, ListFooterComponent, horizontal and onEndReached are answered. Everything else on React Native’s list surface is refused BY NAME in the primitive table, most of it because it configures React Native’s own virtualisation and Gtk.ListView does that job itself.',
            'The header and footer are OUTSIDE the scroller, so they stay put while the rows scroll. Measured: putting them inside means wrapping the list in a Gtk.Box, which makes the scroller scroll a GtkViewport and allocates the list its whole content height (11 000 px for 500 rows) while it still realises only 205 of them — rows with no widget inside the allocated area.',
            'A row’s React tree is rendered on a microtask, not inside the bind. GTK binds a row the moment the view is rooted in a window (measured), which under React is inside a commit or an effect — where a nested root cannot flush and the host refuses by name. A microtask drains before GTK’s next frame, so no row is ever painted empty.',
            'A change to data replaces the model rows whose KEYS changed with one splice, which re-binds them; rows whose keys did not change are re-rendered in place instead, because GTK does not re-bind a row whose model object is unchanged (measured: items_changed over the same object does nothing).',
            'onEndReached is bound to the scroller’s own Gtk.Adjustment (notify::value / upper / page-size) and fires once per arrival at the end. A list with nothing to scroll never fires, which is every list before it has been allocated.',
            'renderItem’s separators.highlight/unhighlight/updateProps throw by name: a Gtk.ListView has no separator widget to restyle.',
        ],
    },
    SectionList: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.ListView + one flattened Gio.ListStore',
        reason: 'The same component as FlatList, handed sections instead of data.',
        limits: [
            'Every FlatList limit applies.',
            'The sections are FLATTENED into one model with header ROWS, so a header scrolls with its section. GTK’s own sticky headers do exist — measured: Gtk.SectionModel is present, Gtk.FlattenListModel and every selection model implement it (Gio.ListStore and Gtk.StringList do not), Gtk.ListView.set_header_factory is there, and a flatten model over two stores answered get_section(0) = [0, 2] — and they are not used, because that route needs a second factory, a model of models, and Gtk.ListHeader’s start/end/n-items reconciled with React Native’s section object. stickySectionHeadersEnabled is therefore refused by name rather than silently false.',
            'renderSectionFooter is not answered: a footer row would need the flattening to know where a section ends before the next one is read, which the header form does not.',
        ],
    },
    VirtualizedList: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.ListView',
        reason: 'Its public surface is wide and mostly not worth honouring literally; the useful subset backs FlatList, and this name is that subset plus getItem/getItemCount.',
        limits: [
            'Every FlatList limit applies.',
            'getItem(data, index) and getItemCount(data) are answered, which is the one thing this name adds over FlatList. The virtualisation knobs — initialNumToRender, maxToRenderPerBatch, windowSize, updateCellsBatchingPeriod, removeClippedSubviews, getItemLayout — are refused by name: Gtk.ListView creates and recycles rows itself and installs no property that changes the batching (measured: 205 of 500 rows in a 400×300 window).',
            'CellRendererComponent, debug, onLayout and the other internals of React Native’s own implementation are not answered at all — an unlisted prop is refused by name, which is the point.',
        ],
    },
    VirtualizedSectionList: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.ListView',
        reason: 'The section-shaped sibling of VirtualizedList, which is SectionList here.',
        limits: ['Every SectionList limit applies; it is the same component under React Native’s other name.'],
    },
    Image: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Picture',
        reason: 'resizeMode becomes content-fit, and the default is inverted: React Native defaults to cover, a Gtk.Picture to contain (measured).',
        limits: [
            'resizeMode answers cover, contain, stretch and center. repeat is refused by name: GtkContentFit is FILL, CONTAIN, COVER, SCALE_DOWN (measured) and has no tiling member — tiling is a Gdk.Paintable implementation, not a property of the widget that draws one.',
            'source takes { uri } with a local path, a file: URI or a resource: URI. http:/https:/data: are refused by name (they need a fetch, a decoder and a cache — an async pipeline this layer does not own); a require() id is refused (it is an index into React Native’s asset registry, and ADR 0032 § 12 leaves the build chain to the consumer); an array is refused (it is the per-device-scale picker, and GTK scales one texture by the surface scale factor).',
            'onLoad, onLoadStart, onLoadEnd, onError and onProgress are refused: Gtk.Picture emits NO signals at all (measured), and a file that does not exist leaves paintable null with no diagnostic — so a callback that never fires would hide exactly the case it exists to report.',
            'blurRadius and tintColor are refused: a per-pixel effect is a Gsk render node, not a widget property.',
        ],
    },
    ImageBackground: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Picture in a Gtk.Overlay',
        reason: 'A picture with the children stacked over it. The picture is the overlay’s MAIN child, because a Gtk.Overlay paints every overlay child ABOVE it.',
        limits: [
            'Every Image limit applies to source and resizeMode.',
            'The element is sized by its PICTURE, not by its children — the opposite of React Native, where the image is absolutely positioned and contributes nothing. Measured: a Gtk.Overlay measures only its main child (a 9 px main child beside a 266 px overlay child gave the overlay 9 px), and gtk_overlay_set_measure_overlay() is a per-child METHOD rather than a property, so the host’s data-driven placement has no way to name it. Give the element a size, or let its parent stretch it (flex-1).',
            'imageStyle styles the picture and style styles the container, as in React Native. imageRef is refused: this element’s ref is the Gtk.Overlay and overlay.get_child() is the picture.',
        ],
    },
    TouchableOpacity: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Button (flat)',
        reason: 'The same machinery as Pressable, written over it: one shared record of routes in the primitive table, one line of component.',
        limits: [
            'activeOpacity is refused by name — write active:opacity-70. The pressed appearance is a GTK CSS :active declaration (ADR 0032 § 7), and honouring a raw number here would put a value into the styling path that did not come from the project’s token scale (ADR 0032 § 3).',
            'Every Pressable limit applies: onPressIn/onPressOut, onLongPress, hitSlop and the press-delay props are refused by name.',
        ],
    },
    TouchableHighlight: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Button (flat)',
        reason: 'As TouchableOpacity. The pressed style is Adwaita’s own unless a variant says otherwise.',
        limits: [
            'underlayColor is refused by name — write active:bg-<token>, for the same reason activeOpacity is: a raw colour would bypass the token scale that every other colour in this vocabulary comes from.',
            'onShowUnderlay/onHideUnderlay are refused: there is no underlay widget to show.',
            'Every TouchableOpacity limit applies.',
        ],
    },
    TouchableWithoutFeedback: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Box + Gtk.GestureClick',
        reason: 'No chrome, so no button: a vertical Gtk.Box like a View, with a Gtk.GestureClick added to it. Measured: Gtk.Button emits activate and clicked, a Gtk.Box emits neither, and Gtk.GestureClick emits pressed/released/stopped/unpaired-release.',
        limits: [
            'It is a real box in the tree, not a transparent clone of its child — React Native clones the single child and attaches the handlers to it, and GTK has no way for a widget to be its own child. So it lays out like a View and takes one row of the parent’s box.',
            'disabled becomes can-target: false rather than sensitive: false, because sensitive greys out every descendant of a wrapper that is supposed to have no appearance of its own.',
            'onPress only. The rest of the Touchable surface is refused by name, as on TouchableOpacity.',
        ],
    },
    Button: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Button',
        reason: 'The one component whose React Native styling story is "you cannot", which GTK agrees with. title, onPress and disabled.',
        limits: [
            'style and className are REFUSED by name, which is faithful: React Native’s Button takes neither. An Adwaita button is painted by the theme and by its own classes (suggested-action, destructive-action), which an application stylesheet sets. Use Pressable when you need to style it.',
            'color is refused: it is the background on Android and the text colour on iOS — one prop, two meanings — and GTK’s answer to both is a class rather than a colour.',
            'It takes no children: title writes Gtk.Button:label, and a text child would be a second authority for the same slot. React Native’s Button takes no children either.',
        ],
    },
    Dimensions: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Window allocation, Gdk.Monitor geometry',
        reason: 'get("window") is the window, not the screen — a desktop app is not full-screen, so the screen’s number would be wrong in the ordinary case. get("screen") is the monitor, because that is what it asks for.',
        limits: [
            'get("window") throws by name when there is no window yet, which includes every read at module scope. There is no honest number before the application builds its window, and a zero divides. Read it from a component or an effect, or use useWindowDimensions.',
            'The reported size is the window’s ALLOCATION, falling back to default-width/default-height before it has been allocated. It is deliberately NOT the Gdk.Surface size: measured, a 640×480 window has a 668×509 surface, which carries the client-side-decoration shadow.',
            'The window is found through Gtk.Window.get_toplevels() (the mapped one first), so it answers for an application that built its own window as well as for one AppRegistry created.',
            'fontScale comes from Gtk.Settings:gtk-xft-dpi / 1024 / 96 (measured: 98304, i.e. 1). set() throws by name: it is how React Native’s native side PUBLISHES metrics, and there is no bridge here.',
        ],
    },
    useWindowDimensions: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gdk.Surface notify::width/height, Gtk.Window allocation',
        reason: 'The hook form of Dimensions, through useSyncExternalStore so a resize between render and commit cannot tear.',
        limits: [
            'The NOTIFIER and the VALUE are different objects, and it is measured rather than chosen: Gtk.Widget installs no width or height property and emits no size-allocate signal (the wall <View onLayout> is refused against), while Gdk.Surface installs read-only width and height and notifies on them. So the surface says when and the window says what.',
            'PRECONDITION NOT MEASURED: whether the window’s allocation is already updated inside that handler. A compositor-driven resize cannot be triggered from a probe — set_default_size on a mapped window is a no-op (measured) — so this is recorded as unknown rather than guessed.',
            'Every Dimensions limit applies to the value itself.',
        ],
    },
    Alert: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Adw.AlertDialog',
        reason: 'Direct counterpart, and buildable where Modal is not: Alert is a FUNCTION CALL, so no element is ever inserted into a widget. Measured on libadwaita 1.9.3 — present(null) from a plain function, with no parent and no window, returned with no diagnostic.',
        limits: [
            'destructive maps to Adw.ResponseAppearance.DESTRUCTIVE and cancel becomes the dialog’s CLOSE RESPONSE, which is stronger than an appearance: it is what Escape and the compositor’s close both produce. The first non-cancel button becomes the default response, which is Adwaita’s convention and has no React Native counterpart.',
            'Response IDs are positional (response-0, …) rather than derived from the label, so two buttons with the same text do not collide into one response.',
            'prompt throws by name: it is iOS-only, and its contract (four overloads, a login/password variant, a callback whose arity depends on the type) is what makes it a refusal rather than a port. Adw.AlertDialog:extra-child is there if you want to build it.',
        ],
    },
    Appearance: {
        status: 'supported',
        tier: 'P2',
        gtk: 'Adw.StyleManager',
        reason: 'The imperative sibling of useColorScheme, over the SAME reader — getColorScheme reads Adw.StyleManager:dark (what the user is looking at) and setColorScheme writes :color-scheme (what the application asked for), which is exactly the split React Native’s getter and setter have.',
    },
    SafeAreaView: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Box',
        reason: 'The INSET has no desktop meaning; the layout does. It is a View in every other respect, and it has to be a real export to be imported.',
        limits: [
            'The safe-area insets are always zero, because a desktop window has none. What is a no-op is the inset — not the box, not the column, not the children: a component that rendered nothing would be a screen that silently disappeared.',
            'It is a View, so every View limit applies (the absolute-child overlay switch, onLayout refused, pointerEvents auto/none only).',
        ],
    },
    StatusBar: {
        status: 'partial',
        tier: 'P2',
        reason: 'A desktop window has no status bar to configure, and <StatusBar/> is in the first ten lines of most React Native screens — so it renders NOTHING and says so, rather than failing to import.',
        limits: [
            'The component renders null. Its declarative props (barStyle, hidden, backgroundColor, translucent, animated) are accepted and do nothing, which is what a declared no-op is.',
            'Every imperative static REFUSES by name: setBarStyle, setHidden, setBackgroundColor, setTranslucent, setNetworkActivityIndicatorVisible, pushStackEntry, popStackEntry, replaceStackEntry. A setter that appears to work is indistinguishable from one that does.',
            'currentHeight throws by name rather than answering 0: code reads it straight into a layout (paddingTop: StatusBar.currentHeight), and a number here would inset every ported screen by a bar that is not there.',
        ],
    },
    KeyboardAvoidingView: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Box',
        reason: 'No on-screen keyboard eats a desktop window layout, so the AVOIDING is the no-op. React Native’s KeyboardAvoidingView is a View that changes its own height; what is left here is the View.',
        limits: [
            'behavior, keyboardVerticalOffset and enabled are declared no-ops: they describe the avoidance, which is already off.',
            'contentContainerStyle is refused by name: it styles the inner view React Native adds to do the avoiding, and there is no second node here. Put it on style.',
            'It is a View, so every View limit applies.',
        ],
    },
    Keyboard: {
        status: 'partial',
        tier: 'P2',
        reason: 'Its events are on-screen-keyboard events, which do not occur — so the questions with a correct answer get it and the ones whose answer would have to be invented refuse.',
        limits: [
            'addListener REFUSES by name, for every event. A subscription that resolves and then never fires is the silent drop this layer exists to remove: a keyboardDidShow handler that never runs looks like a bug in your own code, for ever.',
            'dismiss() and removeAllListeners() are no-ops — nothing was shown, so nothing has to be hidden, and nothing is registered to remove.',
            'isVisible() answers false and metrics() answers undefined, which are React Native’s own answers for a keyboard that is not up.',
            'scheduleLayoutAnimation throws by name: it is LayoutAnimation’s subsystem (tier P3), not a keyboard behaviour.',
        ],
    },
    RefreshControl: {
        status: 'refused',
        reason: 'GTK has no pull-to-refresh idiom and should not grow one. Give the desktop build a refresh action instead.',
    },

    // --- P3: the long tail ----------------------------------------------------

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
