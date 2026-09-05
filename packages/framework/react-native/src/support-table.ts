// What this layer answers for, and what it refuses — the one source three
// readers share.
//
// ADR 0032 § 8. The bundler gate fails a build on an import that is not
// `supported` or `partial`; the runtime throws the same reason for anything that
// reaches it dynamically; `SUPPORT.md` is GENERATED from this file. A
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
//
// AND A SECOND POPULATION, which the table deliberately does not hold: the names
// this layer ADDS to react-native's surface (`configureStyle` and § 3's other token
// hooks, `primitives`, the table's own readers). They cannot become entries here —
// `check-rn-surface.mjs` holds this key set EQUAL to react-native's export list, and
// an invented key there is exactly what that gate exists to catch. They are derived
// instead, in `generated/own-exports.ts`, from the export statements themselves, and
// `isImportable` reads both. Without them the § 8 build gate refused the package's
// own documented API.

import { OWN_EXPORT_NAMES } from './generated/own-exports.js';

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
        reason: 'THREE Gtk.Label defaults disagree with React Native’s and are set explicitly — wrap, xalign and yalign. The whole set of default divergences, including the ones that agree, is enumerated in primitives/defaults.ts.',
        limits: [
            'Gtk.Label CENTRES by default and React Native’s text alignment is unset, which means the script’s natural edge — left in LTR. MEASURED as a position rather than a property: a label allocated 400×100 reports get_layout_offsets() = (193, 41) with GTK’s defaults and (0, 0) with xalign/yalign 0. Found by porting a 25-route application, where every string on every screen rendered centred and nothing reported it; text-center still works, because widgetProps is the base the style partition overrides.',
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
        status: 'partial',
        tier: 'P1',
        gtk: 'Adw.Dialog',
        reason: 'A PORTAL: the element’s host node is not its parent node. An Adw.Dialog is PRESENTED against a parent and never parented by it — MEASURED on libadwaita 1.9.3 / GTK 4.22.4, box.append(dialog) with the box ROOTED IN A WINDOW is g_error() (SIGABRT, exit 134, a core dump), while a detached box takes the same append in silence, which is how a re-test on a bare box appears to disprove it. So @gjsify/gtk-host grew a placement axis (ADR 0045) and AdwDialog declares present/force_close on it; nothing is appended and the abort is unreachable.',
        limits: [
            'visible is the whole component: the element is RENDERED only while it is true, and the dialog is built with can-close: false so nothing else takes it down. MEASURED — with can-close: false, close() returns FALSE, emits close-attempt and leaves the dialog up; force_close(), which the host’s placement names, closes it and emits closed. A dialog that closed itself would leave the element mounted with visible still true and nothing on screen.',
            'onRequestClose is therefore required in practice, exactly as React Native documents it for Android and tvOS: Escape, the close control and a click on the backdrop all arrive there (Adw.Dialog::close-attempt) and none of them dismisses anything by itself.',
            'onShow is Gtk.Widget::map, and it is the shown moment rather than the presented one — MEASURED, present() against a window that has not been shown yet emits nothing and the emission arrives on the window’s present().',
            'onDismiss is refused by name because it would never fire: the only thing that dismisses the dialog is the element being unrendered, and the host disconnects a node’s handlers before it retracts the node.',
            'animationType, transparent, backdropColor and presentationStyle are refused by name. libadwaita animates the presentation itself and picks the animation from Adw.Dialog:presentation-mode, the dim layer is its own, and there is no full-bleed transparent mode. Reach the dialog through a ref for presentation-mode.',
            'The children go into an implicit content box, because Adw.Dialog holds ONE child (set_child/get_child, measured) and two children would be an assignment that silently evicts the first. style and className land on the DIALOG, which is not a box — items-*/gap-* on a <Modal> are refused naming the primitive and belong on a <View> inside it.',
        ],
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
            'runApplication also accepts every @gjsify/adwaita-app shell option (devtools, about, onStartup, quitAction, flags, css), because installDevtools and the startup hooks run at lifecycle moments an entry file cannot reach (ADR 0043).',
            'AppRegistry adds getApplication/getWindow, which React Native has no equivalent for: on a phone the host owns the application, here this layer creates it, so it has to hand it back. Those two only — the React root and its container stay internal, because an accessor a consumer can render or unmount through can be put into a lying state.',
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
        reason: 'Direct counterpart, and it needed no placement seam to be one: Alert is a FUNCTION CALL, so no element is ever inserted into a widget (Modal is the same widget family as an ELEMENT, and reaches the same call through the host portal placement of ADR 0045). Measured on libadwaita 1.9.3 — present(null) from a plain function, with no parent and no window, returned with no diagnostic.',
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
        status: 'partial',
        tier: 'P3',
        gtk: 'Adw.TimedAnimation, over Adw.CallbackAnimationTarget',
        reason: 'Value, timing and View — the three names a measured application uses, in one file of 28 routes. The rest of the subsystem is a graph evaluated per frame, and every other member refuses BY NAME.',
        limits: [
            'THE SUBSET IS: `new Animated.Value(n)` with setValue/__getValue/stopAnimation/resetAnimation, `Animated.timing(value, { toValue, duration, easing, useNativeDriver }).start(cb)` with stop() and reset(), and `<Animated.View style={{ opacity: value }}>`. Every other member of Animated — spring, decay, sequence, parallel, stagger, loop, delay, event, add/subtract/multiply/divide/modulo/diffClamp, Interpolation, Node, ValueXY, Color, createAnimatedComponent, and the Text/Image/ScrollView/FlatList/SectionList components — is a present function that THROWS with its own reason, so a reader learns the limit at the call instead of from `undefined is not a function`.',
            'The only animatable style key is `opacity`, which is `Gtk.Widget:opacity` — a writable gdouble on every widget. `transform` (and translateX/Y, scale, rotate) is a Gsk render node rather than a widget property; `width`/`height` would animate `width-request`, which is a MINIMUM and not a size; colour is GTK CSS and has no property to drive. Each is refused by name at the element.',
            'An animated `opacity` beside an authored one (`opacity-70`, `style={{ opacity }}`, `active:opacity-70`) is REFUSED: L1 partitions opacity into GTK CSS and the animation writes the widget property, which is two channels painting one appearance.',
            'useNativeDriver is accepted and MEANINGLESS. It chooses whether the JS thread ships each frame over the bridge; there is no bridge here, `Adw.TimedAnimation` owns the frame clock either way, and React re-renders for a frame in neither case. Both values behave identically.',
            'An animation whose widget is not realized SKIPS — measured on libadwaita 1.9.3: `play()` sets FINISHED, writes the end value and emits `done` synchronously. That is also what libadwaita does when the user has switched animations off, so a start before the window is mapped jumps to the end rather than running.',
            'A run ends with `{ finished: false }` when every `<Animated.View>` bound to its value unmounts. `Adw.Animation` takes its frame clock from a widget, and MEASURED, destroying that widget makes the animation skip to its end and emit `done` — so without this the layer would report a completion nobody saw.',
            'timing refuses `delay`, `iterations`, `isInteraction`, `onComplete`, `platformConfig` and `debugID` by name, and any other config key generically. `toValue` takes a number only: React Native also accepts a value, an {x, y} pair and a colour there.',
        ],
    },
    Easing: {
        status: 'partial',
        tier: 'P3',
        gtk: 'AdwEasing, through Adw.TimedAnimation:easing',
        reason: 'Not arithmetic, which the planning entry called it: React Native’s easings are FUNCTIONS and AdwEasing is an ENUM with no callback form, so this is a name-to-enum mapping and every pair in it is measured.',
        limits: [
            'Eleven families map EXACTLY (deviation at or below float noise, sampled at 1 001 points against React Native 0.87.1’s own formulas): linear, ease, quad, cubic, poly(1…5), sin, circle, back at its default overshoot, and bounce — plus `in`/`out`/`inOut` over them. `exp` maps with a stated 9.77e-4 deviation, all of it at one endpoint (RN’s 2^(10(t−1)) is 1/1024 at t=0 where CSS’s expo is 0).',
            'bounce is INVERTED between the two vocabularies: React Native’s `Easing.bounce` is the standard easeOutBounce, so `in(bounce)` is AdwEasing’s EASE_OUT_BOUNCE (deviation 0) and `out(bounce)` is EASE_IN_BOUNCE. Matching the names to each other instead is off by 8.1e-1.',
            'Three combinations have NO member and are refused with their measured deviation: inOut(ease) (nearest 1.20e-2), inOut(back) (6.62e-2 from EASE_IN_OUT_BACK) and inOut(bounce) (4.06e-1).',
            'elastic, bezier, step0, step1, a `back(s)` with a non-default overshoot and a `poly(n)` outside 1…5 are refused by name — AdwEasing has no member for any of them, and elastic is 1.99e-1 from the nearest of all 35.',
            'A function this layer did not mint is refused rather than sampled: `Adw.TimedAnimation:easing` names a member, and guessing which of the 35 a caller’s closure resembles is the approximation the whole table exists instead of.',
            'React Native’s own `timing` default is `Easing.inOut(Easing.ease)`, which no member reproduces; the default here is EASE_IN_OUT, 2.86e-2 away from it.',
        ],
    },
    LayoutAnimation: {
        status: 'planned',
        tier: 'P3',
        reason: 'Needs an animated layout pass, which is the same subsystem as Animated.',
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
        reason: 'An Android hardware back button. Routing has landed and this did NOT arrive with it, which the earlier reason assumed it would: BackHandler INTERCEPTS a back press and consumes it, and MEASURED on libadwaita 1.9.3, Adw.NavigationView emits `popped` AFTER the fact and has no vetoable "about to pop" signal at all — its only prevention is Adw.NavigationPage:can-pop, a property rather than an event. The honest counterpart is usePreventRemove, which the routing layer does honour through its popped bridge; this name needs a key controller of its own on the window.',
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
    ProgressBarAndroid: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.ProgressBar',
        reason: 'Android-only by name; GTK has the widget.',
    },

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
    AssetRegistry: {
        status: 'planned',
        tier: 'P3',
        gtk: 'the bundler’s own asset map',
        reason: "New in 0.87: `registerAsset(asset) -> id` and `getAssetByID(id)`, the table Metro’s `require('./x.png')` compiles into. This layer resolves an image source through its own build rather than through Metro, so the counterpart is a map of the same shape and not a native module.",
    },

    unstable_batchedUpdates: {
        status: 'supported',
        reason: 'React 19 batches automatically; this is the identity call it already is upstream — literally so since 0.86, where the getter became a method whose body is `fn(bookkeeping)`.',
    },

    // --- P3: React Native 0.86's virtual collection, which GTK already has -----
    //
    // Seven names arrived together in 0.86 (`src/private/components/virtualcollection/`)
    // and they are one API: a collection interface that does not allocate its items,
    // a view factory over it, the two axis layouts, and two helpers. They are
    // `unstable_` upstream and private by path, so the shape is expected to move.
    //
    // The reason they are `planned` rather than `refused` is that this layer already
    // answers the older half of the same idea: `FlatList` and `VirtualizedList` are
    // `partial` over `Gtk.ListView` + `Gio.ListStore`, which virtualises natively —
    // GTK asks the model for the items it is about to show and recycles the rest.
    // So the work is a mapping, not a virtualisation engine.

    unstable_VirtualArray: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gio.ListStore',
        reason: 'The array-backed implementation of the `VirtualCollection` interface — `size` plus `at(index)`. Its own doc warns it is not for large arrays, because the constructor copies the input; the LAZY case is the interface, not this class. `Gio.ListStore` is the same array-backed shape, and a Gio.ListModel of one\u2019s own is the lazy one.',
    },
    unstable_createVirtualCollectionView: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.ListView / Gtk.GridView',
        reason: 'Builds a view component from a layout component and a generator. The per-item render is the returned component\u2019s `children` render prop — which is what `Gtk.SignalListItemFactory` answers; the generator is a different thing (see below).',
    },
    unstable_VirtualColumn: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.ListView (vertical)',
        reason: 'The collection view built over the column generator. Its layout component renders children plus a spacer and nothing else — the AXIS is in the generator\u2019s spacer style, not in the layout.',
    },
    unstable_VirtualColumnGenerator: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.ListView\u2019s own recycling window',
        reason: 'NOT per item: `{ initial: { itemCount, spacerStyle }, next(event) }` \u2014 how many items to render and how tall the spacer is, recomputed on a mode change. It never sees an item. GTK computes the same thing itself from the viewport.',
    },
    unstable_VirtualRow: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.ListView (horizontal)',
        reason: 'The row twin of the column view. Its layout component is identical to the column\u2019s; on GTK the pair is one view with its orientation set. Upstream exports no row GENERATOR, so only one half of the pair is configurable from outside.',
    },
    unstable_getScrollParent: {
        status: 'planned',
        tier: 'P3',
        gtk: 'the enclosing Gtk.ScrolledWindow',
        reason: 'The nearest scrollable ancestor of a node. GTK answers it by walking parents to a Gtk.ScrolledWindow, and returns nothing at the root for the same reason React Native does.',
    },
    unstable_DEFAULT_INITIAL_NUM_TO_RENDER: {
        status: 'planned',
        tier: 'P3',
        gtk: '—',
        reason: 'The constant 7, upstream’s initial window size. GTK sizes its own recycling window from the viewport, so this is a number to expose rather than to obey.',
    },

    // --- not reachable in this toolchain -------------------------------------

    // Nothing in `react-native`'s own export list is worklet-based, but the
    // libraries that are (`react-native-reanimated`, `react-native-gesture-handler`)
    // are the reason this status exists: they need a Babel transform that is not in
    // this build chain, so they are not a scheduling question. Recorded here rather
    // than only in the ADR, because this file is what a consumer reads.
};

