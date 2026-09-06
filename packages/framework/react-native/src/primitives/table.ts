// The primitive vocabulary, as DATA: one row per React Native primitive, saying
// which widget it becomes and where each of its props goes.
//
// ADR 0032 § 2 asks for data rather than code here, so that lifting a
// framework-neutral primitive vocabulary out of this later is a MOVE rather than a
// rewrite. Nothing in this file imports React, and nothing in it imports `gi://` —
// a row is a record of strings, and `resolve.ts` is the only thing that executes it.
//
// The three structural facts that are NOT expressible as a per-prop route each got
// their own declared field rather than a branch in the resolver: `content` (a
// second styleable node inside the element), `overlayOnAbsoluteChild` (the element
// becomes a different widget because of what is INSIDE it) and `switchOn` (one
// React Native prop, two GTK widgets). Each is one line of data and the resolver
// reads all three the same way for every primitive.
//
// WHY AN UNKNOWN PROP IS A THROW. A React Native prop this table does not carry is
// refused by name, listing what the primitive does take. The alternative is a
// silent drop, and a silent drop in a view layer is the failure this whole package
// exists to remove: `<ScrollView onScroll={…}>` that never fires looks like a
// callback bug in the application, forever. `children`, `key` and `ref` are the
// only exceptions, because they are the framework's and never reach a widget.
//
// WHY `Modal` IS HERE NOW, and it is still the sharpest measurement of this file.
// ADR 0032 maps it to `Adw.Dialog`, and an `Adw.Dialog` cannot be an ordinary
// element: measured on libadwaita 1.9.3 / gjs 1.88.1, with the box ROOTED IN A
// WINDOW — a detached box accepts the append in silence, so a re-test on a bare
// box 'disproves' this and puts the naive mapping back — `box.append(dialog)` calls
// `g_error()`, "Trying to add AdwDialog … to GtkBox. Use adw_dialog_present() to
// show dialogs.", which is SIGABRT and a core dump, not an exception a host can
// catch and not a warning a diagnostics gate can count. A dialog is PRESENTED
// against a parent, never parented by it, which makes `<Modal>` a PORTAL rather
// than an ordinary primitive. That is not a property of this table: it is a
// property of the tree, so it was fixed in the tree. `@gjsify/gtk-host` grew a
// placement axis for it (ADR 0045) and `AdwDialog` declares it, so the row below
// is an ordinary row — the abort is unreachable because nothing is appended.

import type { AccessibleAttribute, AccessibleRoute } from './accessibility.js';
import type { Orientation, WidgetFacts, WrapsInto } from './intents.js';

/** How a prop's value becomes a GTK value. */
export type Coercion =
    /** Straight through, as a string. */
    | 'string'
    /** Straight through, as a boolean. */
    | 'boolean'
    /** Inverted — `secureTextEntry` is `Gtk.Entry:visibility` turned around. */
    | 'not'
    /** Truncated to the `gint` a GTK property stores. */
    | 'int'
    /** Looked up in {@link PropertyRoute.map}; anything else is a named refusal. */
    | 'map'
    /** A number is a pixel count; a string is looked up in the map. */
    | 'pixels-or-map';

/**
 * Which of an element's up-to-three GTK nodes a prop lands on.
 *
 * `outer` is the node the parent adopts, `content` the node the element's children
 * go into, `backdrop` a node that takes no children and sits BEHIND them —
 * `ImageBackground`'s picture, and the only reason the third one exists.
 */
export type NodeKind = 'outer' | 'content' | 'backdrop';

export interface PropertyRoute {
    readonly to: 'property';
    /** Which node it lands on. `content` is the implicit inner box, where there is one. */
    readonly on?: NodeKind;
    /** The GTK properties this one prop fills — plural for `size`, which is two requests. */
    readonly names: readonly string[];
    readonly as: Coercion;
    readonly map?: Readonly<Record<string, string | number | boolean>>;
    /**
     * Values this layer recognises and refuses, each with what to do instead.
     *
     * A value simply ABSENT from {@link map} already gets a named refusal listing
     * the known ones, and that is the right answer for a typo. It is the wrong
     * answer for a real React Native spelling with no GTK member:
     * `accessibilityRole="keyboardkey"` is not a typo, and "Known: adjustable,
     * alert, …" tells its author nothing they can act on. A key here answers by
     * name instead, in the voice every {@link RefusedRoute} uses.
     */
    readonly refuses?: Readonly<Record<string, string>>;
    /** Properties that come with this prop being SET at all, whatever its value. */
    readonly also?: Readonly<Record<string, unknown>>;
}

/** A prop that joins the normalised style record instead of going straight to a widget. */
export interface StylePropertyRoute {
    readonly to: 'style-property';
    /** Its name in `StyleProps` — `ActivityIndicator`'s `color` is the paint half's `color`. */
    readonly name: string;
}

export interface EventRoute {
    readonly to: 'event';
    /** The GObject signal, in GObject's own spelling. `notify::active` is a real signal name. */
    readonly signal: string;
    /**
     * The widget property whose value becomes the callback's argument.
     *
     * The host strips the emitter before calling a handler (`next(...args.slice(1))`
     * in `signals.ts`), and `Gtk.Editable::changed` carries no payload of its own —
     * so `onChangeText(text)` cannot be built from the signal arguments at all. The
     * framework layer reads this property off its own ref instead, which is why the
     * NAME is data here and the reading is L3's.
     */
    readonly read?: string;
}

export interface RefusedRoute {
    readonly to: 'refused';
    /** One line: why GTK cannot answer it, and what to do instead. */
    readonly why: string;
}

/**
 * A prop the LAYER answers by calling a method when a signal fires.
 *
 * `accessibilityLiveRegion` is the whole of it, and the shape is forced by the
 * mismatch between the two platforms' models. React Native's prop is a DECLARATION
 * — "when this element's content changes, tell the user" — and the platform's
 * accessibility layer watches for the change. GTK has no such declaration: since
 * 4.14 it has `gtk_accessible_announce(self, message, priority)` (MEASURED on
 * gtk 4.22.4 — the method is on the `Gtk.Accessible` interface, so every widget has
 * it, and it takes a `GtkAccessibleAnnouncementPriority` of LOW/MEDIUM/HIGH), which
 * is an IMPERATIVE call: the caller supplies both the moment and the message.
 *
 * So a live region can only be built where this layer knows both. It knows both on
 * exactly one primitive — `Text`, whose content IS one widget property, so
 * `notify::label` is the moment and `label` is the message. Everywhere else the
 * content is a SUBTREE and GTK emits nothing when one changes, which is why the
 * common route refuses the prop by name rather than this route answering it.
 *
 * Like {@link FileRoute} and {@link GestureRoute}, the table holds the whole of the
 * DECISION and none of the call: the priority is a `gi://Gtk` enum member and
 * nothing under `primitives/` imports `gi://`.
 */
export interface AnnounceRoute {
    readonly to: 'announce';
    /** The signal whose emission means "the content this element shows has changed". */
    readonly signal: string;
    /** The widget property holding the message to announce. */
    readonly read: string;
    /**
     * React Native's values → `Gtk.AccessibleAnnouncementPriority` nicks; `null` is
     * "recognised, announce nothing".
     *
     * GTK's `low` is deliberately absent as a TARGET: React Native has three values
     * and ARIA has two live-region levels, so a third GTK priority would have no
     * spelling to arrive from.
     */
    readonly map: Readonly<Record<string, 'low' | 'medium' | 'high' | null>>;
}

/**
 * A prop that is a DECLARED no-op.
 *
 * Not the same thing as an unknown prop and not the same thing as a refusal: the
 * name is recognised, the answer is "a desktop window already behaves this way".
 * `flex-nowrap` in `@gjsify/gtk-host/style` is the same shape for the same reason —
 * declared here, asserted empty in the spec, so "means nothing on GTK" stays
 * distinguishable from "was never recognised".
 */
export interface IgnoredRoute {
    readonly to: 'ignored';
    readonly why: string;
}

/**
 * A prop whose value becomes a `Gio.File` — and the reason it is its own kind.
 *
 * `Gtk.Picture:file` takes a `Gio.File`, an OBJECT, and building one needs
 * `gi://Gio`. Nothing under `primitives/` imports `gi://` (that is what makes L2
 * testable without a display and reusable by a binding that never loads GTK), so the
 * table cannot produce the value — only the DECISION about it. So L2 does the whole
 * of the decision, which is where every refusal lives (`http:` has no synchronous
 * loader, a `require()` id has no asset registry, an array is a device-scale
 * picker), and hands the framework layer a `{ kind, value }` pair it turns into one
 * call: `Gio.File.new_for_path` or `Gio.File.new_for_uri`.
 */
export interface FileRoute {
    readonly to: 'file';
    /** Which node it lands on. */
    readonly on?: NodeKind;
    /** The GTK property that takes the file — `file` on a `Gtk.Picture`. */
    readonly property: string;
}

/**
 * A prop bound through a gesture CONTROLLER rather than a signal on the widget.
 *
 * `TouchableWithoutFeedback` is the one primitive that needs it: it has no button
 * chrome, so its widget is a `Gtk.Box`, and a box emits no `clicked` (measured —
 * `Gtk.Button`'s two signals are `activate` and `clicked`, and a box has neither).
 * The desktop answer is a `Gtk.GestureClick` added to the widget, whose `released`
 * signal is the press completing. A controller is `add_controller(new
 * Gtk.GestureClick())` — a constructed OBJECT, so the same rule as {@link FileRoute}
 * applies: the table names the signal, the framework layer builds the controller.
 */
export interface GestureRoute {
    readonly to: 'gesture';
    /** The `Gtk.GestureClick` signal — `released` for a completed press. */
    readonly signal: string;
}

export type PropRoute =
    | PropertyRoute
    | StylePropertyRoute
    | EventRoute
    | RefusedRoute
    | IgnoredRoute
    | FileRoute
    | GestureRoute
    | AnnounceRoute
    | AccessibleRoute;

/**
 * The imperative handle a `ref` on this primitive receives, instead of the widget.
 *
 * DATA and not a per-binding decision, for the reason every other field here is
 * data: React and Solid both hand a `ref` its value, and a handle built in one L3
 * would be a second vocabulary the other one does not have. `handles.ts` turns the
 * kind into the object; the table only says which primitives have one.
 *
 * A primitive with NO kind hands back the `Gtk.Widget` itself, which is what every
 * primitive did before and still does — React Native only gives an imperative
 * handle to the components that document one.
 */
export type HandleKind = 'text-input';

