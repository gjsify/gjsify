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
// WHY `Modal` IS NOT HERE, and it is the sharpest measurement of this milestone.
// ADR 0032 maps it to `Adw.Dialog`, and an `Adw.Dialog` cannot be an ordinary
// element. Measured on libadwaita 1.10 / gjs 1.88.1, with the box ROOTED IN A
// WINDOW — a detached box accepts the append in silence, so a re-test on a bare
// box 'disproves' this and puts the primitive back: `box.append(dialog)` calls
// `g_error()` — "Trying to add AdwDialog … to GtkBox. Use adw_dialog_present() to
// show dialogs." — which is SIGABRT and a core dump, not an exception a host can
// catch and not a warning a diagnostics gate can count. A dialog is PRESENTED
// against a parent, never parented by it, which makes `<Modal>` a portal rather
// than a primitive; the host has no portal seam. So `Modal` stays `planned` and its
// generated refusing export is the honest answer — strictly better than a `partial`
// that aborts the process the first time somebody renders one.

import type { Orientation, WidgetFacts } from './intents.js';

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

export interface PropertyRoute {
    readonly to: 'property';
    /** Which node it lands on. `content` is the implicit inner box, where there is one. */
    readonly on?: 'outer' | 'content';
    /** The GTK properties this one prop fills — plural for `size`, which is two requests. */
    readonly names: readonly string[];
    readonly as: Coercion;
    readonly map?: Readonly<Record<string, string | number | boolean>>;
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

export type PropRoute = PropertyRoute | StylePropertyRoute | EventRoute | RefusedRoute | IgnoredRoute;

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
}

const BOX: WidgetFacts = { box: true, alignsText: false };
const LEAF: WidgetFacts = { box: false, alignsText: false };
const TEXT: WidgetFacts = { box: false, alignsText: true };

const NO_ACCESSIBILITY_PROP =
    'GTK carries accessibility through `Gtk.Accessible.update_property()`, an imperative call, not through a widget property — so there is nothing for this layer to set as data. `AccessibilityInfo` (tier P3) is the entry that owns this, and GTK’s model maps onto the props well once it exists';
const NO_ON_LAYOUT =
    'GTK reports its allocation through `Gtk.Widget.vfunc_size_allocate`, a SUBCLASS override rather than a signal, so there is no handler to bind. `useWindowDimensions` (tier P2) is the window-level answer';
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
    accessible: { to: 'refused', why: NO_ACCESSIBILITY_PROP },
    accessibilityLabel: { to: 'refused', why: NO_ACCESSIBILITY_PROP },
    accessibilityRole: { to: 'refused', why: NO_ACCESSIBILITY_PROP },
    accessibilityHint: { to: 'refused', why: NO_ACCESSIBILITY_PROP },
    accessibilityState: { to: 'refused', why: NO_ACCESSIBILITY_PROP },
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
        // THE SECOND INVERSION. React Native's `Text` wraps; `Gtk.Label` does not
        // (`wrap` defaults to false), and a long line simply forces the window
        // wider — which reads as a layout bug anywhere but here.
        widgetProps: { wrap: true },
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
            // `notify::text` gave `["abc"]`. The host additionally suppresses a
            // `notify::` raised by its OWN property write (`inHostWrite()` in
            // `signals.ts`), which closes the render → set text → onChangeText →
            // setState → render loop that `changed` would open.
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
};

/** The primitives this layer answers for. Derived, so it cannot disagree with the table. */
export const PRIMITIVE_NAMES: readonly string[] = Object.keys(PRIMITIVES);

/** Props the framework owns; they never reach a widget and are never refused. */
export const FRAMEWORK_PROPS: ReadonlySet<string> = new Set(['children', 'key', 'ref', 'className', 'style']);