// --- the routing surface, which is a DIFFERENT package's names ---------------
//
// `expo-router`, not `react-native`, so it is a second table rather than more rows
// in the first: `check-rn-surface.mjs` holds SUPPORT_TABLE's key set against
// react-native's own exports, and a `router` row in there would fail that gate for
// being real. The two key sets are disjoint, and `support-table.spec.ts` asserts it —
// a name in both would give `explainUnsupported` two answers.
//
// PROVENANCE, and it is weaker than the first table's, so it is stated rather than
// implied. There is no installed `expo-router` to read: it is not a dependency (ADR
// 0032 § 10 refuses it — full compatibility would drag `react-native-screens` and
// `gesture-handler`, which the measured application never imports). So this key set
// is DECLARED from expo-router's documented surface plus ADR 0032's own measurement
// of which five names an application actually used. What that costs is the drift
// check the snapshot buys for react-native; what it does not cost is honesty about
// the five, which are measured.
//
// SCOPE OF THE CLAIM. `supported`/`partial` here means "this layer answers for the
// name over React Navigation's `core` and `routers`". It does not claim byte-level
// expo-router compatibility, which § 10 rejects by name.

export const ROUTER_SUPPORT_TABLE: Readonly<Record<string, SupportEntry>> = {
    // --- the five names ADR 0032 measured ------------------------------------

    router: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Adw.NavigationView (push/pop) via React Navigation’s StackActions',
        reason: 'push, back, replace, navigate and canGoBack. Every href-taking method accepts BOTH argument shapes — a path string and expo-router’s { pathname, params } object.',
        limits: [
            'ARGUMENT SHAPES, because naming only the methods is the half that let a defect through: push/navigate/replace take `string | { pathname, params }`; back() and canGoBack() take nothing. A params value is a string, a number or a boolean — anything structural is refused by name, because a URL segment is a string and useLocalSearchParams reads it back as one. Params the pattern has no slot for become a query string, which useLocalSearchParams also answers for, so the round trip is total.',
            'The object form used to be missing and it did NOT throw: it interpolated as "[object Object]", so the push succeeded, no route matched, and every parameterised navigation landed on +not-found — 10 call sites in one measured application. `hrefFrom` and `useLocalSearchParams` now share one definition of what a param is, so a drift between writing and reading is a defect the layer detects in itself.',
            'push falls back to NAVIGATE when the navigator that owns the target is not mounted yet. StackActions.push is dispatched at ONE navigator and an href can name a screen several navigators down; for an unmounted navigator, arriving there IS the new entry, so the fallback is correct rather than approximate — but a push into a mounted navigator that is not a stack cannot add an entry, because PUSH is the stack router’s action and no other router answers it.',
            'back() THROWS when there is nothing to go back to, where expo-router and React Navigation both return quietly. A quiet return is a back button that does nothing with no message, which is the silent drop this layer refuses everywhere else. canGoBack() is the question that lets a caller avoid it, and it answers false before the container is ready — nothing has been navigated to yet, so there is genuinely nowhere to go back to.',
            'setParams, dismiss, dismissAll and dismissTo are present functions that THROW with their reason. The dismiss family needs a modal stack this layer has no portal seam for (see Modal); setParams edits the current route’s params in place, so the URL would stop describing the screen and usePathname would answer for a path that is no longer the route’s — replace({ pathname, params }) changes both together.',
            'A catch-all pathname ([...rest]) is refused, with the file-tree parser’s own reason: React Navigation’s path config has no multi-segment wildcard that also carries its parts as a param.',
        ],
    },
    useLocalSearchParams: {
        status: 'partial',
        tier: 'P1',
        reason: 'The current route’s params — the [param] values and the query string — read through React Navigation’s own useRoute().',
        limits: [
            'Values are strings, because a URL segment is one. A number or a boolean that arrived through a dispatched param is stringified; anything structural (an object, an array) is left out, and a [param] cannot produce one. expo-router additionally returns string[] for a repeated query key, which this layer does not.',
            'React Navigation’s seven nesting keys — screen, params, initial, state, path, pop, merge — are filtered out, so a route cannot use those seven as param names.',
        ],
    },
    usePathname: {
        status: 'partial',
        tier: 'P1',
        reason: 'The current URL without its query string, from React Navigation’s getPathFromState over the published root state.',
        limits: [
            'On the +not-found route it reports "/+not-found" rather than the URL that missed. getPathFromState builds a path from the STATE, and the state records which screen matched, not the text that reached it.',
            'It answers "/" before the navigation container is ready. That is not a placeholder — nothing has been navigated to yet — but a component that renders on the first commit and compares against a literal will see it.',
        ],
    },
    Stack: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Adw.NavigationView + Adw.NavigationPage',
        reason: 'The stack navigator: React declares which pages exist, the widget owns their order, and the route key is the tag that joins the two.',
        limits: [
            'A screen answers title, headerShown and animation. Every other expo-router / React Navigation stack option is refused BY NAME at the point of declaration, because an option that is accepted and ignored is invisible until someone looks at the window.',
            'The header is an Adw.HeaderBar inside an Adw.ToolbarView, which grows its own back button and reads the page’s own title. A custom header component is not supported; headerShown={false} drops the bar, and with it the back affordance.',
            'One header bar per window, owned by the OUTERMOST navigator (#1460). As the outermost one, a stack’s pages carry the window controls; nested inside another navigator they keep their bars for the back button and drop the controls, because a window has one set of them. Ownership follows the screen ON TOP: while a headerShown={false} screen is showing, the stack draws no bar and the window keeps its own, so the window stays closable. headerRight, headerLeft and a per-screen action set are not answered for — they are contributions to the owning bar, and that is the next decision rather than a missing prop.',
            'animation is "default" or "none" — Adw.NavigationView has one transition and a switch for it (animate-transitions), not a set of named ones.',
            'Screen preloading is not implemented. React Navigation’s preloadedRoutes would need pages added to the widget’s pool without entering the stack, which is expressible and untested here.',
        ],
    },
    Tabs: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Adw.ViewStack + Adw.ViewSwitcher',
        reason: 'The tab navigator. The switcher is driven by the stack’s own page model, so a route file adds a button with no tab-bar bookkeeping.',
        limits: [
            'A tab answers title only. tabBarIcon is refused: in React Native it is a COMPONENT and Adwaita paints a switcher button from Adw.ViewStackPage:icon-name, an icon NAME on a page object the add returns — reachable through a ref, not through this declaration.',
            'Every tab is mounted. React Native’s tab navigator is lazy because a phone cannot afford five screens; an Adw.ViewStack page that is not the visible child is not realised, and laziness would buy a flash on first switch.',
            'The switcher sits in the header bar with policy WIDE (MEASURED: the default is NARROW, the phone-shaped one). A narrow-window breakpoint is the application’s to declare — Adw.ViewSwitcherBar is not wired here.',
            'Inside another navigator the switcher is CONTRIBUTED to the enclosing page’s header bar rather than getting one of its own (#1460), which is where a hand-written Adwaita application puts it. With headerShown={false} on the enclosing screen there is no bar to contribute to and the tab level renders its own. Two navigators contributing to one bar is refused by name: a header bar has one title.',
            'tabBarBadge, tabBarPosition and the rest of the tab-bar vocabulary are refused by name for the same reason as tabBarIcon: they describe a bar this layer does not draw.',
        ],
    },

    // --- the rest of the surface, on the map -----------------------------------

    Link: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Button (flat) or Gtk.LinkButton',
        reason: 'An href as an element rather than a call. Cheap once `router` exists, and the honest widget question — button or link — is worth measuring first.',
    },
    Redirect: {
        status: 'planned',
        tier: 'P2',
        reason: 'A declarative navigate-on-render. It needs a rule for what happens when it redirects during the first commit, which is the commit that must not be empty.',
    },
    Slot: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Adw.Bin',
        reason: 'A layout that renders its child route with no navigator around it. It is the one layout shape that has no widget of its own.',
    },
    useRouter: {
        status: 'planned',
        tier: 'P2',
        reason: 'The hook form of `router`. Identical behaviour, and it exists so a test can substitute the object — which is worth having once there is something to substitute.',
    },
    useSegments: {
        status: 'planned',
        tier: 'P2',
        reason: 'The current route split into segments. Derivable from the published root state, and unused in the measured application.',
    },
    useGlobalSearchParams: {
        status: 'planned',
        tier: 'P2',
        reason: 'The params of the focused route anywhere in the tree, rather than of the calling screen. It re-renders on every navigation by design, which is why expo-router documents preferring the local form.',
    },
    useNavigation: {
        status: 'planned',
        tier: 'P2',
        reason: 'React Navigation’s own hook, re-exported by expo-router. It works already through @react-navigation/core; exporting it from here is a decision about what this surface promises, not a build.',
    },
    useFocusEffect: {
        status: 'planned',
        tier: 'P2',
        reason: 'As useNavigation: it is core’s, and it works. The open question is the same one.',
    },
    useRootNavigationState: {
        status: 'planned',
        tier: 'P3',
        reason: 'The root state as a hook. The store `usePathname` reads is already there; this is a second selector over it.',
    },
    Drawer: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adw.OverlaySplitView',
        reason: 'A sidebar navigator. The pattern survives on a desktop better than it does on a phone, and Adwaita has the exact widget — it is a third navigator, not a variation on these two.',
    },
    withLayoutContext: {
        status: 'planned',
        tier: 'P3',
        reason: 'The escape hatch that lets a third-party navigator take its screens from the file tree. It is exactly `useRouteNode` plus screen synthesis, made public — worth doing once a third navigator exists to prove the shape.',
    },
    Navigator: {
        status: 'planned',
        tier: 'P3',
        reason: 'expo-router’s low-level navigator primitive. It belongs with withLayoutContext and for the same reason.',
    },
    ErrorBoundary: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Adw.StatusPage',
        reason: 'A per-route error screen. React 19 routes an uncaught error to the root’s handler and @gjsify/gtk-host/react rethrows it from render() — deliberately, so a refusal is not swallowed — and a boundary here has to be reconciled with that rather than bolted beside it.',
    },
    ExpoRoot: {
        status: 'refused',
        reason: 'It takes a Metro `require.context`, which does not exist in this build chain. `RouterRoot` takes the manifest a bundler plugin emits instead — the same job, with the one input that is available.',
    },
    useUnstableGlobalHref: {
        status: 'refused',
        reason: 'Unstable by its own name, and it answers the question usePathname already answers for the only surface this layer has.',
    },
    useNavigationContainerRef: {
        status: 'refused',
        reason: 'The container ref is this layer’s own (one process routes one tree), and handing it out would let a consumer dispatch around the refusals `router` exists to give.',
    },
    SplashScreen: {
        status: 'refused',
        reason: 'A native splash screen belongs to a phone launcher. A GTK application maps its window when it is ready, which is the desktop equivalent and is Gio.Application’s job, not the router’s.',
    },
};