/** A second styleable node inside the element, which the children go into. */
export interface ContentSpec {
    readonly tag: string;
    readonly widgetProps: Readonly<Record<string, unknown>>;
    readonly orientation: Orientation;
    readonly widget: WidgetFacts;
    /** The prop that styles it — `ScrollView`'s `contentContainerStyle`. */
    readonly styleProp: string | null;
    /**
     * Its class-list prop.
     *
     * `contentContainerClassName` is NativeWind's spelling, not React Native's, and
     * it is carried because ADR 0032 § 12 replaces NativeWind rather than supporting
     * it: the class VOCABULARY is consumed, so the prop that carries it for the
     * inner node has to be too. Without it the one node a class list cannot reach is
     * the one that holds every child.
     */
    readonly classNameProp: string | null;
    /**
     * The slot this node declares to the OUTER node, when the outer node is slotted.
     *
     * Absent means the outer node's default slot, which is what every `single`-child
     * container has. `ImageBackground` is the one primitive that needs it: its outer
     * node is a `Gtk.Overlay`, whose two slots are not interchangeable — `child`
     * holds the widget the overlay SIZES ITSELF TO and `add_overlay` stacks widgets
     * on top of it.
     */
    readonly slot?: string;
}

export interface PrimitiveSpec {
    /** GType name, which is the tag the host takes. */
    readonly tag: string;
    /** Properties every instance carries before a single prop is read. */
    readonly widgetProps: Readonly<Record<string, unknown>>;
    /** GTK CSS classes every instance carries — `flat` on a `Pressable`. */
    readonly cssClasses: readonly string[];
    /** The element's own orientation, for the intents that need it. */
    readonly orientation: Orientation;
    readonly widget: WidgetFacts;
    /** Where a text child goes, or null when text under this primitive is refused. */
    readonly textSink: string | null;
    /** Prop name → destination. One or more routes; several is `horizontal`'s shape. */
    readonly props: Readonly<Record<string, PropRoute | readonly PropRoute[]>>;
    readonly content?: ContentSpec;
    /**
     * The element becomes THIS widget when one of its children is absolutely
     * positioned, and its own children move into `content`.
     *
     * Triggered by the CHILD, never by the element (ADR 0032 § 3: `absolute` occurs
     * five times in the measured application and always on the child).
     */
    readonly overlayOnAbsoluteChild?: { readonly tag: string; readonly slot: string };
    /** One React Native prop, two GTK widgets. `TextInput`'s `multiline`. */
    readonly switchOn?: { readonly prop: string; readonly whenTrue: PrimitiveSpec };
    /**
     * A node BEHIND the children, which takes no children of its own.
     *
     * `ImageBackground` is the whole of this field, and the shape is forced rather
     * than chosen. React Native's own `ImageBackground` is a `View` whose first child
     * is an absolutely positioned `Image` — which is exactly the `overlayOnAbsoluteChild`
     * switch above. But MEASURED on gtk 4.22.4: a `Gtk.Overlay` paints every overlay
     * child ABOVE its main child, so a picture in the overlay slot covers the
     * children instead of sitting behind them. The picture therefore has to be the
     * MAIN child, and the children move into the overlay slot — which is a third
     * node, not a variation of the second.
     */
    readonly backdrop?: ContentSpec;
    /**
     * This primitive answers for no `style` and no `className`, and why.
     *
     * `Button` only. React Native's `Button` takes neither — its documented styling
     * story is "you cannot", and GTK agrees: an `Adw`-themed button is styled by the
     * theme and by its own classes (`suggested-action`), not by a caller's utility
     * list. Refusing here rather than in a component's prop type is what makes the
     * refusal reach a JavaScript caller and both L3s, and it is a REFUSAL rather than
     * a silent drop for the reason every other one in this file is.
     */
    readonly refusesStyle?: string;
    /**
     * What a `ref` on this primitive receives, when it is not the widget.
     *
     * `TextInput` only, and it is React Native's own rule rather than a convenience:
     * `TextInput` is a CLASS there, so `useRef<TextInput>(null)` is ordinary code and
     * `ref.current.focus()` is documented API. Handing back the bare `Gtk.Widget`
     * type-checked as `unknown` and answered `undefined is not a function` at the
     * call — the shape this whole layer refuses to ship for props, arriving through
     * the one channel that had no table.
     */
    readonly handle?: HandleKind;
}

/**
 * A wrapping box, and the two defaults that stop `Gtk.FlowBox` from being one.
 *
 * MEASURED on gtk 4.22.4, and both are the silent kind:
 *
 *   `max-children-per-line` defaults to **7**. A `flex-wrap` container would put
 *   seven children on a line and wrap the eighth however much room was left — a
 *   layout that is plausible on screen and wrong. There is no "no limit" spelling:
 *   `0` is OUT OF RANGE for the `guint` (a GLib-GObject-CRITICAL, and the property
 *   keeps its old value), and writing G_MAXUINT stores 65535.
 *
 *   This table therefore pinned 65535, and **that correction is not made here any
 *   more** — the cap is kept equal to the child count by `@gjsify/gtk-host`, the
 *   only layer that knows the count (`ChildPolicy`'s `perLineCap`). A line can
 *   never hold more children than exist, so the count forbids nothing 65535
 *   allowed, and two things stop costing what they did.
 *
 *   The MEASURE, whose cost is quadratic in the cap rather than in the children.
 *   One `Gtk.FlowBox` holding TWO children, per measure, GTK 4.22.4: 0.018 ms at
 *   64, 19.3 ms at 8192, 421.8 ms at 32768, **1517.9 ms at 65535**. An
 *   application with five two-chip rows froze its main loop for 12.7 s at
 *   startup, and every screenshot of it looked right.
 *
 *   The NATURAL WIDTH, which carries `column-spacing × (cap - 1)` of gaps that do
 *   not exist. 12 children, `column-spacing: 8`: 683 px at a cap of 12 and
 *   **524 867 px** at 65535, the difference exactly 8 × 65534 in all five caps
 *   measured. The old note here said the natural width was "unaffected by it —
 *   measured identical for 12 children at 12, 1024 and 65535", and that holds
 *   ONLY AT `column-spacing: 0`. Which is the measurement this table was least
 *   entitled to make, because the same table routes every `gap-*` into
 *   `column-spacing` (below) — a wrapping row with a gap is the case it creates,
 *   and it is the case the claim excluded.
 *
 *   `selection-mode` defaults to SINGLE. A `Gtk.FlowBox` is a selection widget
 *   before it is a layout one, so a plain `<View>` would gain a focus ring and a
 *   selected row from a click that a flexbox container ignores.
 *
 * `orientation` needs no correction and is not listed: it means the same thing on
 * both classes (measured — HORIZONTAL fills along x and wraps into rows, VERTICAL
 * fills along y and wraps into columns), so `flex-row`/`flex-col` survive the swap
 * through the ordinary property route.
 */
const WRAPS_INTO_FLOW_BOX: WrapsInto = {
    tag: 'GtkFlowBox',
    // `accessible-role` joins the two corrections above for the same reason they
    // are here, and it is MEASURED: a `Gtk.FlowBox` reports role GRID and a
    // `Gtk.Box` reports GENERIC (gtk 4.22.4). So `flex-wrap` on a plain `<View>`
    // announced a LAYOUT container to a screen reader as a data grid — a widget
    // swap made for a styling reason, changing what the element IS to assistive
    // technology, silently. GENERIC is what the unwrapped element already was.
    widgetProps: { 'selection-mode': 'none', 'accessible-role': 'generic' },
};

const BOX: WidgetFacts = { box: true, alignsText: false, wrapsInto: WRAPS_INTO_FLOW_BOX };
const LEAF: WidgetFacts = { box: false, alignsText: false, wrapsInto: null };
const TEXT: WidgetFacts = { box: false, alignsText: true, wrapsInto: null };

/**
 * The two accessible PROPERTIES this layer writes, and the GValue GTK reads each
 * out of. Every `as` in this file is measured — `primitives/accessibility.ts`
 * carries the matrix and the two members whose type is not the one GTK's own
 * documentation reads like.
 */
const LABEL_ATTRIBUTE: AccessibleAttribute = { set: 'property', name: 'label', as: 'string' };
const HELP_TEXT_ATTRIBUTE: AccessibleAttribute = { set: 'property', name: 'help-text', as: 'string' };

/**
 * `accessibilityState`'s five keys → `Gtk.AccessibleState`, and all five land.
 *
 * This is the one place React Native's accessibility surface is genuinely
 * three-valued, and GTK is too: `checked` accepts `'mixed'` and GTK has
 * `Gtk.AccessibleTristate.MIXED`, so the half-checked checkbox has an exact member
 * rather than a rounded-off boolean. `selected` and `expanded` are booleans in
 * React Native and tristates in GTK, which is a widening and loses nothing.
 *
 * `disabled` is worth one caution, because GTK writes this attribute too: MEASURED
 * (gtk 4.22.4) `widget.sensitive = false` puts DISABLED into the set on a widget
 * that never had it, and an explicit write leaves `sensitive` alone. So the prop
 * DESCRIBES the element to a screen reader and does not disable it — which is
 * exactly what it does in React Native, where `disabled` and
 * `accessibilityState.disabled` are also two separate things an application sets
 * together.
 */
const ACCESSIBLE_STATES: Readonly<Record<string, AccessibleAttribute>> = {
    disabled: { set: 'state', name: 'disabled', as: 'boolean' },
    busy: { set: 'state', name: 'busy', as: 'boolean' },
    checked: { set: 'state', name: 'checked', as: 'tristate' },
    selected: { set: 'state', name: 'selected', as: 'tristate' },
    expanded: { set: 'state', name: 'expanded', as: 'tristate' },
};

/** `accessible` — recognised, without effect, and the prop that does what it asks. */
const ACCESSIBLE_IS_THE_DESKTOP_DEFAULT =
    'asks for two things, and GTK already answers one: every GTK widget is in the accessibility tree, so “this element is an accessibility element” is the desktop default rather than an opt-in. The other thing it asks — merge my whole subtree into ONE accessible node, which is what `accessible={true}` does on iOS — GTK has no mechanism for, and a desktop screen reader navigates the widget tree it is given. To take an element OUT of that tree, set `accessibilityRole="none"`: it is the one prop that writes `Gtk.Accessible:accessible-role`, and two props writing one property is the silent-drop shape this table refuses by name';