// --- the third-party surfaces (ADR 0036) -------------------------------------
//
// A real React Native application does not only import `react-native`. Measured on
// the application ADR 0032 read, its non-local imports beyond `react` are sixteen
// more package names, and until ADR 0036 every one of them failed at MODULE
// RESOLUTION — the bundler said npm could not find the package, which tells a porter
// nothing about whether a desktop answer exists.
//
// PROVENANCE, and it is weaker than react-native's, so it is stated rather than
// implied. `react-native`'s key set is held EQUAL to a committed snapshot of its own
// `index.js` (`check-rn-surface.mjs`). None of the surfaces below has a snapshot:
// they are not dependencies, and installing sixteen packages to read sixteen export
// lists is a cost with no other buyer. So each key set is DECLARED — from the
// package's documented surface plus ADR 0032's measurement of which names an
// application actually used — and each surface carries an `unknown` sentence for a
// name its table has not heard of, because "run the script that compares this with
// react-native" is the wrong advice for a name that is not react-native's.
//
// WHAT A ROW IS NOT. A row is not a promise to build the surface. ADR 0036 § 5 puts
// every surface in one of three classes and the rows below carry the class in their
// statuses: answered here, answered on another track (a pointer), or nobody's
// business but the consumer's — the last of which gets NO row at all, which is why
// `react-redux` is absent and says so nowhere but the ADR.

export const EXPO_STATUS_BAR_TABLE: Readonly<Record<string, SupportEntry>> = {
    StatusBar: {
        status: 'partial',
        tier: 'P1',
        reason: '`react-native`’s own StatusBar, re-exported. A desktop window has no bar above it, so the component renders null and every imperative setter refuses by name.',
        limits: [
            'Every limit of react-native’s StatusBar applies, because it IS that component: the declarative props are accepted no-ops and currentHeight throws rather than answering 0.',
            'expo-status-bar’s own extra props — style="auto"|"inverted", animated, translucent, hidden, backgroundColor, networkActivityIndicatorVisible, hideTransition — are accepted and do nothing, for the same reason.',
        ],
    },
    setStatusBarStyle: {
        status: 'refused',
        reason: 'Sets the bar’s contrast NOW. There is no bar, and a setter that appears to work is indistinguishable from one that does.',
    },
    setStatusBarHidden: { status: 'refused', reason: 'As setStatusBarStyle: there is no bar to hide.' },
    setStatusBarBackgroundColor: {
        status: 'refused',
        reason: 'Android-only even on a phone, and there is no bar here to paint.',
    },
    setStatusBarTranslucent: { status: 'refused', reason: 'As setStatusBarBackgroundColor.' },
    setStatusBarNetworkActivityIndicatorVisible: {
        status: 'refused',
        reason: 'An iOS spinner in the carrier bar. A desktop application shows progress in its own window.',
    },
};

export const EXPO_FONT_TABLE: Readonly<Record<string, SupportEntry>> = {
    useFonts: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Pango’s font map',
        reason: 'A desktop application does not load a font file per screen: fonts are INSTALLED and the platform’s font map discovers them, so the hook has nothing to wait for and reports ready on its first render.',
        limits: [
            'It answers [true, null] immediately and NEVER re-renders. That is the honest shape — there is no asynchronous load to finish — and it means a screen gated on `if (!loaded) return null` renders straight away instead of flashing.',
            'The map’s VALUES are ignored: a `require("./Inter.ttf")` id is an index into React Native’s asset registry, which ADR 0032 § 12 leaves to the consumer’s build chain, and this layer refuses one for `Image.source` for the same reason. Ship the face with the application and name the FAMILY in your styles: `gjsify.ship.fonts` stages it into `share/fonts/<appId>/`, and each OS reaches it differently (ADR 0038) — fontconfig scans that directory on Linux (measured), `ATSApplicationFontsPath` in the bundle’s Info.plist is documented to activate it on macOS (Apple’s key reference; unverified on hardware here), and on Windows nothing reaches it declaratively at all (measured on Windows 11: the default font map reads no fontconfig configuration, even an exclusive one), so the launcher exports GJSIFY_FONT_DIR and the app registers the faces itself by calling `initFonts()` from `@gjsify/gtk-host/fonts` at startup, which walks that directory into `PangoCairo.FontMap.get_default().add_font_file()` — measured to work there, on the same font map a widget renders through — and no-ops where the OS already activated them.',
            'It does not check that the families exist, deliberately: `isLoaded` does, and a hook that threw here would fail an application whose font is installed under a family name the map’s key does not spell.',
        ],
    },
    isLoaded: {
        status: 'partial',
        tier: 'P2',
        gtk: 'PangoCairo.FontMap.list_families',
        reason: 'A real answer rather than a stub: whether Pango knows a family of that name on this machine.',
        limits: [
            'The comparison is on the FAMILY name and is case-insensitive, which is what Pango matches on. A PostScript name or a file path answers false.',
            'The font map is read once and cached. A font installed while the application is running is not seen — Pango’s own map is not reloaded either, and `Pango.FontMap.changed` is not wired here.',
        ],
    },
    isLoading: {
        status: 'supported',
        tier: 'P2',
        reason: 'Always false. Nothing loads asynchronously, so nothing is ever loading — which is the same answer React Native gives once a font has arrived.',
    },
    loadAsync: {
        status: 'refused',
        reason: 'Registers a font file with the runtime, and what it is HANDED is not a file: the argument is a `require("./Inter.ttf")` id into React Native’s asset registry, which ADR 0032 § 12 leaves to the consumer’s build chain — the same reason `useFonts` ignores its map’s values. So there is no path to register, and a promise that resolved would be claiming a font was installed when it was not. NOT because the call is missing: `pango_font_map_add_font_file()` is in the typelib since Pango 1.56 and `@gjsify/dom-elements` uses it for Canvas FontFace, but it answers G_IO_ERROR_NOT_SUPPORTED on the CoreText map, so it would work on Linux and Windows and lie on macOS. Install the face, or ship it with the application (`gjsify.ship.fonts`, ADR 0038).',
    },
    unloadAsync: { status: 'refused', reason: 'The inverse of loadAsync, and it has the same answer.' },
    unloadAllAsync: { status: 'refused', reason: 'As unloadAsync.' },
    FontDisplay: {
        status: 'refused',
        reason: 'A web `font-display` strategy for a font that is still downloading. Nothing downloads here.',
    },
};

export const EXPO_LINKING_TABLE: Readonly<Record<string, SupportEntry>> = {
    openURL: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.UriLauncher',
        reason: '`react-native`’s own Linking.openURL, re-exported — the same measured implementation, including the `can_launch` gate that stops a promise never settling.',
        limits: ['Every limit of react-native’s Linking.openURL applies; this is that function.'],
    },
    canOpenURL: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.UriLauncher.can_launch',
        reason: 'As openURL: react-native’s own.',
        limits: ['Every limit of react-native’s Linking.canOpenURL applies.'],
    },
    getInitialURL: {
        status: 'partial',
        tier: 'P1',
        reason: 'Always resolves null, which is also what React Native returns for a normal launch.',
        limits: [
            'A desktop deep link arrives as Gio.Application::open AFTER startup, so there is no value to read before it.',
        ],
    },
    useURL: {
        status: 'partial',
        tier: 'P2',
        reason: 'The hook form of getInitialURL, and it answers null for the same reason.',
        limits: [
            'It never updates. A URL delivered while the application runs is `Gio.Application::open`, which is the application object’s own wiring (HANDLES_OPEN plus the signal) and above this layer — the same refusal Linking.addEventListener gives.',
        ],
    },
    parse: {
        status: 'partial',
        tier: 'P2',
        reason: 'Pure URL parsing, so it is answerable with no platform at all: `WHATWG URL`, which gjsify provides, reshaped into expo-linking’s { scheme, hostname, path, queryParams }.',
        limits: [
            'queryParams values are strings; expo-linking returns string[] for a repeated key and this does not, matching the same narrowing `useLocalSearchParams` already declares.',
            'A custom-scheme URL with no `//` (`myapp:profile`) parses with a null hostname and the whole remainder as the path, which is what the URL standard says and not always what a phone deep link meant.',
        ],
    },
    createURL: {
        status: 'refused',
        reason: 'Builds a URL from the application’s own scheme, which expo reads from `app.json`. There is no Expo config here; a desktop application’s identity is its Gio.Application id and its scheme is a desktop-entry declaration. Write the URL.',
    },
    addEventListener: {
        status: 'refused',
        reason: 'URL delivery is Gio.Application::open with HANDLES_OPEN in the application flags — the application object’s own wiring, above this layer. Same refusal as react-native’s Linking.',
    },
    openSettings: {
        status: 'refused',
        reason: 'A phone OS per-app settings page. GNOME Settings has no per-application section a program can deep-link into.',
    },
    sendIntent: { status: 'refused', reason: 'An Android Intent. Same refusal as react-native’s Linking.' },
};