/**
 * React Native's `accessibilityRole` → `Gtk.AccessibleRole`, and why it is a
 * PROPERTY route while its four siblings are not.
 *
 * The whole accessibility set used to be refused with one sentence: GTK carries
 * accessibility through `Gtk.Accessible.update_property()`, an imperative call
 * rather than a widget property. That is true of `label`, `help-text` and the
 * states — see `primitives/accessibility.ts`, which expresses them as a route
 * anyway, the way `accessibilityLiveRegion` already expressed `announce()`. It is
 * NOT true of the role, and the received wisdom that it is has a specific shape
 * worth naming: `Gtk.Accessible:accessible-role` is widely described as
 * construct-only, which is why an application holding a finished widget through a
 * ref cannot set it and has to drop the prop.
 *
 * MEASURED on gtk 4.22.4 / gjs 1.88.1, on all eight widget classes this table
 * builds: the ParamSpec is `READABLE|WRITABLE` with no `CONSTRUCT_ONLY`, and a
 * post-construction write STICKS — `new Gtk.Box()` reads GENERIC, an assignment
 * of BUTTON reads back BUTTON, and `Gtk.test_accessible_has_role` agrees. This
 * repo already measures the same fact from the other side: `gtk-host`'s
 * `props.spec.ts` asserts `GtkButton`'s construct-only set is exactly
 * `['css-name']`. So the role is an ordinary property, and being one is strictly
 * better than an imperative call — the host coerces the nick, replays it through
 * `materialize`, and would rebuild the widget on a change if a future GTK made it
 * construct-only after all.
 *
 * The MAPPING is not one-to-one and is not derived from the spelling. React
 * Native's list is Android's and iOS's traits merged; GTK's 85 roles are ARIA's.
 * Where a React Native name is one platform's spelling of a portable idea it is
 * mapped to that idea (`tabbar` → `tab-list`, `dropdownlist` → `combo-box`,
 * `viewgroup` → the `generic` a `Gtk.Box` already reports); where it names a
 * platform mechanism rather than a role it is refused BY NAME below.
 */
const ACCESSIBLE_ROLES: Readonly<Record<string, string>> = {
    none: 'none',
    button: 'button',
    togglebutton: 'toggle-button',
    link: 'link',
    // React Native documents this as "treated as a search FIELD", which is ARIA's
    // `searchbox`. GTK also has `search`, and that is ARIA's search LANDMARK — a
    // region of the page, not the entry in it.
    search: 'search-box',
    image: 'img',
    // An image that is also a button. GTK has no combined role and the button half
    // is the one a screen reader has to announce; the image half is decoration.
    imagebutton: 'button',
    text: 'label',
    adjustable: 'slider',
    header: 'heading',
    alert: 'alert',
    checkbox: 'checkbox',
    combobox: 'combo-box',
    dropdownlist: 'combo-box',
    menu: 'menu',
    menubar: 'menu-bar',
    menuitem: 'menu-item',
    iconmenu: 'menu',
    progressbar: 'progress-bar',
    radio: 'radio',
    radiogroup: 'radio-group',
    scrollbar: 'scrollbar',
    spinbutton: 'spin-button',
    switch: 'switch',
    tab: 'tab',
    tablist: 'tab-list',
    tabbar: 'tab-list',
    timer: 'timer',
    list: 'list',
    toolbar: 'toolbar',
    grid: 'grid',
    viewgroup: 'generic',
    webview: 'document',
};

/**
 * Real React Native role spellings with no GTK member, each answered by name.
 *
 * EVERY ROLE A REASON NAMES IS ONE {@link ACCESSIBLE_ROLES} MAPS, and that is a
 * vector rather than a convention (`primitives.spec.ts`, "advises only values it
 * would accept"). Three of these used to point at ARIA spellings GTK does have —
 * `group`, `status`, `navigation` — which this layer nonetheless refuses, because
 * the KEYS here are React Native's 40 `accessibilityRole` names and those three are
 * not among them: they live on RN's separate ARIA-shaped `role` prop, which is not
 * a table key at all. A refusal whose advice is refused in turn is worse than the
 * generic "Known: …" it was written to replace.
 */
const ACCESSIBLE_ROLES_REFUSED: Readonly<Record<string, string>> = {
    keyboardkey:
        'describes a key of an on-screen keyboard, and neither GTK nor ARIA has a role for one — a desktop keyboard is the input method, not a widget in your tree. If you are building a keypad, the keys are `accessibilityRole="button"`; the container needs no role, because React Native has no spelling for ARIA’s `group` and a plain `<View>` is already the `generic` a screen reader walks through',
    summary:
        'is an iOS trait for the one element VoiceOver reads first when an app launches, and GTK has no counterpart because a desktop screen reader announces the focused widget instead. Put the text in the window title, or carry it as `accessibilityLabel` on the element it summarises — React Native’s role list has no `status`, so there is no role to give it here',
    scrollview:
        'names Android’s ScrollView class rather than a role, and this layer already answers the idea: `<ScrollView>` becomes a `Gtk.ScrolledWindow`, whose accessibility a screen reader reads from the widget itself. Drop the prop',
    horizontalscrollview: 'names an Android class, like `scrollview` — use `<ScrollView horizontal>` and drop the prop',
    drawerlayout:
        'names Android’s DrawerLayout. The desktop pattern survives the component (`Adw.OverlaySplitView`), but it is a widget rather than a role — drop the prop and give the drawer an `accessibilityLabel`; React Native’s role list has no `navigation`, and the widget carries the rest',
    slidingdrawer: 'names a deprecated Android class — see `drawerlayout`',
    pager: 'names Android’s ViewPager. GTK’s counterpart is a `Gtk.Stack`, and the role a screen reader wants on it is `tablist` when it has visible switchers and nothing at all when it does not',
};

const NO_ON_LAYOUT =
    'GTK reports its allocation through `Gtk.Widget.vfunc_size_allocate`, a SUBCLASS override rather than a signal, so there is no handler to bind. `useWindowDimensions` (tier P2) is the window-level answer';
/**
 * `accessibilityLiveRegion` — and the reason is NOT "GTK4 has no property".
 *
 * GTK has had `Gtk.Accessible.announce(message, priority)` since 4.14 (MEASURED on
 * gtk 4.22.4: the method is on the `Gtk.Accessible` interface, so it is on every
 * widget, and it takes LOW/MEDIUM/HIGH). What it does NOT have is the declaration
 * React Native's prop is — a flag that makes the accessibility layer watch this
 * element's content and speak the change. `announce` is imperative: the caller
 * supplies the moment and the message.
 *
 * So the prop is answerable exactly where this layer knows both, which is `Text`
 * and nowhere else: a `Gtk.Label`'s content IS a property, so `notify::label` is the
 * moment and `label` is the message ({@link AnnounceRoute}). A `View`'s content is a
 * subtree, and GTK emits nothing when a subtree changes — there is no
 * `notify::children`, and walking the tree on every frame to diff it is a screen
 * reader's job, not a view layer's.
 */
const NO_LIVE_REGION =
    'declares that a screen reader should speak this element when its CONTENT changes. GTK has the announcement — `Gtk.Accessible.announce(message, priority)` since 4.14 — but not the watch: it is an imperative call, and this element’s content is a SUBTREE, which GTK emits no signal for. `<Text>` answers this prop, because its content is one property (`Gtk.Label:label`) and so is both the moment and the message. Elsewhere, call `announce()` on the widget through a ref when you change the content';
const ONE_WIDGET_NAME =
    'would write `Gtk.Widget:name`, and so does `testID`. Two props for one property is the silent-drop shape the host refuses by name (`signalTaken`), so this layer picks one: use `testID`';

/**
 * Props every primitive answers for the same way.
 *
 * Spread into each row rather than consulted separately, so one lookup answers
 * every prop and a row can OVERRIDE a common answer — which `Text` does for
 * `onPress`, because "wrap it in a Pressable" is better advice than the generic
 * refusal.
 */
const COMMON: Readonly<Record<string, PropRoute | readonly PropRoute[]>> = {
    // `Gtk.Widget:name` is what the inspector shows and what GTK CSS `#name`
    // selects, which is as close to a test handle as GTK has.
    testID: { to: 'property', names: ['name'], as: 'string' },
    id: { to: 'refused', why: ONE_WIDGET_NAME },
    nativeID: { to: 'refused', why: ONE_WIDGET_NAME },
    onLayout: { to: 'refused', why: NO_ON_LAYOUT },
    accessible: { to: 'ignored', why: ACCESSIBLE_IS_THE_DESKTOP_DEFAULT },
    // The accessible NAME. `Gtk.AccessibleProperty.LABEL` is what AT-SPI reports as
    // a widget's name, which is what a screen reader says when the widget takes
    // focus — the same job React Native's prop has.
    accessibilityLabel: { to: 'accessible', from: 'value', attribute: LABEL_ATTRIBUTE },
    accessibilityRole: {
        to: 'property',
        names: ['accessible-role'],
        as: 'map',
        map: ACCESSIBLE_ROLES,
        refuses: ACCESSIBLE_ROLES_REFUSED,
    },
    // HELP_TEXT and not DESCRIPTION, for two reasons that point the same way.
    // React Native's hint says what HAPPENS when you act on the element, which is
    // help text rather than a description of it; and `Gtk.Picture:alternative-text`
    // — the `alt` prop on `<Image>` — writes DESCRIPTION (measured), so routing the
    // hint there would put two props on one attribute, the silent-drop shape this
    // table refuses by name elsewhere. HELP_TEXT needs GTK 4.16.
    accessibilityHint: { to: 'accessible', from: 'value', attribute: HELP_TEXT_ATTRIBUTE },
    accessibilityState: { to: 'accessible', from: 'members', members: ACCESSIBLE_STATES, refuses: {} },
    accessibilityLiveRegion: { to: 'refused', why: NO_LIVE_REGION },
};

/** `pointerEvents` — `Gtk.Widget:can-target` answers two of its four values exactly. */
const POINTER_EVENTS: PropRoute = {
    to: 'property',
    names: ['can-target'],
    as: 'map',
    // `box-none` and `box-only` split hit-testing between a widget and its subtree.
    // GTK's `can-target` is one boolean for the widget AND everything under it, so
    // the two split values have no expression at all and are refused by the map's
    // own "known values" message rather than approximated to the nearest boolean.
    map: { auto: true, none: false },
};