export const EXPO_WEB_BROWSER_TABLE: Readonly<Record<string, SupportEntry>> = {
    openBrowserAsync: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.UriLauncher',
        reason: 'On a phone this opens an IN-APP browser; on a desktop the counterpart is the user’s own browser, which is what Linking.openURL already does.',
        limits: [
            'It resolves { type: "opened" } as soon as the launch succeeds. It CANNOT report a dismissal: the page is in another application and this process is never told when the user closes it. React Native resolves on dismiss, so code that awaits this to know the user is back will continue early.',
            'Every presentation option — toolbarColor, controlsColor, showTitle, enableBarCollapsing, presentationStyle — is ignored: they describe an in-app browser this layer does not draw.',
        ],
    },
    WebBrowserResultType: {
        status: 'supported',
        tier: 'P1',
        reason: 'The result constants, so a comparison against them resolves instead of failing to import.',
    },
    dismissBrowser: {
        status: 'refused',
        reason: 'Closes the in-app browser. There is none: the page is in another application and closing someone else’s window is not this application’s to do.',
    },
    openAuthSessionAsync: {
        status: 'refused',
        reason: 'Opens an in-app browser AND intercepts the redirect back to the app. The interception is the whole feature and it needs the in-app browser; with the system browser the redirect arrives as Gio.Application::open, which is the application’s own wiring.',
    },
    dismissAuthSession: { status: 'refused', reason: 'As dismissBrowser.' },
    maybeCompleteAuthSession: {
        status: 'refused',
        reason: 'Completes a web-popup auth flow, which is expo-web-browser’s browser-target behaviour. There is no popup here.',
    },
    warmUpAsync: {
        status: 'refused',
        reason: 'Pre-warms Android’s Custom Tabs service. A refusal rather than a no-op, because a no-op here would be an optimisation hint that silently does nothing on every platform — and there is no service to warm.',
    },
    coolDownAsync: { status: 'refused', reason: 'The inverse of warmUpAsync.' },
};

export const SAFE_AREA_CONTEXT_TABLE: Readonly<Record<string, SupportEntry>> = {
    SafeAreaView: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Box',
        reason: '`react-native`’s own SafeAreaView, re-exported: the INSET has no desktop meaning, the layout does.',
        limits: [
            'Every limit of react-native’s SafeAreaView applies, and it is the same component.',
            'The `edges` and `mode` props this package adds are accepted and do nothing: every inset is zero, so there is no edge to apply one to and no padding-versus-margin question to answer.',
        ],
    },
    SafeAreaProvider: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Box',
        reason: 'It is a View that publishes the insets. The insets are zero and constant here, so what is left is the View — and it must render, because a provider that rendered nothing would delete the whole application below it.',
        limits: [
            'It is a View, so every View limit applies. `initialMetrics` is accepted and ignored: the metrics it would seed are the ones this layer already answers constantly.',
        ],
    },
    useSafeAreaInsets: {
        status: 'partial',
        tier: 'P1',
        reason: 'Always { top: 0, right: 0, bottom: 0, left: 0 }.',
        limits: [
            'It never changes, so it never re-renders. A desktop window has no notch, no home indicator and no carrier bar; the window manager’s decorations are OUTSIDE the surface this layer lays out.',
            'It does NOT require a SafeAreaProvider above it, where the real package throws. A refusal there would be inventing a requirement this implementation does not have.',
        ],
    },
    useSafeAreaFrame: {
        status: 'partial',
        tier: 'P2',
        gtk: 'Gtk.Window allocation',
        reason: 'The frame is the window, so this is `useWindowDimensions` with an x/y of zero.',
        limits: [
            'Every limit of react-native’s useWindowDimensions applies to width and height; x and y are always 0.',
        ],
    },
    initialWindowMetrics: {
        status: 'partial',
        tier: 'P2',
        reason: 'Zero insets and a zero frame. React Native populates this from the native side BEFORE the first render so a screen can lay out without a flash; there is nothing to read before a GTK window exists.',
        limits: [
            'The frame is 0×0, not the window’s size: reading a window that has not been built yet is what `Dimensions.get("window")` refuses by name, and returning a plausible number here would be the same lie in a value nobody checks.',
        ],
    },
    SafeAreaInsetsContext: {
        status: 'planned',
        tier: 'P3',
        reason: 'The context object behind the hook, used by class components. It is a `createContext` call with a constant in it, and it lands when something needs the class-component form.',
    },
    SafeAreaFrameContext: { status: 'planned', tier: 'P3', reason: 'As SafeAreaInsetsContext.' },
    withSafeAreaInsets: {
        status: 'refused',
        reason: 'A higher-order component that injects the insets into a class component. The insets are constant zero; write them.',
    },
    SafeAreaConsumer: {
        status: 'refused',
        reason: 'The deprecated render-prop form, superseded upstream by the hook.',
    },
};

export const GESTURE_HANDLER_TABLE: Readonly<Record<string, SupportEntry>> = {
    GestureHandlerRootView: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Box',
        reason: 'The root every gesture-handler application wraps itself in. It exists to host the library’s native touch arbitration, and there is none here — so what is left is the View, and it has to render or the application below it disappears.',
        limits: [
            'It is a View, so every View limit applies. It arbitrates nothing: GTK gesture controllers have their own conflict model (claim/deny on a `Gtk.GestureGroup`) and it is not React Native’s.',
        ],
    },
    Gesture: {
        status: 'not-reachable',
        reason: 'The gesture builder’s handlers are WORKLETS, compiled by a Babel plugin that is not in this build chain (ADR 0032’s own Consequences). This is not a scheduling statement.',
    },
    GestureDetector: { status: 'not-reachable', reason: 'It runs `Gesture`’s worklets. Same answer.' },
    PanGestureHandler: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.GestureDrag',
        reason: 'The legacy handler components do not need worklets, and GTK has the controllers — `Gtk.GestureDrag`, `Gtk.GestureClick`, `Gtk.GestureZoom`. What they need is an arbitration model, which is `PanResponder`’s own project in the react-native table.',
    },
    TapGestureHandler: { status: 'planned', tier: 'P3', gtk: 'Gtk.GestureClick', reason: 'As PanGestureHandler.' },
    LongPressGestureHandler: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.GestureLongPress',
        reason: 'As PanGestureHandler.',
    },
    PinchGestureHandler: { status: 'planned', tier: 'P3', gtk: 'Gtk.GestureZoom', reason: 'As PanGestureHandler.' },
    Swipeable: {
        status: 'refused',
        reason: 'A row that reveals actions when dragged. Adwaita’s answer to the same idea is a different interaction entirely, and reproducing a phone one on a desktop is the approximation this layer refuses.',
    },
    ScrollView: {
        status: 'refused',
        reason: 'gesture-handler’s re-wrapped ScrollView exists to cooperate with its own touch arbitration. Import ScrollView from react-native.',
    },
    Directions: { status: 'refused', reason: 'Direction constants for the worklet gesture API.' },
    State: { status: 'refused', reason: 'The gesture state machine’s constants, for the same API.' },
};

export const ASYNC_STORAGE_TABLE: Readonly<Record<string, SupportEntry>> = {
    default: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gio.File in GLib.get_user_data_dir()',
        reason: 'A REAL store, not a stub: one JSON document in the application’s own data directory, read once and rewritten atomically on every mutation.',
        limits: [
            'The whole store is rewritten on every write. React Native’s Android implementation is SQLite and does not; this is a document, so a hot write loop over a large store is O(store) per call. It is sized for what AsyncStorage is documented for — preferences, a session token, a small cache — and not for a database.',
            'A write is `Gio.File.replace_contents` with REPLACE_DESTINATION, which is a write-to-temp-and-rename. A torn file is therefore not reachable through this API; a file corrupted by something else is, and it is reported by name on the first read rather than silently starting from empty.',
            'Nothing is encrypted, which is also React Native’s own contract. A secret belongs in the keyring, which is `Secret.Service` and not this API.',
            'GLib.KeyFile was the obvious desktop shape and is NOT used, MEASURED: `g_key_file_set_string` with a key containing "=" prints a GLib-CRITICAL and DROPS the write, returning normally — and AsyncStorage keys are arbitrary strings ("@app:token", "persist:root"). A store that silently loses a key is the exact failure this layer exists against.',
            'The store’s path needs the application id, which comes from `Gio.Application.get_default()` or `GLib.get_prgname()`. Before a Gio.Application exists — a read at module scope in a script — it throws by name rather than writing to a directory named after the interpreter.',
        ],
    },
    useAsyncStorage: {
        status: 'partial',
        tier: 'P2',
        reason: 'The per-key handle: getItem/setItem/mergeItem/removeItem bound to one key. Pure composition over the default export.',
        limits: [
            'Every limit of the default export applies. It is not reactive: it returns callbacks, not a value, which is upstream’s own shape.',
        ],
    },
};

export const VECTOR_ICONS_TABLE: Readonly<Record<string, SupportEntry>> = {
    Ionicons: {
        status: 'partial',
        tier: 'P1',
        gtk: 'Gtk.Image with a symbolic icon-name',
        reason: 'A declared mapping from Ionicons’ names onto the icon theme’s symbolic names, with every TARGET held against the installed theme by the spec.',
        limits: [
            'An unmapped Ionicons name is a NAMED REFUSAL listing what is mapped, and that is the whole design. GTK’s answer to an icon it does not have is `image-missing` drawn silently — the exit-0 failure mode — so a mapping table without a refusal would put a broken-image glyph in a shipped application.',
            'The mapping’s KEY SET is declared rather than read from a glyph map: `@expo/vector-icons` is not a dependency here. A key that does not exist upstream is a dead row and costs nothing; a key that is missing is a refusal naming what to do. The GTK half is measured — every target is asserted present in the installed theme.',
            'Several Ionicons names map to ONE symbolic icon (chevron-forward and arrow-forward are both go-next-symbolic), because the icon theme draws the distinction the desktop makes rather than the one iOS does.',
            'Filled and outline variants mostly collapse: the Adwaita symbolic set is one weight. A name whose only difference is `-outline` maps to the same icon, and where the theme really has both (starred/non-starred) the pair is kept.',
            'size becomes `Gtk.Image:pixel-size` verbatim. color is a GTK CSS `color` on the generated class, which is how a symbolic icon is recoloured; a non-token colour goes through the same partition as any other style value.',
        ],
    },
    MaterialIcons: {
        status: 'planned',
        tier: 'P3',
        reason: 'A second glyph vocabulary over the same mechanism — a table and its measurement, not new code. It lands when an application measured here uses one.',
    },
    MaterialCommunityIcons: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    FontAwesome: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    Feather: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    AntDesign: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    Entypo: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    Octicons: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    SimpleLineIcons: { status: 'planned', tier: 'P3', reason: 'As MaterialIcons.' },
    createIconSet: {
        status: 'refused',
        reason: 'Builds an icon component from a glyph map and a FONT FILE, rendering a codepoint as text. A GTK symbolic icon is an SVG the theme owns, addressed by name — so there is no font to hand in and no codepoint to render.',
    },
    createIconSetFromFontello: { status: 'refused', reason: 'As createIconSet.' },
    createIconSetFromIcoMoon: { status: 'refused', reason: 'As createIconSet.' },
};

// --- the surfaces this project does not build HERE (ADR 0036 § 5) -------------
//
// A row and a pointer, so the gate refuses the import with a reason instead of the
// bundler failing on module resolution. Each of these has a real desktop answer and
// it belongs to a track that is not the vocabulary translation.

export const EXPO_IMAGE_TABLE: Readonly<Record<string, SupportEntry>> = {
    Image: {
        status: 'planned',
        tier: 'P2',
        gtk: 'Gtk.Picture',
        reason: 'The same widget react-native’s Image already uses, plus caching, transitions and blurhash. The widget half is answered; the rest is a decoding-and-cache pipeline this layer does not own yet. Import Image from react-native for the widget half.',
    },
    ImageBackground: { status: 'planned', tier: 'P2', gtk: 'Gtk.Picture in a Gtk.Overlay', reason: 'As Image.' },
    useImage: {
        status: 'planned',
        tier: 'P3',
        reason: 'Loads a source into an image object ahead of render. It needs the pipeline Image needs.',
    },
};

export const EXPO_AUDIO_TABLE: Readonly<Record<string, SupportEntry>> = {
    useAudioPlayer: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.MediaFile',
        reason: 'Playback is a MEDIA question rather than a view-vocabulary one: GTK has Gtk.MediaFile and Gtk.MediaStream, and which package owns them is its own decision with its own measurement (ADR 0036, "What this does not decide").',
    },
    useAudioRecorder: {
        status: 'planned',
        tier: 'P3',
        reason: 'Recording is GStreamer rather than GTK, and it is the same open decision as playback.',
    },
    AudioModule: { status: 'planned', tier: 'P3', reason: 'The module surface behind the hooks. Same track.' },
    setAudioModeAsync: {
        status: 'planned',
        tier: 'P3',
        reason: 'Session policy for a phone’s audio focus. Same track.',
    },
};

export const EXPO_VIDEO_TABLE: Readonly<Record<string, SupportEntry>> = {
    VideoView: {
        status: 'planned',
        tier: 'P3',
        gtk: 'Gtk.Video',
        reason: 'GTK has the widget. Which package owns media is the open decision expo-audio names; it is not the view vocabulary’s.',
    },
    useVideoPlayer: { status: 'planned', tier: 'P3', gtk: 'Gtk.MediaFile', reason: 'As VideoView.' },
    VideoContentFit: { status: 'planned', tier: 'P3', reason: 'The fit constants; they land with the widget.' },
};

export const WEBVIEW_TABLE: Readonly<Record<string, SupportEntry>> = {
    WebView: {
        status: 'planned',
        tier: 'P3',
        gtk: 'WebKitGTK’s WebKit.WebView',
        reason: 'A real widget with a real answer, and its platform story is its own: WebKit’s availability differs per OS (ADR 0022) and it is the heaviest dependency any of these surfaces would add. It belongs to the webkit track.',
    },
    default: { status: 'planned', tier: 'P3', reason: 'The default export is WebView; it has the same answer.' },
};

export const NATIVEWIND_TABLE: Readonly<Record<string, SupportEntry>> = {
    cssInterop: {
        status: 'refused',
        reason: 'ADR 0032 § 12 already decided this surface: the class VOCABULARY is consumed and none of its toolchain is. `className` works on every primitive here with no runtime — resolving this would pull bindings to React Native’s StyleSheet, Appearance, Dimensions and PixelRatio into the critical path, which is the two-lossy-mappings-stacked shape that rules out react-native-web.',
    },
    remapProps: { status: 'refused', reason: 'As cssInterop.' },
    styled: { status: 'refused', reason: 'As cssInterop. Write `className` on the primitive.' },
    vars: {
        status: 'refused',
        reason: 'CSS variables at runtime. GTK CSS has its own (`@define-color` and the Adwaita palette), and they are set through the application stylesheet rather than through a prop.',
    },
    useColorScheme: {
        status: 'refused',
        reason: 'Its own hook over React Native’s Appearance. `useColorScheme` from react-native is answered here and reads Adw.StyleManager:dark, which is what the user is actually looking at.',
    },
};

export const EXPO_CONSTANTS_TABLE: Readonly<Record<string, SupportEntry>> = {
    default: {
        status: 'refused',
        reason: 'The Expo config object — `expoConfig`, `appOwnership`, `executionEnvironment`, `manifest`, `sessionId`. A desktop application’s identity is its Gio.Application id and its metadata is its desktop entry; there is no manifest here to read, and a shape that answered with plausible nulls would be read as "not configured" rather than "does not apply".',
    },
    ExecutionEnvironment: {
        status: 'refused',
        reason: 'Whether the app runs in Expo Go, a dev client or a standalone build. None of the three exists here.',
    },
    AppOwnership: { status: 'refused', reason: 'As ExecutionEnvironment.' },
};