const TEXT_INPUT_COMMON: Readonly<Record<string, PropRoute | readonly PropRoute[]>> = {
    ...COMMON,
    multiline: { to: 'ignored', why: 'it chose the widget; it is not also a property' },
    editable: { to: 'property', names: ['editable'], as: 'boolean' },
    // Both `Gtk.Entry` and `Gtk.TextView` install `input-purpose` (measured), which
    // is the one keyboard-ish hint that survives onto a desktop: it is what tells
    // an on-screen keyboard AND an input method what kind of text this is.
    keyboardType: {
        to: 'property',
        names: ['input-purpose'],
        as: 'map',
        map: {
            default: 'free-form',
            'email-address': 'email',
            'phone-pad': 'phone',
            'number-pad': 'digits',
            numeric: 'number',
            'decimal-pad': 'number',
            url: 'url',
        },
    },
    autoFocus: {
        to: 'refused',
        why: 'focus is `Gtk.Widget.grab_focus()`, which only works once the widget is mapped — an imperative call at a moment this layer does not own. Call it from a ref in an effect',
    },
    onFocus: {
        to: 'refused',
        why: 'focus arrives through a `Gtk.EventControllerFocus`, a controller rather than a signal on the widget, so it is not a prop this layer can route',
    },
    onBlur: { to: 'refused', why: 'see `onFocus` — the same controller' },
    returnKeyType: { to: 'ignored', why: 'a desktop keyboard has one Return key and no label to change' },
    autoCapitalize: {
        to: 'ignored',
        why: 'an on-screen keyboard behaviour; a hardware keyboard has no shift state to preset',
    },
    autoCorrect: { to: 'ignored', why: 'an on-screen keyboard behaviour' },
    keyboardAppearance: { to: 'ignored', why: 'there is no on-screen keyboard to theme' },
    // THE THREE PROPS WITH NO ADDRESSEE, written down once here rather than decided
    // again in every application. Each one names a service on the other platform —
    // an autofill provider, an on-screen keyboard — and a GTK desktop runs neither.
    // `ignored` and not `refused` for the reason `autoCapitalize` above is: they
    // arrive on perfectly ordinary React Native code that the author cannot rewrite
    // into something a desktop would honour, so throwing would refuse a correct
    // program. The DECLARED no-op is what keeps "GTK has no such service" apart from
    // "the table forgot this name".
    autoComplete: {
        to: 'ignored',
        why: 'is Android’s autofill hint, and there is no autofill service on a GTK desktop to hint to — a password manager fills a field through the accessibility bus or a paste, neither of which the widget declares anything for. `keyboardType` is the one hint that does land: it writes `Gtk.Entry:input-purpose`, which an input method reads',
    },
    textContentType: {
        to: 'ignored',
        why: 'is `autoComplete`’s iOS spelling and has the same absent addressee. Note `Gtk.Accessible` does carry an `autocomplete` PROPERTY, and it is a different thing: it describes a widget that completes its own text (a combo box), not a system that fills it in',
    },
    submitBehavior: {
        to: 'ignored',
        why: 'chooses what the Return key does, and each GTK widget has exactly one answer with nothing to select between: a `Gtk.Entry` always emits `activate` (which is `onSubmitEditing`) and can never insert a newline, and a `Gtk.TextView` always inserts a newline and never submits — which is why `onSubmitEditing` is refused on a multiline input. `multiline` is the prop that picks the behaviour, because it picks the widget',
    },
};

/**
 * `TextInput` with `multiline`: a different widget with a NARROWER prop surface,
 * and the narrowing is measured rather than chosen.
 *
 * `Gtk.TextView` installs 61 properties and `text` is not one of them — its content
 * lives in a `Gtk.TextBuffer`, an OBJECT, so `value` has no property to become and
 * cannot be expressed as data at all. Neither can `placeholder-text`, `max-length`
 * or `visibility`, none of which `Gtk.TextView` has. Each of those is therefore a
 * refusal that names the widget, which is the difference between "this layer is
 * incomplete" and "you asked GTK for something that is not there".
 */
const MULTILINE_BUFFER =
    '`Gtk.TextView` keeps its content in a `Gtk.TextBuffer` rather than in a property (measured: 61 properties, no `text`), so there is nothing for this layer to set as data. Drop `multiline` for a `Gtk.Entry`, or reach the buffer through a ref';

const TEXT_INPUT_MULTILINE: PrimitiveSpec = {
    tag: 'GtkTextView',
    // React Native's multiline input wraps; `Gtk.TextView` defaults to
    // `wrap-mode: none` and scrolls sideways forever instead. Written out for the
    // same reason `Text` writes `wrap: true`: the platforms disagree on the default
    // and an invisible disagreement is a bug report about horizontal scrolling.
    widgetProps: { 'wrap-mode': 'word-char' },
    cssClasses: [],
    orientation: 'vertical',
    widget: LEAF,
    textSink: null,
    handle: 'text-input',
    props: {
        ...TEXT_INPUT_COMMON,
        value: { to: 'refused', why: MULTILINE_BUFFER },
        defaultValue: { to: 'refused', why: MULTILINE_BUFFER },
        onChangeText: { to: 'refused', why: MULTILINE_BUFFER },
        placeholder: {
            to: 'refused',
            why: '`Gtk.TextView` installs no `placeholder-text` (measured); the Adwaita idiom is a label above the field',
        },
        maxLength: {
            to: 'refused',
            why: '`Gtk.TextView` installs no `max-length` (measured) — the limit belongs to the buffer',
        },
        secureTextEntry: {
            to: 'refused',
            why: '`Gtk.TextView` installs no `visibility` (measured), and a multiline password field is not a thing a desktop offers',
        },
        onSubmitEditing: {
            to: 'refused',
            why: 'Return inserts a newline in a multiline field; there is nothing to submit',
        },
    },
};

/**
 * `resizeMode` → `Gtk.ContentFit`, and one of the five has no member at all.
 *
 * MEASURED on gtk 4.22.4: `GtkContentFit` is FILL=0, CONTAIN=1, COVER=2,
 * SCALE_DOWN=3 — four members, and `repeat` is not among them. Tiling a paintable is
 * a `Gdk.Paintable` implementation, not a property of the widget that draws one, so
 * `repeat` is absent from this map and refused by name rather than promoted to the
 * nearest fit — which would silently render one stretched copy of a texture the
 * author asked to be tiled.
 *
 * `center` → SCALE_DOWN is the mapping that reads as a guess and is not: React
 * Native's `center` is "centre the image, and scale it DOWN if it does not fit",
 * which is GTK's own definition of SCALE_DOWN.
 */
const CONTENT_FIT: Readonly<Record<string, string>> = {
    cover: 'cover',
    contain: 'contain',
    stretch: 'fill',
    center: 'scale-down',
};

/**
 * Props of `Image` that describe a LOADER this layer does not own.
 *
 * MEASURED: `Gtk.Picture` emits no signals at all (`GObject.signal_list_ids` on its
 * GType is empty), so `onLoad`, `onError`, `onLoadStart` and `onLoadEnd` have nothing
 * to bind — a `Gtk.Picture` is handed a file or a paintable and draws it, and it
 * reports neither progress nor failure. Setting a file that does not exist leaves
 * `paintable` null with NO diagnostic (measured), which is exactly why these are
 * refusals: a load callback that never fires would make a missing image
 * indistinguishable from a slow one, for ever.
 */
const NO_IMAGE_LOAD_EVENTS =
    'is a load event, and `Gtk.Picture` emits NO signals at all (measured: its GType lists none) — it is handed a file or a paintable and draws it, reporting neither progress nor failure. A missing file leaves `paintable` null with no diagnostic, so a callback that never fires would hide exactly the case it exists to report. Load the bytes yourself and set `paintable` through a ref';

/** Image props that are a per-pixel effect GTK draws in a shader, not a widget property. */
const NO_IMAGE_FILTER =
    'is a per-pixel effect. GTK composites a `Gdk.Paintable` and has no filter property on the widget that draws it — the counterpart is a `Gsk` render node or a `Gtk.Snapshot` subclass, which is a widget of its own rather than a prop on this one';

/**
 * `activeOpacity` / `underlayColor` — the pressed style, which is CSS here.
 *
 * ADR 0032 § 7 is the whole answer: the press state is the GTK CSS `:active`
 * pseudo-class, and `active:opacity-70` / `active:bg-emphasis` reach it through the
 * same variant mechanism every other utility uses — GTK animates the state itself,
 * with no re-render at all. Honouring these two props instead would put a colour and
 * an opacity into the styling path that did NOT come from the project's token scale,
 * which is the one thing ADR 0032 § 3 says the vocabulary's values may not do.
 */
const PRESSED_STYLE_IS_CSS = (utility: string): string =>
    `sets the pressed appearance, which on GTK is the CSS \`:active\` pseudo-class rather than a prop (ADR 0032 § 7). Write \`${utility}\` — it resolves through the same variant mechanism as every other utility, reads the project's own token scale, and GTK animates it with no re-render at all`;

/**
 * Every `FlatList` prop that tunes React Native's own virtualisation.
 *
 * ADR 0032 puts the list on `Gtk.ListView` because "GTK virtualises for real", and
 * these props configure the OTHER implementation. MEASURED on gtk 4.22.4 with a
 * 500-row model in a presented 400×300 window: 205 rows were set up and bound, in
 * both arrangements tried — the numbers are `Gtk.ListView`'s own and there is no
 * property that moves them. Accepting a batch size and doing nothing with it is the
 * silent drop this layer exists to remove; accepting one and acting on it would mean
 * fighting the widget for a job it already does.
 */
const GTK_OWNS_VIRTUALISATION =
    'tunes React Native’s own virtualisation, and `Gtk.ListView` does that job itself — it creates and recycles rows through the factory as the viewport moves (measured: 205 of 500 rows set up in a 400×300 window) and installs no property that changes the batching. There is nothing for this to set';

/** Pull-to-refresh, refused in three places and for one reason. */
const PULL_TO_REFRESH =
    'is pull-to-refresh, which GTK has no idiom for and should not grow one — `RefreshControl` is `refused` in the support table for the same reason. Give the desktop build a refresh action in the header bar';

/** Props of the Touchable family that describe a phone's touch handling. */
const TOUCHABLE_COMMON: Readonly<Record<string, PropRoute | readonly PropRoute[]>> = {
    ...COMMON,
    disabled: { to: 'property', names: ['sensitive'], as: 'not' },
    onPressIn: {
        to: 'refused',
        why: 'press state is the GTK CSS `:active` pseudo-class, not React state (ADR 0032 § 7) — write `active:opacity-70` and GTK animates it with no re-render at all',
    },
    onPressOut: { to: 'refused', why: 'see `onPressIn` — `active:` is the mechanism' },
    onLongPress: {
        to: 'refused',
        why: 'a long press is a `Gtk.GestureLongPress` controller added to the widget, not a property or a signal on it, so it is not something this layer can route as data',
    },
    delayLongPress: { to: 'refused', why: 'see `onLongPress`' },
    delayPressIn: { to: 'refused', why: 'see `onPressIn` — there is no press-in event to delay' },
    delayPressOut: { to: 'refused', why: 'see `onPressIn`' },
    hitSlop: {
        to: 'refused',
        why: 'GTK hit-tests the allocation and has no way to grow it past the widget. Pad the element (`p-*`), which enlarges the real target',
    },
    pressRetentionOffset: { to: 'refused', why: 'see `hitSlop` — GTK hit-tests the allocation and nothing around it' },
    touchSoundDisabled: { to: 'ignored', why: 'an Android touch sound; a desktop button makes none' },
};