export const EXPO_SYSTEM_UI_TABLE: Readonly<Record<string, SupportEntry>> = {
    setBackgroundColorAsync: {
        status: 'refused',
        reason: 'Paints the window’s root view behind React. On GTK that is the application stylesheet’s job and Adwaita already answers it per colour scheme — a per-call override would fight the theme and win only until the scheme changes.',
    },
    getBackgroundColorAsync: {
        status: 'refused',
        reason: 'Reads back what setBackgroundColorAsync wrote. Nothing wrote it.',
    },
};

export const EXPO_SPLASH_SCREEN_TABLE: Readonly<Record<string, SupportEntry>> = {
    preventAutoHideAsync: {
        status: 'refused',
        reason: 'Holds a native splash screen up while the app loads. A GTK application MAPS ITS WINDOW when it is ready, which is the desktop equivalent and is Gio.Application’s own job — the same refusal the router table gives expo-router’s SplashScreen.',
    },
    hideAsync: { status: 'refused', reason: 'Hides a splash screen that was never shown.' },
    hide: { status: 'refused', reason: 'The synchronous form, and it has the same answer.' },
    preventAutoHide: { status: 'refused', reason: 'The synchronous form of preventAutoHideAsync.' },
    setOptions: { status: 'refused', reason: 'Configures the fade of a screen that does not exist.' },
};

// --- the registry (ADR 0036 § 2) ---------------------------------------------

/** One npm package this layer answers for, and where its answer lives. */
export interface Surface {
    /** The npm specifier an application writes. */
    readonly module: string;
    /** The specifier of this package that answers it — the alias target. */
    readonly target: string;
    /** What a build error and the generated `SUPPORT.md` call it. */
    readonly label: string;
    /**
     * This file's own name for the table.
     *
     * `scripts/generate-exports.mjs` and `scripts/check-rn-surface.mjs` read the
     * table out of THIS FILE'S SOURCE, because a consumer's `node_modules` ships
     * `lib` and not `src`. They need the declaration's identifier to find it.
     */
    readonly declaration: string;
    readonly table: Readonly<Record<string, SupportEntry>>;
    /**
     * What a name this table has never heard of means, in this surface's terms.
     *
     * `react-native`'s key set is held EQUAL to a committed snapshot of its own
     * exports, so an unknown name there really does mean the table is stale and the
     * sentence says which script settles it. Every other surface's key set is
     * DECLARED, so the same sentence would send a reader to a script that compares
     * the table with react-native — where the name is correctly absent and they
     * would find nothing.
     */
    readonly unknown: string;
}

const PACKAGE = '@gjsify/react-native';

const STALE_TABLE =
    `is not a React Native export this layer knows about. If the installed react-native really exports ` +
    `it, the support table is out of date — run scripts/check-rn-surface.mjs, which compares the two.`;

const DECLARED_SURFACE = (pkg: string): string =>
    `is not a name this layer's ${pkg} surface declares. That key set is DECLARED rather than read from an ` +
    `installed ${pkg} (it is not a dependency here), so a missing name means nobody has decided about it ` +
    `yet — open an issue naming it, or import the name from react-native if it has one there.`;

/**
 * Every surface, in lookup order.
 *
 * ORDER IS THE ANSWER to the collision this registry creates. `StatusBar` is a
 * `react-native` export AND the whole of `expo-status-bar`; `SafeAreaView` is in
 * `react-native` and in `react-native-safe-area-context`. Two tables with one name
 * used to be impossible — `support-table.spec.ts` asserted the two key sets were
 * DISJOINT — and with sixteen surfaces the collision is the normal case. So the
 * lookup takes the MODULE, and the one-argument form (the runtime backstop, and
 * consumer tooling) resolves in this order and says which surface answered.
 */
export const SURFACES: readonly Surface[] = [
    {
        module: 'react-native',
        target: PACKAGE,
        label: 'React Native',
        declaration: 'SUPPORT_TABLE',
        table: SUPPORT_TABLE,
        unknown: STALE_TABLE,
    },
    {
        module: 'expo-router',
        target: `${PACKAGE}/router`,
        label: 'expo-router',
        declaration: 'ROUTER_SUPPORT_TABLE',
        table: ROUTER_SUPPORT_TABLE,
        unknown: DECLARED_SURFACE('expo-router'),
    },
    {
        module: 'expo-status-bar',
        target: `${PACKAGE}/expo-status-bar`,
        label: 'expo-status-bar',
        declaration: 'EXPO_STATUS_BAR_TABLE',
        table: EXPO_STATUS_BAR_TABLE,
        unknown: DECLARED_SURFACE('expo-status-bar'),
    },
    {
        module: 'expo-font',
        target: `${PACKAGE}/expo-font`,
        label: 'expo-font',
        declaration: 'EXPO_FONT_TABLE',
        table: EXPO_FONT_TABLE,
        unknown: DECLARED_SURFACE('expo-font'),
    },
    {
        module: 'expo-linking',
        target: `${PACKAGE}/expo-linking`,
        label: 'expo-linking',
        declaration: 'EXPO_LINKING_TABLE',
        table: EXPO_LINKING_TABLE,
        unknown: DECLARED_SURFACE('expo-linking'),
    },
    {
        module: 'expo-web-browser',
        target: `${PACKAGE}/expo-web-browser`,
        label: 'expo-web-browser',
        declaration: 'EXPO_WEB_BROWSER_TABLE',
        table: EXPO_WEB_BROWSER_TABLE,
        unknown: DECLARED_SURFACE('expo-web-browser'),
    },
    {
        module: 'react-native-safe-area-context',
        target: `${PACKAGE}/react-native-safe-area-context`,
        label: 'react-native-safe-area-context',
        declaration: 'SAFE_AREA_CONTEXT_TABLE',
        table: SAFE_AREA_CONTEXT_TABLE,
        unknown: DECLARED_SURFACE('react-native-safe-area-context'),
    },
    {
        module: 'react-native-gesture-handler',
        target: `${PACKAGE}/react-native-gesture-handler`,
        label: 'react-native-gesture-handler',
        declaration: 'GESTURE_HANDLER_TABLE',
        table: GESTURE_HANDLER_TABLE,
        unknown: DECLARED_SURFACE('react-native-gesture-handler'),
    },
    {
        module: '@react-native-async-storage/async-storage',
        target: `${PACKAGE}/async-storage`,
        label: '@react-native-async-storage/async-storage',
        declaration: 'ASYNC_STORAGE_TABLE',
        table: ASYNC_STORAGE_TABLE,
        unknown: DECLARED_SURFACE('@react-native-async-storage/async-storage'),
    },
    {
        module: '@expo/vector-icons',
        target: `${PACKAGE}/vector-icons`,
        label: '@expo/vector-icons',
        declaration: 'VECTOR_ICONS_TABLE',
        table: VECTOR_ICONS_TABLE,
        unknown: DECLARED_SURFACE('@expo/vector-icons'),
    },
    {
        module: 'expo-image',
        target: `${PACKAGE}/expo-image`,
        label: 'expo-image',
        declaration: 'EXPO_IMAGE_TABLE',
        table: EXPO_IMAGE_TABLE,
        unknown: DECLARED_SURFACE('expo-image'),
    },
    {
        module: 'expo-constants',
        target: `${PACKAGE}/expo-constants`,
        label: 'expo-constants',
        declaration: 'EXPO_CONSTANTS_TABLE',
        table: EXPO_CONSTANTS_TABLE,
        unknown: DECLARED_SURFACE('expo-constants'),
    },
    {
        module: 'expo-system-ui',
        target: `${PACKAGE}/expo-system-ui`,
        label: 'expo-system-ui',
        declaration: 'EXPO_SYSTEM_UI_TABLE',
        table: EXPO_SYSTEM_UI_TABLE,
        unknown: DECLARED_SURFACE('expo-system-ui'),
    },
    {
        module: 'expo-splash-screen',
        target: `${PACKAGE}/expo-splash-screen`,
        label: 'expo-splash-screen',
        declaration: 'EXPO_SPLASH_SCREEN_TABLE',
        table: EXPO_SPLASH_SCREEN_TABLE,
        unknown: DECLARED_SURFACE('expo-splash-screen'),
    },
    {
        module: 'expo-audio',
        target: `${PACKAGE}/expo-audio`,
        label: 'expo-audio',
        declaration: 'EXPO_AUDIO_TABLE',
        table: EXPO_AUDIO_TABLE,
        unknown: DECLARED_SURFACE('expo-audio'),
    },
    {
        module: 'expo-video',
        target: `${PACKAGE}/expo-video`,
        label: 'expo-video',
        declaration: 'EXPO_VIDEO_TABLE',
        table: EXPO_VIDEO_TABLE,
        unknown: DECLARED_SURFACE('expo-video'),
    },
    {
        module: 'react-native-webview',
        target: `${PACKAGE}/react-native-webview`,
        label: 'react-native-webview',
        declaration: 'WEBVIEW_TABLE',
        table: WEBVIEW_TABLE,
        unknown: DECLARED_SURFACE('react-native-webview'),
    },
    {
        module: 'nativewind',
        target: `${PACKAGE}/nativewind`,
        label: 'nativewind',
        declaration: 'NATIVEWIND_TABLE',
        table: NATIVEWIND_TABLE,
        unknown: DECLARED_SURFACE('nativewind'),
    },
];

/** Every name `react-native` publicly exports, as this table claims to cover it. */
export const SUPPORTED_NAMES: readonly string[] = Object.keys(SUPPORT_TABLE);

/** Every `expo-router` name the routing surface declares a status for. */
export const ROUTER_NAMES: readonly string[] = Object.keys(ROUTER_SUPPORT_TABLE);

/** Statuses a build may import. Every other status is a named refusal. */
const IMPORTABLE: ReadonlySet<SupportStatus> = new Set<SupportStatus>(['supported', 'partial']);

/**
 * The surface a specifier names, by the module OR by the target.
 *
 * BOTH, because a ported application writes `react-native` and a gjsify-native one
 * writes `@gjsify/react-native` — the gate is about the SURFACE, not about which
 * name reached it, and it reads the source text where the alias has not run yet.
 */
export const surfaceFor = (specifier: string): Surface | undefined =>
    SURFACES.find((surface) => surface.module === specifier || surface.target === specifier);

const lookup = (
    name: string,
    module?: string,
): { readonly surface: Surface; readonly entry?: SupportEntry } | undefined => {
    if (module !== undefined) {
        const surface = surfaceFor(module);
        if (surface === undefined) return undefined;
        const entry = surface.table[name];
        return entry === undefined ? { surface } : { surface, entry };
    }
    for (const surface of SURFACES) {
        const entry = surface.table[name];
        if (entry !== undefined) return { surface, entry };
    }
    return undefined;
};

/**
 * The names this layer adds on top of React Native's, from the generated list.
 *
 * A Set rather than the array, because `isImportable` is asked once per imported
 * name during a build.
 */
const OWN: ReadonlySet<string> = new Set(OWN_EXPORT_NAMES);

/**
 * Is `name` one of this layer's OWN exports rather than a React Native one?
 *
 * `configureStyle`, `resetStyleConfig` and `styleConfig` carry § 3's token scales,
 * `primitives` is L2, and the table plus its readers are public. None is a React
 * Native name, so none has — or should have — a table entry.
 */
export const isOwnExport = (name: string): boolean => OWN.has(name);

// Public alongside `SUPPORTED_NAMES`, and from HERE rather than from the generated
// module: `@gjsify/react-native/support-table` is the subpath the build gate reads,
// and a consumer building their own tooling should not have to know that half the
// answer lives in a generated file.
export { OWN_EXPORT_NAMES };

/**
 * May a build import `name` from `module`?
 *
 * TWO POPULATIONS, and the tables answer FIRST. A name a surface's table judges is
 * the table's to decide, whatever else claims it; only a name no table has heard of
 * falls through to the layer's own exports — and only on the ROOT surface, because
 * `configureStyle` is exported from `@gjsify/react-native` and from nowhere else.
 * That order is the safety property: the derived list can add names, never promote a
 * `planned` one, so a mistake upstream of it cannot turn an import of one into a
 * green build.
 *
 * A name in NEITHER population is still refused — which is the whole difference
 * between this and "anything the table does not know is fine", the shape that would
 * pass every typo. A specifier that names no surface at all is refused too: the gate
 * only asks about specifiers the registry declares, so reaching this with an unknown
 * one is a caller error rather than an import to wave through.
 */
export const isImportable = (name: string, module?: string): boolean => {
    const found = lookup(name, module);
    if (found?.entry !== undefined) return IMPORTABLE.has(found.entry.status);
    if (module !== undefined) {
        const surface = found?.surface;
        if (surface === undefined) return false;
        return surface.target === PACKAGE && isOwnExport(name);
    }
    return isOwnExport(name);
};

/**
 * The two specifiers a sentence has to name, in the order a reader meets them.
 *
 * THE NPM MODULE FIRST, and it is not decoration: three of the eighteen targets do not
 * contain their module's name at all — `expo-router` is answered by
 * `@gjsify/react-native/router`, `@expo/vector-icons` by
 * `@gjsify/react-native/vector-icons` and
 * `@react-native-async-storage/async-storage` by `@gjsify/react-native/async-storage`.
 * A sentence prefixed with the TARGET alone therefore named a specifier the reader
 * never wrote: `import { Tabs } from 'expo-router'` was answered by
 * "@gjsify/react-native/router: …", which reads as an unrelated package. ADR 0036 § 3
 * and § 6 both say the sentence prints the module; for those three it did not.
 *
 * The target stays, because it is the answer to "where do I import it from" for a
 * gjsify-native application and for the two names that moved surface.
 */
const specifiers = (surface: Surface): string => `${surface.module} → ${surface.target}`;

/**
 * The sentence a build error and a runtime throw both print.
 *
 * One function so the two cannot drift into describing the same gap differently —
 * which is the whole reason the table is data rather than prose in two places. It
 * covers EVERY surface and prints the module the name belongs to, so a reader who
 * imported `Tabs` from the wrong entry point learns which one has it.
 */
export function explainUnsupported(name: string, module?: string): string {
    const found = lookup(name, module);
    if (found === undefined) {
        // Asked about one of this layer's own names, the react-native sentence would
        // send a reader to a script that compares the table with react-native — where
        // the name is correctly absent, and the reader would find nothing.
        if (module === undefined && isOwnExport(name)) {
            return (
                `${PACKAGE}: "${name}" is this layer's own export rather than a React Native ` +
                `name, and it is available.`
            );
        }
        if (module !== undefined) {
            return (
                `${PACKAGE}: "${module}" is not a surface this layer declares, so it has nothing to say about ` +
                `"${name}". The declared surfaces are: ${SURFACES.map((surface) => surface.module).join(', ')}.`
            );
        }
        return `${PACKAGE}: "${name}" ${STALE_TABLE}`;
    }
    const { surface, entry } = found;
    if (entry === undefined) {
        if (surface.target === PACKAGE && isOwnExport(name)) {
            return (
                `${PACKAGE}: "${name}" is this layer's own export rather than a React Native ` +
                `name, and it is available.`
            );
        }
        return `${specifiers(surface)}: "${name}" ${surface.unknown}`;
    }
    const where = specifiers(surface);
    const tier = entry.tier ? ` (tier ${entry.tier})` : '';
    const gtk = entry.gtk ? ` The GTK counterpart is ${entry.gtk}.` : '';
    switch (entry.status) {
        case 'supported':
        case 'partial':
            return `${where}: "${name}" is available.`;
        case 'planned':
            return `${where}: "${name}" is not implemented yet${tier}. ${entry.reason}${gtk}`;
        case 'refused':
            return `${where}: "${name}" will not be implemented. ${entry.reason}`;
        case 'no-desktop-meaning':
            return `${where}: "${name}" has no meaning on a desktop window${tier}. ${entry.reason}`;
        case 'not-reachable':
            return `${where}: "${name}" cannot be implemented in this build chain. ${entry.reason}`;
    }
}