export const PRIMITIVES: Readonly<Record<string, PrimitiveSpec>> = {
    View: {
        tag: 'GtkBox',
        // THE INVERSION, and it is the single most consequential line in this file.
        // A React Native `View` is a COLUMN — `flexDirection` defaults to `'column'`
        // — and `Gtk.Box` defaults to HORIZONTAL. Every layout in a ported
        // application is wrong in the same way if this is absent, and it is wrong
        // silently: the window renders, the widgets are all there, and they are in a
        // row. `flex-row` overrides it through the ordinary `orientation` route.
        widgetProps: { orientation: 'vertical' },
        cssClasses: [],
        orientation: 'vertical',
        widget: BOX,
        // A `Gtk.Box` has no text sink (measured — `children: { kind: 'none' }` is
        // `Gtk.Label`'s, and a box declares no sink at all), so bare text under a
        // `<View>` is refused by the host naming the tag. That refusal is correct
        // and it is React Native's own rule too: text belongs inside a `<Text>`.
        textSink: null,
        overlayOnAbsoluteChild: { tag: 'GtkOverlay', slot: 'overlay' },
        props: { ...COMMON, pointerEvents: POINTER_EVENTS },
    },

    Text: {
        tag: 'GtkLabel',
        // THREE DEFAULTS `Gtk.Label` disagrees with React Native about, and the whole
        // set — including the ones that AGREE — is enumerated in `defaults.ts`, which
        // a spec holds against the installed GTK in both directions.
        //
        //   wrap    React Native's `Text` wraps; a `Gtk.Label` does not, and a long
        //           line forces the window wider instead.
        //   xalign  `Gtk.Label` CENTRES. React Native's text alignment is unset by
        //           default, which means the script's natural edge — left in LTR.
        //   yalign  the same, one axis over: it centres vertically wherever the label
        //           is given more height than its text.
        //
        // MEASURED as a position rather than as a property, because a property read
        // does not say what a reader sees: a label allocated 400×100 reports
        // `get_layout_offsets()` = (193, 41) with GTK's defaults and (0, 0) with these
        // two. Found by porting a 25-route application and looking at it — every
        // string on every screen was centred, and nothing reported it.
        widgetProps: { wrap: true, xalign: 0, yalign: 0 },
        cssClasses: [],
        orientation: 'vertical',
        widget: TEXT,
        textSink: 'label',
        props: {
            ...COMMON,
            // `lines` alone does nothing: `Gtk.Label` honours it only while the
            // label BOTH wraps and ellipsizes (the property's own documentation, and
            // measured — a `lines: 2` label with `ellipsize: none` renders all its
            // lines). So the route carries the two companions the value needs.
            numberOfLines: {
                to: 'property',
                names: ['lines'],
                as: 'int',
                also: { ellipsize: 'end', wrap: true },
            },
            ellipsizeMode: {
                to: 'property',
                names: ['ellipsize'],
                as: 'map',
                // `PangoEllipsizeMode` is NONE, START, MIDDLE, END (measured). React
                // Native's `clip` — truncate with no ellipsis — has no member here,
                // so it is absent from the map and refused by name rather than
                // silently promoted to `end`, which would add a character the author
                // asked not to have.
                map: { head: 'start', middle: 'middle', tail: 'end' },
            },
            selectable: { to: 'property', names: ['selectable'], as: 'boolean' },
            // THE ONE PRIMITIVE THAT CAN ANSWER IT. `notify::label` is the moment the
            // content changed and `label` is what changed to — both facts a live
            // region needs, on one widget property. `polite` → MEDIUM and
            // `assertive` → HIGH are GTK's own definitions of ARIA's two levels
            // (medium: "spoken at the next opportunity, such as at the end of the
            // current sentence"; high: "spoken immediately", with GTK's own
            // documentation warning against it), not a guess at a scale.
            accessibilityLiveRegion: {
                to: 'announce',
                signal: 'notify::label',
                read: 'label',
                map: { none: null, polite: 'medium', assertive: 'high' },
            },
            onPress: {
                to: 'refused',
                why: 'a `Gtk.Label` emits no `clicked` (measured: `activate-current-link`, `activate-link`, `copy-clipboard`, `move-cursor` and nothing else). Wrap it in a `<Pressable>`, which is a real `Gtk.Button`',
            },
            allowFontScaling: {
                to: 'ignored',
                why: 'text scaling is a desktop-wide GNOME setting, not a per-label opt-in',
            },
            maxFontSizeMultiplier: { to: 'ignored', why: 'see `allowFontScaling`' },
            adjustsFontSizeToFit: {
                to: 'refused',
                why: 'GTK has no shrink-to-fit text; a label ellipsizes or wraps. Use `numberOfLines` with `ellipsizeMode`',
            },
        },
    },

    Pressable: {
        tag: 'GtkButton',
        widgetProps: {},
        // `flat` is Adwaita's own class for a button with no frame and no
        // background until it is hovered, which is what a React Native `Pressable`
        // looks like. Set as a CSS CLASS rather than `has-frame: false`: the class
        // is what an application's own stylesheet and the GTK inspector both
        // recognise, and it composes with a `bg-*` utility instead of fighting it.
        cssClasses: ['flat'],
        orientation: 'vertical',
        widget: LEAF,
        textSink: 'label',
        props: {
            ...COMMON,
            pointerEvents: POINTER_EVENTS,
            onPress: { to: 'event', signal: 'clicked' },
            // ADR 0032 § 7: the press STATE is `:active` in GTK CSS, which is why
            // there is no `onPressIn`/`onPressOut` route and no React state here.
            // GTK animates the state itself and nothing reaches the reconciler when
            // a finger goes down.
            onPressIn: {
                to: 'refused',
                why: 'press state is the GTK CSS `:active` pseudo-class, not React state (ADR 0032 § 7) — write `active:opacity-70` and GTK animates it with no re-render at all',
            },
            onPressOut: { to: 'refused', why: 'see `onPressIn` — `active:` is the mechanism' },
            onLongPress: {
                to: 'refused',
                why: 'a long press is a `Gtk.GestureLongPress` controller added to the widget, not a property or a signal on it, so it is not something this layer can route as data',
            },
            delayLongPress: { to: 'refused', why: 'see `onLongPress`' },
            hitSlop: {
                to: 'refused',
                why: 'GTK hit-tests the allocation and has no way to grow it past the widget. Pad the button (`p-*`), which enlarges the real target',
            },
            android_ripple: { to: 'ignored', why: 'an Android-only ripple; Adwaita has its own press feedback' },
            disabled: { to: 'property', names: ['sensitive'], as: 'not' },
        },
    },

    ScrollView: {
        tag: 'GtkScrolledWindow',
        // A React Native `ScrollView` scrolls on ONE axis — vertical unless
        // `horizontal` — while a `Gtk.ScrolledWindow` scrolls on both by default and
        // therefore never propagates a natural size on either. Pinning the unused
        // axis to `never` is what makes a vertical scroller as wide as its content
        // instead of as wide as it is given.
        widgetProps: { 'hscrollbar-policy': 'never' },
        cssClasses: [],
        orientation: 'vertical',
        // The scrolled window is NOT a box: it has no `orientation` and no
        // `spacing`, so `items-*`/`gap-*` written on `style` are refused naming the
        // primitive. They belong on `contentContainerStyle`, which lands on a real
        // box — and that is React Native's own rule, not a GTK quirk.
        widget: LEAF,
        textSink: null,
        content: {
            tag: 'GtkBox',
            widgetProps: { orientation: 'vertical' },
            orientation: 'vertical',
            widget: BOX,
            styleProp: 'contentContainerStyle',
            classNameProp: 'contentContainerClassName',
        },
        props: {
            ...COMMON,
            horizontal: [
                {
                    to: 'property',
                    on: 'content',
                    names: ['orientation'],
                    as: 'map',
                    map: { true: 'horizontal', false: 'vertical' },
                },
                {
                    to: 'property',
                    on: 'outer',
                    names: ['hscrollbar-policy'],
                    as: 'map',
                    map: { true: 'automatic', false: 'never' },
                },
                {
                    to: 'property',
                    on: 'outer',
                    names: ['vscrollbar-policy'],
                    as: 'map',
                    map: { true: 'never', false: 'automatic' },
                },
            ],
            // `GtkPolicyType.EXTERNAL` is the exact counterpart and the reason this
            // is not a refusal: the widget still scrolls, it just draws no scrollbar
            // of its own. `never` would have been the wrong guess — it stops the
            // scrolling too.
            showsVerticalScrollIndicator: {
                to: 'property',
                names: ['vscrollbar-policy'],
                as: 'map',
                map: { true: 'automatic', false: 'external' },
            },
            showsHorizontalScrollIndicator: {
                to: 'property',
                names: ['hscrollbar-policy'],
                as: 'map',
                map: { true: 'automatic', false: 'external' },
            },
            scrollEnabled: {
                to: 'refused',
                why: 'a `Gtk.ScrolledWindow` has no switch that stops scrolling — setting both policies to `never` hides the bars AND clamps the child, which is a different thing. Render the content without the ScrollView when it must not scroll',
            },
            onScroll: {
                to: 'refused',
                why: 'GTK reports scroll position through the `Gtk.Adjustment` objects behind `hadjustment`/`vadjustment` — `notify::value` on an adjustment, not a signal on the scrolled window — so there is no prop to route. Reach the adjustment through a ref',
            },
            scrollEventThrottle: { to: 'refused', why: 'see `onScroll`' },
            refreshControl: {
                to: 'refused',
                why: 'GTK has no pull-to-refresh idiom and `RefreshControl` is `refused` in the support table for that reason. Give the desktop build a refresh action',
            },
            keyboardShouldPersistTaps: { to: 'ignored', why: 'there is no on-screen keyboard to dismiss' },
            keyboardDismissMode: { to: 'ignored', why: 'see `keyboardShouldPersistTaps`' },
            // Both are read directly off the props as the CONTENT node's style set
            // (`resolveContent`), never through a route, so they never reach this
            // table's lookup at all. Listed so the "it takes:" line in an unknown-prop
            // refusal names them — a reader who mistyped `contentContainerStyles`
            // needs to see the right spelling, and the list is where they look.
            contentContainerStyle: { to: 'ignored', why: 'read directly as the content node’s style set' },
            contentContainerClassName: { to: 'ignored', why: 'read directly as the content node’s class list' },
        },
    },

    ActivityIndicator: {
        tag: 'AdwSpinner',
        widgetProps: {},
        cssClasses: [],
        orientation: 'vertical',
        widget: LEAF,
        textSink: null,
        props: {
            ...COMMON,
            // MEASURED: `Adw.Spinner` installs 36 properties and every one of them
            // is `Gtk.Widget`'s — there is no `spinning`, no `animating`, nothing
            // that stops it. It spins whenever it is mapped. So "not animating" is
            // "not shown", which is also exactly what `hidesWhenStopped` asks for,
            // and it is a mapping rather than a guess because the alternative
            // (accepting the prop and doing nothing) is the silent drop.
            animating: { to: 'property', names: ['visible'], as: 'boolean' },
            hidesWhenStopped: {
                to: 'ignored',
                why: 'a stopped `Adw.Spinner` is a hidden one here — there is no property that stops it while it is on screen (measured), so this is already the behaviour',
            },
            // Two size requests from one prop. `small`/`large` are `Gtk.IconSize`'s
            // own two steps in pixels (NORMAL 16, LARGE 32), which is the desktop's
            // scale rather than the phone's — React Native's own 20/36 are Android
            // dp and would land between GTK's steps.
            size: {
                to: 'property',
                names: ['width-request', 'height-request'],
                as: 'pixels-or-map',
                map: { small: 16, large: 32 },
            },
            // Straight into the paint half, so it goes through the same partition
            // and the same GTK-parser probe as `text-grey-700` — a bad colour is
            // refused by `StyleSheet` rather than dropped by GTK's CSS recovery.
            color: { to: 'style-property', name: 'color' },
        },
    },

    TextInput: {
        tag: 'GtkEntry',
        widgetProps: {},
        cssClasses: [],
        orientation: 'vertical',
        widget: LEAF,
        // `Gtk.Entry`'s sink is `text`, which is the SAME slot `value` writes. The
        // host records that as "one widget, one slot, two APIs"; here it means
        // `<TextInput value="a">b</TextInput>` is two authorities for one string,
        // and the resolver refuses it rather than letting whichever ran last win.
        textSink: 'text',
        handle: 'text-input',
        switchOn: { prop: 'multiline', whenTrue: TEXT_INPUT_MULTILINE },
        props: {
            ...TEXT_INPUT_COMMON,
            value: { to: 'property', names: ['text'], as: 'string' },
            defaultValue: { to: 'property', names: ['text'], as: 'string' },
            placeholder: { to: 'property', names: ['placeholder-text'], as: 'string' },
            maxLength: { to: 'property', names: ['max-length'], as: 'int' },
            secureTextEntry: { to: 'property', names: ['visibility'], as: 'not' },
            // `notify::text`, NOT `Gtk.Editable::changed`, and the difference is
            // measured rather than stylistic. `gtk_editable_set_text` is a delete
            // followed by an insert, so ONE programmatic write over existing text
            // emits `changed` TWICE — measured on gtk 4.22.4, `entry.text = 'abc'`
            // over `'xy'` gave `["", "abc"]`, an intermediate EMPTY string that a
            // controlled input would report as the user clearing the field.
            // `notify::text` gave `["abc"]`. The host additionally suppresses an
            // emission raised by its OWN property write (`signals.ts`), which
            // closes the render → set text → onChangeText → setState → render loop
            // that `changed` would open.
            //
            // That last sentence is NOT a reason to move the route, and the
            // measurement that says so is here so the question stops being reopened:
            // the host guard reaches the host's own writes and nothing else, so a
            // write the host did not make still emits `changed` twice. Measured
            // with the guard in place — `entry.set_text('pq')` over existing text
            // gave `changed` `["", "pq"]` and `notify::text` `["pq"]`. Every
            // imperative write through a ref is that path, and so is this layer's
            // own `widgets.spec.ts` vector.
            onChangeText: { to: 'event', signal: 'notify::text', read: 'text' },
            onSubmitEditing: { to: 'event', signal: 'activate' },
        },
    },

    Switch: {
        tag: 'GtkSwitch',
        widgetProps: {},
        cssClasses: [],
        orientation: 'vertical',
        widget: LEAF,
        textSink: null,
        props: {
            ...COMMON,
            value: { to: 'property', names: ['active'], as: 'boolean' },
            // `notify::active` rather than `state-set`. `state-set` runs BEFORE the
            // state changes and must return false to let the default handler
            // proceed — a handler that forgets makes the switch stick, at exit 0.
            // `notify::active` fires after the fact and cannot veto anything. The
            // host also suppresses a `notify::` raised by its OWN property write
            // (`inHostWrite()` in `signals.ts`), so a controlled `<Switch>` does not
            // re-enter its own `onValueChange`.
            onValueChange: { to: 'event', signal: 'notify::active', read: 'active' },
            disabled: { to: 'property', names: ['sensitive'], as: 'not' },
            trackColor: {
                to: 'refused',
                why: 'Adwaita paints the switch from the theme’s accent colour, and its track is a CSS `slider`/`trough` subnode rather than a property. Style it from the application stylesheet',
            },
            thumbColor: { to: 'refused', why: 'see `trackColor`' },
            ios_backgroundColor: { to: 'ignored', why: 'an iOS-only fallback colour' },
        },
    },

    // --- P2 -------------------------------------------------------------------

    Image: {
        tag: 'GtkPicture',
        // THE THIRD INVERTED DEFAULT, and it is the same shape as the other two.
        // React Native's `Image` defaults to `resizeMode="cover"`; `Gtk.Picture`
        // defaults to `content-fit: contain` (MEASURED: a fresh picture reports 1,
        // which is CONTAIN). Absent, every ported image is letterboxed instead of
        // filled — which renders, looks deliberate, and is wrong.
        widgetProps: { 'content-fit': 'cover' },
        cssClasses: [],
        orientation: 'vertical',
        widget: LEAF,
        // A `Gtk.Picture` has no text sink, so text under an `<Image>` is refused by
        // the host naming the tag. React Native's `Image` takes no children either.
        textSink: null,
        props: {
            ...COMMON,
            source: { to: 'file', property: 'file' },
            resizeMode: { to: 'property', names: ['content-fit'], as: 'map', map: CONTENT_FIT },
            // React Native 0.71's own name for the accessible description, and
            // `Gtk.Picture` is the one widget in this table that installs a property
            // for it. MEASURED (gtk 4.22.4): `alternative-text` writes
            // `Gtk.AccessibleProperty.DESCRIPTION`, not LABEL — so it and
            // `accessibilityLabel` fill DIFFERENT attributes and both can be
            // authored. The name is the label; the description is the alt text.
            alt: { to: 'property', names: ['alternative-text'], as: 'string' },
            onLoad: { to: 'refused', why: NO_IMAGE_LOAD_EVENTS },
            onLoadStart: { to: 'refused', why: NO_IMAGE_LOAD_EVENTS },
            onLoadEnd: { to: 'refused', why: NO_IMAGE_LOAD_EVENTS },
            onError: { to: 'refused', why: NO_IMAGE_LOAD_EVENTS },
            onProgress: { to: 'refused', why: NO_IMAGE_LOAD_EVENTS },
            blurRadius: { to: 'refused', why: NO_IMAGE_FILTER },
            tintColor: { to: 'refused', why: NO_IMAGE_FILTER },
            capInsets: {
                to: 'refused',
                why: 'is iOS nine-part stretching. GTK’s counterpart is a CSS `border-image` on a widget’s background, which is a different widget and a different property set',
            },
            defaultSource: {
                to: 'refused',
                why: 'is the placeholder shown while the real image loads, and `Gtk.Picture` has one file at a time with no load event to swap on (measured: it emits no signals). Render a placeholder widget beside it and remove it yourself',
            },
            loadingIndicatorSource: { to: 'refused', why: 'see `defaultSource`' },
            progressiveRenderingEnabled: { to: 'ignored', why: 'GTK decodes an image in one pass' },
            fadeDuration: {
                to: 'ignored',
                why: 'an Android cross-fade on load; there is no load event here to fade from (measured)',
            },
            resizeMethod: { to: 'ignored', why: 'an Android decoder hint' },
            resizeMultiplier: { to: 'ignored', why: 'an Android decoder hint' },
        },
    },

    ImageBackground: {
        tag: 'GtkOverlay',
        widgetProps: {},
        cssClasses: [],
        orientation: 'vertical',
        // The overlay is NOT a box: it has no `orientation` and no `spacing`
        // (MEASURED: 37 properties, neither among them), so a `gap-*` or `items-*`
        // written on `style` is refused naming the primitive and belongs on the
        // children’s own container.
        widget: LEAF,
        textSink: null,
        // The picture is the MAIN child and the children stack above it. Both halves
        // are forced by one measurement: a `Gtk.Overlay` paints every overlay child
        // ABOVE its main child, and it MEASURES only its main child (measured: a
        // 9 px main child and a 266 px overlay child gave the overlay 9 px, and
        // `set_measure_overlay(child, true)` gave it 266). So the element is sized by
        // its picture rather than by its children — the support table’s
        // `ImageBackground` limit says so, because the fix is a per-child METHOD call
        // and this layer’s placement is data naming a method the host calls.
        backdrop: {
            tag: 'GtkPicture',
            widgetProps: { 'content-fit': 'cover' },
            orientation: 'vertical',
            widget: LEAF,
            styleProp: 'imageStyle',
            classNameProp: null,
            slot: 'child',
        },
        content: {
            tag: 'GtkBox',
            widgetProps: { orientation: 'vertical' },
            orientation: 'vertical',
            widget: BOX,
            styleProp: null,
            classNameProp: null,
            slot: 'overlay',
        },
        props: {
            ...COMMON,
            pointerEvents: POINTER_EVENTS,
            source: { to: 'file', on: 'backdrop', property: 'file' },
            resizeMode: {
                to: 'property',
                on: 'backdrop',
                names: ['content-fit'],
                as: 'map',
                map: CONTENT_FIT,
            },
            alt: { to: 'property', on: 'backdrop', names: ['alternative-text'], as: 'string' },
            // Read directly as the backdrop’s style set (`resolveNode`), never through
            // this lookup. Listed so an unknown-prop refusal names the right spelling.
            imageStyle: { to: 'ignored', why: 'read directly as the picture node’s style set' },
            imageRef: {
                to: 'refused',
                why: 'hands back the inner `Image`’s instance. This element’s `ref` is the `Gtk.Overlay`; the picture is its main child and `overlay.get_child()` reaches it, so a second ref would be a second way to say the same thing',
            },
        },
    },

    // The Touchable family is the SAME widget and the same routes as `Pressable`,
    // spread from one shared record rather than copied — ADR 0032’s planning entry
    // says "the same machinery as Pressable, and nearly free once it exists", and a
    // second copy of the refusals is how that stops being true.
    TouchableOpacity: {
        tag: 'GtkButton',
        cssClasses: ['flat'],
        widgetProps: {},
        orientation: 'vertical',
        widget: LEAF,
        textSink: 'label',
        props: {
            ...TOUCHABLE_COMMON,
            pointerEvents: POINTER_EVENTS,
            onPress: { to: 'event', signal: 'clicked' },
            activeOpacity: { to: 'refused', why: PRESSED_STYLE_IS_CSS('active:opacity-70') },
        },
    },

    TouchableHighlight: {
        tag: 'GtkButton',
        cssClasses: ['flat'],
        widgetProps: {},
        orientation: 'vertical',
        widget: LEAF,
        textSink: 'label',
        props: {
            ...TOUCHABLE_COMMON,
            pointerEvents: POINTER_EVENTS,
            onPress: { to: 'event', signal: 'clicked' },
            activeOpacity: { to: 'refused', why: PRESSED_STYLE_IS_CSS('active:opacity-70') },
            underlayColor: { to: 'refused', why: PRESSED_STYLE_IS_CSS('active:bg-<token>') },
            onShowUnderlay: { to: 'refused', why: 'see `underlayColor` — there is no underlay to show' },
            onHideUnderlay: { to: 'refused', why: 'see `underlayColor`' },
        },
    },

    TouchableWithoutFeedback: {
        // A BOX, not a button, and that is the whole difference. React Native’s
        // `TouchableWithoutFeedback` has no chrome and no press feedback; a
        // `Gtk.Button` has both (Adwaita paints `:hover` and `:active` on it from the
        // theme, which no property turns off). So the widget is the same one a `View`
        // becomes, and the press arrives through a controller instead of a signal:
        // MEASURED, `Gtk.Button` emits exactly `activate` and `clicked` and a
        // `Gtk.Box` emits neither, while `Gtk.GestureClick` emits `pressed`,
        // `released`, `stopped` and `unpaired-release`.
        tag: 'GtkBox',
        widgetProps: { orientation: 'vertical' },
        cssClasses: [],
        orientation: 'vertical',
        widget: BOX,
        textSink: null,
        overlayOnAbsoluteChild: { tag: 'GtkOverlay', slot: 'overlay' },
        props: {
            ...TOUCHABLE_COMMON,
            pointerEvents: POINTER_EVENTS,
            onPress: { to: 'gesture', signal: 'released' },
            // `sensitive` on a box greys out every descendant, which is not what
            // `disabled` means on a feedback-less wrapper — and `can-target: false`
            // is what actually stops the gesture from firing.
            disabled: { to: 'property', names: ['can-target'], as: 'not' },
        },
    },

    Button: {
        // NOT flat. React Native’s `Button` is the platform’s own button with its
        // own background, which on GTK is a `Gtk.Button` with its frame — the
        // opposite of `Pressable`, whose `flat` class removes it.
        tag: 'GtkButton',
        widgetProps: {},
        cssClasses: [],
        orientation: 'vertical',
        widget: LEAF,
        // `title` writes `label`, so a text CHILD would be a second authority for the
        // same slot. React Native’s `Button` takes no children either, so `null` here
        // is parity rather than a limitation.
        textSink: null,
        refusesStyle:
            'takes no `style` and no `className`. React Native’s own `Button` takes neither — its documented styling story is that you cannot, and you use `Pressable` when you need to — and GTK agrees: an Adwaita button is painted by the theme and by its own classes (`suggested-action`, `destructive-action`), which an application stylesheet sets. Use `<Pressable>`',
        props: {
            ...COMMON,
            title: { to: 'property', names: ['label'], as: 'string' },
            onPress: { to: 'event', signal: 'clicked' },
            disabled: { to: 'property', names: ['sensitive'], as: 'not' },
            color: {
                to: 'refused',
                why: 'is the button’s background on Android and its text colour on iOS — one prop, two meanings, and GTK has a third answer: `suggested-action` and `destructive-action` are Adwaita’s own classes for the two cases a colour is usually asking for. Set them from the application stylesheet, or use `<Pressable>`',
            },
            touchSoundDisabled: { to: 'ignored', why: 'an Android touch sound; a desktop button makes none' },
            hasTVPreferredFocus: { to: 'ignored', why: 'an Android TV focus hint' },
            nextFocusDown: { to: 'ignored', why: 'an Android TV focus hint' },
            nextFocusForward: { to: 'ignored', why: 'an Android TV focus hint' },
            nextFocusLeft: { to: 'ignored', why: 'an Android TV focus hint' },
            nextFocusRight: { to: 'ignored', why: 'an Android TV focus hint' },
            nextFocusUp: { to: 'ignored', why: 'an Android TV focus hint' },
        },
    },

    // A no-op that still LAYS OUT, which is the difference between a declared no-op
    // and a bug. React Native’s `SafeAreaView` is a `View` that insets its children
    // by the device’s safe-area insets; a desktop window’s insets are zero, so the
    // inset is what disappears — not the box, not the column, not the children.
    SafeAreaView: {
        tag: 'GtkBox',
        widgetProps: { orientation: 'vertical' },
        cssClasses: [],
        orientation: 'vertical',
        widget: BOX,
        textSink: null,
        overlayOnAbsoluteChild: { tag: 'GtkOverlay', slot: 'overlay' },
        props: { ...COMMON, pointerEvents: POINTER_EVENTS },
    },

    // `Modal` — the one primitive whose HOST NODE IS NOT ITS PARENT NODE.
    //
    // It is here because the host grew a seam for that (ADR 0045): an `AdwDialog`
    // declares `placement: { kind: 'portal', present, force_close }`, so nothing is
    // ever appended into the parent and the `g_error()` that used to make this row
    // unshippable is unreachable. The measurement that kept `Modal` out of this
    // table is unchanged and is now the seam's reason rather than the primitive's
    // refusal: with the box ROOTED IN A WINDOW, `box.append(dialog)` is
    // `Adwaita-ERROR **: Trying to add AdwDialog … to GtkBox …` — SIGABRT, exit 134,
    // a core dump — while a DETACHED box takes the same append in silence.
    //
    // `can-close: false` UNCONDITIONALLY, and it is the whole of what makes the two
    // models agree. React Native owns a modal's visibility through `visible` and
    // nothing else; a dialog that closed itself on Escape would leave the element
    // mounted with `visible` still true and nothing on screen, with no prop change
    // to re-present it — the silent divergence this layer refuses everywhere. So the
    // dialog never closes itself: the user's dismissal arrives as `close-attempt`
    // (that is `onRequestClose`, which React Native documents as required for
    // exactly this reason), and the only thing that takes the sheet down is the
    // element being unrendered. MEASURED: with `can-close: false`, `close()` returns
    // FALSE, emits `close-attempt` and leaves the dialog up; `force_close()` — which
    // is what the host's portal placement names — closes it and emits `closed`.
    //
    // AND THE CONTENT BOX IS NOT DECORATION. `Adw.Dialog` holds ONE child
    // (`set_child`/`get_child`, measured), so two children under a `<Modal>` would be
    // an assignment that evicts the first, silently. The box makes the arity right;
    // it carries no style prop of its own because React Native's `Modal` has no
    // second style prop to carry it (`ScrollView` has `contentContainerStyle`), so
    // `style` and `className` land on the dialog — where the paint half works and a
    // layout utility is refused by name, because an `Adw.Dialog` is not a box.
    Modal: {
        tag: 'AdwDialog',
        widgetProps: { 'can-close': false },
        cssClasses: [],
        orientation: 'vertical',
        // NOT a box: `Adw.Dialog` installs no `orientation` and no `spacing`
        // (measured), so `items-*`/`gap-*` on a `<Modal>` are refused naming the
        // primitive rather than dropped. They belong on a `<View>` inside it.
        widget: LEAF,
        textSink: null,
        content: {
            tag: 'GtkBox',
            widgetProps: { orientation: 'vertical' },
            orientation: 'vertical',
            widget: BOX,
            styleProp: null,
            classNameProp: null,
        },
        props: {
            ...COMMON,
            // Read directly by the binding, exactly as `contentContainerStyle` is:
            // the element is RENDERED only while this is true, and a portal that is
            // not rendered is not presented. Listed so an unknown-prop refusal names
            // the right spelling.
            visible: {
                to: 'ignored',
                why: 'read directly by the binding: the element is rendered only while it is true',
            },
            // MEASURED: `close-attempt` is what `Adw.Dialog` emits when the user asks
            // to close a dialog whose `can-close` is false — Escape, the close
            // control, a click on the backdrop — and it carries no payload, which is
            // also React Native's shape (`DirectEventHandler<null>`).
            onRequestClose: { to: 'event', signal: 'close-attempt' },
            // MEASURED on libadwaita 1.9.3 / GTK 4.22.4: `map` fires ONCE and it
            // fires when the dialog is actually on screen — `present()` against a
            // window that has not been shown yet emits nothing, and the emission
            // arrives on `win.present()`. That is React Native's own contract
            // ("called once the modal has been shown") more exactly than the present
            // call would be.
            onShow: { to: 'event', signal: 'map' },
            onDismiss: {
                to: 'refused',
                why: 'would never fire. The only thing that dismisses a dialog here is the element being unrendered, and the host disconnects a node’s handlers BEFORE it retracts the node — so `Adw.Dialog::closed` is emitted with the handler already gone. A callback that fires for no dismissal at all is worse than one that says so. Do the work in the effect cleanup of whatever renders the `<Modal>`',
            },
            animationType: {
                to: 'refused',
                why: 'libadwaita animates the presentation itself and picks the animation from `Adw.Dialog:presentation-mode` — a floating sheet fades and scales, a bottom sheet slides up — so there is no property that selects one. Reach the dialog through a `ref` and set `presentation-mode` if the sheet should arrive from the bottom',
            },
            transparent: {
                to: 'refused',
                why: 'an `Adw.Dialog` is always a sheet over libadwaita’s own dimmed backdrop; there is no full-bleed transparent mode, and faking one would be a sheet with no chrome that still dims. For an overlay you paint yourself, put an absolutely positioned `<View>` in a `<View>` — that becomes a `Gtk.Overlay` — instead of a `<Modal>`',
            },
            backdropColor: {
                to: 'refused',
                why: 'see `transparent` — the dim layer is libadwaita’s and is painted from the theme',
            },
            presentationStyle: {
                to: 'refused',
                why: 'iOS presentation vocabulary. The GTK axis is `Adw.Dialog:presentation-mode` (auto / floating / bottom-sheet), which says WHERE the sheet sits rather than how much it covers, so no member of this maps onto one. Set that property through a `ref`',
            },
            allowSwipeDismissal: {
                to: 'refused',
                why: 'swipe-to-dismiss is a touch gesture; the desktop dismissal is Escape or a click on the backdrop, and `onRequestClose` already reports both',
            },
            supportedOrientations: { to: 'refused', why: 'a desktop window has no orientation to lock' },
            onOrientationChange: { to: 'refused', why: 'see `supportedOrientations` — nothing rotates' },
            modalRef: {
                to: 'refused',
                why: 'React Native’s second ref, to the native modal host view. There is one node here and `ref` already hands back its `Gtk.Widget`; two refs to one widget would be two names for the same thing',
            },
            hardwareAccelerated: { to: 'ignored', why: 'an Android window flag; GTK4 renders through GSK either way' },
            statusBarTranslucent: { to: 'ignored', why: 'a desktop window has no status bar to go under' },
            navigationBarTranslucent: { to: 'ignored', why: 'see `statusBarTranslucent`' },
        },
    },

    // `Icon` is NOT a React Native name, and it is here for the reason the primitive
    // table exists at all: ADR 0036's `@expo/vector-icons` surface needs a widget,
    // and a component that named `GtkImage` itself would put a widget name in L3 —
    // the one thing ADR 0032 § 1 and ADR 0027 rule 1 both forbid. The Ionicons
    // vocabulary is translated one layer up (`surfaces/icon-map.ts`), so what reaches
    // here is already a GTK icon NAME and this row stays reusable for the next glyph
    // set.
    //
    // `icon-name` and not `gicon`: a themed icon addressed by name is what the icon
    // theme resolves, at the scale factor of the surface it is drawn on, and it
    // recolours from GTK CSS `color` — which is how a symbolic icon is tinted, and
    // why `color` goes into the paint half rather than onto a property.
    Icon: {
        tag: 'GtkImage',
        widgetProps: {},
        cssClasses: [],
        orientation: 'vertical',
        widget: LEAF,
        textSink: null,
        props: {
            ...COMMON,
            name: { to: 'property', names: ['icon-name'], as: 'string' },
            // `pixel-size` and not width/height requests: MEASURED, a `Gtk.Image`
            // asked for a size request draws its icon at the theme's step and pads
            // the rest, while `pixel-size` picks the icon size itself. The default is
            // -1, which means "use icon-size", so the prop is only ever set when the
            // author gave one.
            size: { to: 'property', names: ['pixel-size'], as: 'int' },
            color: { to: 'style-property', name: 'color' },
        },
    },

    KeyboardAvoidingView: {
        tag: 'GtkBox',
        widgetProps: { orientation: 'vertical' },
        cssClasses: [],
        orientation: 'vertical',
        widget: BOX,
        textSink: null,
        overlayOnAbsoluteChild: { tag: 'GtkOverlay', slot: 'overlay' },
        props: {
            ...COMMON,
            pointerEvents: POINTER_EVENTS,
            behavior: {
                to: 'ignored',
                why: 'describes how to move out of an on-screen keyboard’s way, and none appears',
            },
            keyboardVerticalOffset: { to: 'ignored', why: 'see `behavior`' },
            enabled: { to: 'ignored', why: 'see `behavior` — the avoidance is already off' },
            contentContainerStyle: {
                to: 'refused',
                why: 'styles the inner view React Native adds to do the avoiding, and there is no avoiding here — so there is no second node to style. Put it on `style`, which lands on the one box this element is',
            },
        },
    },

    // --- the list family ------------------------------------------------------
    //
    // WHY THESE ARE THREE NODES AND NOT ONE, and it is the sharpest measurement of
    // this milestone after `Modal`. A `Gtk.ListView` renders from a MODEL through a
    // `Gtk.ListItemFactory`; MEASURED on gtk 4.22.4, it installs no `append`, no
    // `add`, no `insert`, no `prepend`, no `remove` and no `set_child` — nothing a
    // child-placement policy could name. So the list itself cannot be an element
    // whose children are the rows, and the rows are not this table’s business at
    // all: `lists/controller.ts` owns them.
    //
    // What IS this table’s business is the frame around it, because that is where
    // `style`, `className` and `horizontal` land: an outer `Gtk.Box` for the header,
    // the scroller and the footer, and a `Gtk.ScrolledWindow` the controller puts the
    // `Gtk.ListView` into. Both are ordinary nodes with ordinary routes.
    FlatList: {
        tag: 'GtkBox',
        widgetProps: { orientation: 'vertical' },
        cssClasses: [],
        orientation: 'vertical',
        widget: BOX,
        textSink: null,
        content: {
            tag: 'GtkScrolledWindow',
            // `vexpand` because the scroller is one of up to three children of the
            // outer box and it is the one that takes the leftover space — a header
            // and a footer are their own natural height. `hscrollbar-policy: never`
            // for the reason `ScrollView` has it: a `Gtk.ScrolledWindow` scrolls both
            // axes by default and therefore propagates a natural size on neither.
            widgetProps: { 'hscrollbar-policy': 'never', vexpand: true, hexpand: true },
            orientation: 'vertical',
            widget: LEAF,
            styleProp: null,
            classNameProp: null,
        },
        props: {
            ...COMMON,
            horizontal: [
                {
                    to: 'property',
                    on: 'outer',
                    names: ['orientation'],
                    as: 'map',
                    map: { true: 'horizontal', false: 'vertical' },
                },
                {
                    to: 'property',
                    on: 'content',
                    names: ['hscrollbar-policy'],
                    as: 'map',
                    map: { true: 'automatic', false: 'never' },
                },
                {
                    to: 'property',
                    on: 'content',
                    names: ['vscrollbar-policy'],
                    as: 'map',
                    map: { true: 'never', false: 'automatic' },
                },
            ],
            showsVerticalScrollIndicator: {
                to: 'property',
                on: 'content',
                names: ['vscrollbar-policy'],
                as: 'map',
                map: { true: 'automatic', false: 'external' },
            },
            showsHorizontalScrollIndicator: {
                to: 'property',
                on: 'content',
                names: ['hscrollbar-policy'],
                as: 'map',
                map: { true: 'automatic', false: 'external' },
            },
            // Read by the component, not routed: they are React trees and a widget
            // property cannot hold one. Listed so an unknown-prop refusal names them.
            data: { to: 'ignored', why: 'read by the component, which drives the Gio.ListStore from it' },
            renderItem: { to: 'ignored', why: 'read by the item factory' },
            keyExtractor: { to: 'ignored', why: 'read by the component, to key the model rows' },
            getItem: { to: 'ignored', why: 'read by the component — VirtualizedList’s accessor form of `data`' },
            getItemCount: { to: 'ignored', why: 'see `getItem`' },
            sections: { to: 'ignored', why: 'read by the component — SectionList’s form of `data`' },
            renderSectionHeader: { to: 'ignored', why: 'read by the item factory' },
            ListEmptyComponent: { to: 'ignored', why: 'rendered by the component instead of the scroller' },
            ListHeaderComponent: { to: 'ignored', why: 'rendered by the component, before the scroller' },
            ListFooterComponent: { to: 'ignored', why: 'rendered by the component, after the scroller' },
            onEndReached: { to: 'ignored', why: 'bound by the component to the scroller’s own Gtk.Adjustment' },
            onEndReachedThreshold: { to: 'ignored', why: 'see `onEndReached`' },
            extraData: { to: 'ignored', why: 'read by the component; a change re-renders every bound row' },
            // NOT a React Native prop, and it earns its place: a row is a React root of
            // its own, so an error inside `renderItem` has no ancestor boundary in the
            // outer tree to reach. Listed here so it is not refused as unknown.
            onRowError: { to: 'ignored', why: 'read by the component, and handed to each row’s own React root' },
            // The refusals. React Native’s list surface is wide and most of it
            // describes a virtualisation implementation GTK has its own version of —
            // ADR 0032 says so in as many words, and honouring these literally would
            // mean fighting `Gtk.ListView` for the job it already does.
            initialNumToRender: { to: 'refused', why: GTK_OWNS_VIRTUALISATION },
            maxToRenderPerBatch: { to: 'refused', why: GTK_OWNS_VIRTUALISATION },
            updateCellsBatchingPeriod: { to: 'refused', why: GTK_OWNS_VIRTUALISATION },
            windowSize: { to: 'refused', why: GTK_OWNS_VIRTUALISATION },
            removeClippedSubviews: { to: 'refused', why: GTK_OWNS_VIRTUALISATION },
            getItemLayout: { to: 'refused', why: GTK_OWNS_VIRTUALISATION },
            initialScrollIndex: {
                to: 'refused',
                why: 'scrolls to a row before the first paint. `Gtk.ListView.scroll_to(position, flags, scroll_info)` is the counterpart and it is an imperative call on a realised view, not a property — reach the view through a ref and call it',
            },
            onViewableItemsChanged: {
                to: 'refused',
                why: 'reports which rows are on screen. `Gtk.ListView` binds and unbinds rows itself and exposes no viewport range — the closest fact is `Gtk.ListItem:position` inside the factory, which is per row rather than a set, so a faithful answer would be a guess assembled from bind order',
            },
            viewabilityConfig: { to: 'refused', why: 'see `onViewableItemsChanged`' },
            viewabilityConfigCallbackPairs: { to: 'refused', why: 'see `onViewableItemsChanged`' },
            onScroll: {
                to: 'refused',
                why: 'GTK reports scroll position through the `Gtk.Adjustment` objects behind the scroller’s `hadjustment`/`vadjustment` — `notify::value` on an adjustment, not a signal on the widget. `onEndReached` is the one question this layer answers from it; reach the adjustment through a ref for the rest',
            },
            scrollEventThrottle: { to: 'refused', why: 'see `onScroll`' },
            numColumns: {
                to: 'refused',
                why: 'lays the rows out in a grid, and a `Gtk.ListView` is one column of rows by construction. `Gtk.GridView` is the widget that does this and it is a different tag with a different model contract, so it is a primitive of its own rather than a prop on this one',
            },
            columnWrapperStyle: { to: 'refused', why: 'see `numColumns`' },
            inverted: {
                to: 'refused',
                why: 'draws the list bottom-up. GTK has no reversed list view; the honest equivalent is to reverse `data` yourself, which is one line and visible in the code',
            },
            refreshing: { to: 'refused', why: PULL_TO_REFRESH },
            onRefresh: { to: 'refused', why: PULL_TO_REFRESH },
            refreshControl: { to: 'refused', why: PULL_TO_REFRESH },
            ItemSeparatorComponent: {
                to: 'refused',
                why: 'puts a widget BETWEEN rows, and a `Gtk.ListView` has no between — it has rows. `Gtk.ListView:show-separators` draws the Adwaita separator itself; set it through a ref, or give the row its own bottom border with `border-b`',
            },
            stickySectionHeadersEnabled: {
                to: 'refused',
                why: 'GTK’s own sticky headers are a `Gtk.ListView:header-factory` over a model that implements `Gtk.SectionModel` (MEASURED: `Gio.ListStore` does not, every selection model and `Gtk.FlattenListModel` do). This layer flattens the sections into one model with header ROWS instead, so a header scrolls with its section — which is what `stickySectionHeadersEnabled={false}` asks for and the only thing it can deliver',
            },
            keyboardShouldPersistTaps: { to: 'ignored', why: 'there is no on-screen keyboard to dismiss' },
            keyboardDismissMode: { to: 'ignored', why: 'see `keyboardShouldPersistTaps`' },
            contentContainerStyle: {
                to: 'refused',
                why: 'styles the box React Native puts the rows in, and there is no such box: `Gtk.ListView` builds each row from the factory and owns the space between them. Style the row inside `renderItem`, or the list itself through `style`',
            },
        },
    },
};

/** The primitives this layer answers for. Derived, so it cannot disagree with the table. */
export const PRIMITIVE_NAMES: readonly string[] = Object.keys(PRIMITIVES);

/** Props the framework owns; they never reach a widget and are never refused. */
export const FRAMEWORK_PROPS: ReadonlySet<string> = new Set(['children', 'key', 'ref', 'className', 'style']);
