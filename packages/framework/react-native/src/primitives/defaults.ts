// Where GTK's default and React Native's disagree — the whole set, as data.
//
// WHY THIS FILE EXISTS AT ALL. This layer is built on named refusals: a prop it
// cannot answer says so. A DEFAULT that disagrees arrives through the other door and
// says nothing — the element renders, the build is green, every test passes, and the
// window is wrong. It is the same failure the refusals exist to prevent, minus the
// error message.
//
// AND IT WAS FOUND BY RUNNING, NOT BY READING. Four of these were normalised one at a
// time, each in the PR that happened to trip over it. The fifth — `Gtk.Label:xalign` —
// survived every one of those passes and was found by porting a 25-route application
// and looking at it: ALL of its text rendered centred, on every screen, and one line
// fixed all of them. That is what a set nobody enumerated looks like, so this is the
// enumeration.
//
// MEASURED ON BOTH SIDES, and the two halves have different provenance, so each row
// says which:
//
//   * the GTK column is read from a FRESH WIDGET on the installed GTK, and
//     `defaults.spec.ts` re-reads every row rather than trusting it;
//   * the React Native column cites the file in React Native's own tree that fixes
//     it — Yoga's `Style.h` for layout, `ReactCommon/react/renderer/attributedstring`
//     for text — or, where the default lives in a platform text engine rather than in
//     the tree, the OBSERVATION from the port.
//
// THE LEDGER IS CLOSED IN BOTH DIRECTIONS, which is what makes it a mechanism instead
// of a list. Every `widgetProps` entry in `table.ts` overrides a GTK default, so
// `defaults.spec.ts` asserts that each one has a row here AND that each row marked
// `normalised` is really written by the table. A sixth normalisation added without a
// row fails; a row that stops being true fails.

/** What this layer does about one divergence. */
export type DefaultVerdict =
    /** The two disagree and the primitive writes React Native's value. */
    | 'normalised'
    /** Checked, and the two already agree. Recorded so the sweep is a sweep. */
    | 'agrees'
    /** They disagree and GTK's is KEPT on purpose — the reason says why. */
    | 'kept'
    /**
     * Not a default question at all: the table writes this for ONE primitive's own
     * layout.
     *
     * The distinction is worth a verdict because the closure check below cannot make
     * it — every `widgetProps` entry looks the same from there — and conflating the
     * two would let a real divergence hide behind "well, some primitive wanted it".
     */
    | 'primitive';

export interface DefaultRow {
    /** The GType a primitive names. */
    readonly gtype: string;
    /** The property, in GTK's own kebab spelling. */
    readonly property: string;
    /** What a freshly constructed widget reports. Re-measured by the spec. */
    readonly gtk: string | number | boolean;
    /** React Native's own default, in words. */
    readonly reactNative: string;
    /** Where that is written down, or how it was observed. */
    readonly source: string;
    readonly verdict: DefaultVerdict;
    /** The value the primitive writes. Present exactly when the verdict is `normalised`. */
    readonly normalisedTo?: string | number | boolean;
    readonly reason: string;
}

/**
 * Every (widget, property) pair whose default this layer has looked at.
 *
 * ORDERED BY WIDGET, and the `agrees` rows are not padding: "we checked and they
 * match" and "nobody has looked" are different states, and only one of them is safe.
 * A property absent from this file is in the second state.
 */
export const DEFAULT_ROWS: readonly DefaultRow[] = [
    // --- Gtk.Box -------------------------------------------------------------
    {
        gtype: 'GtkBox',
        property: 'orientation',
        gtk: 'horizontal',
        reactNative: 'column',
        source: 'Yoga’s own default — `ReactCommon/yoga/yoga/style/Style.h`: `FlexDirection::Column`. CSS defaults to `row`; React Native deliberately does not.',
        verdict: 'normalised',
        normalisedTo: 'vertical',
        reason: 'The first inversion this layer met, and the loudest: a screen written as a column would have come out as a row.',
    },
    {
        gtype: 'GtkBox',
        property: 'spacing',
        gtk: 0,
        reactNative: '0 (`gap` is unset)',
        source: 'Yoga: an unset gap is 0.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },
    {
        gtype: 'GtkBox',
        property: 'homogeneous',
        gtk: false,
        reactNative: 'no counterpart — children are sized by flex',
        source: 'Yoga has no "all children equal" mode.',
        verdict: 'agrees',
        reason: 'GTK’s `false` is what a flex container does, so the absent concept and the default coincide.',
    },

    // --- Gtk.Label -----------------------------------------------------------
    {
        gtype: 'GtkLabel',
        property: 'wrap',
        gtk: false,
        reactNative: 'text wraps',
        source: 'React Native’s `<Text>` wraps unless `numberOfLines` says otherwise.',
        verdict: 'normalised',
        normalisedTo: true,
        reason: 'Without it a long line forces the window wider instead of wrapping — which reads as a layout bug anywhere but here.',
    },
    {
        gtype: 'GtkLabel',
        property: 'xalign',
        gtk: 0.5,
        reactNative: 'the script’s natural alignment — start, i.e. left in LTR',
        source: '`ReactCommon/react/renderer/attributedstring/TextAttributes.h`: `std::optional<TextAlignment> alignment{}` is UNSET by default, and `primitives.h` documents `TextAlignment::Natural` as "the default alignment for script". Observed in a 25-route port: every string on every screen rendered centred.',
        verdict: 'normalised',
        normalisedTo: 0,
        reason: 'MEASURED as a position, not as a property: a `Gtk.Label` allocated 400×100 reports `get_layout_offsets()` = (193, 41) with GTK’s defaults and (0, 0) with xalign/yalign 0. Nothing anywhere reports the difference.',
    },
    {
        gtype: 'GtkLabel',
        property: 'yalign',
        gtk: 0.5,
        reactNative: 'the top of the text’s box',
        source: 'The same unset `alignment`; vertical centring is `textAlignVertical`/`verticalAlign`, which is also unset. Same layout-offset measurement as `xalign` — the 41 in (193, 41) is this one.',
        verdict: 'normalised',
        normalisedTo: 0,
        reason: 'Only visible when the label is given more height than its text — a `flex-1` or an explicit height — which is exactly when it is hardest to attribute.',
    },
    {
        gtype: 'GtkLabel',
        property: 'justify',
        gtk: 'left',
        reactNative: 'natural, i.e. left in LTR',
        source: 'As `xalign`: unset means natural.',
        verdict: 'agrees',
        reason: 'GTK’s enum default already is the LTR answer. It is `xalign` that positions the BLOCK and this that positions the lines within it, which is why only one of the pair was wrong.',
    },
    {
        gtype: 'GtkLabel',
        property: 'ellipsize',
        gtk: 'none',
        reactNative: 'no truncation until `numberOfLines` is set',
        source: 'React Native applies `ellipsizeMode` only together with `numberOfLines`.',
        verdict: 'agrees',
        reason: 'Both truncate nothing until asked.',
    },
    {
        gtype: 'GtkLabel',
        property: 'selectable',
        gtk: false,
        reactNative: '`selectable` defaults to false',
        source: 'React Native’s `TextProps`.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },

    // --- Gtk.TextView --------------------------------------------------------
    {
        gtype: 'GtkTextView',
        property: 'wrap-mode',
        gtk: 'none',
        reactNative: 'a multiline input wraps',
        source: 'React Native’s multiline `TextInput` wraps, as `<Text>` does.',
        verdict: 'normalised',
        normalisedTo: 'word-char',
        reason: 'The same disagreement as `Gtk.Label:wrap`, one widget over: without it the field scrolls sideways for ever.',
    },
    {
        gtype: 'GtkTextView',
        property: 'editable',
        gtk: true,
        reactNative: '`editable` defaults to true',
        source: 'React Native’s `TextInputProps`.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },

    // --- Gtk.Picture ---------------------------------------------------------
    {
        gtype: 'GtkPicture',
        property: 'content-fit',
        gtk: 'contain',
        reactNative: 'cover',
        source: 'React Native’s `Image` defaults `resizeMode` to `cover`.',
        verdict: 'normalised',
        normalisedTo: 'cover',
        reason: 'Inverted between the two platforms, and an image that fits where it should fill looks deliberate.',
    },

    // --- Gtk.ScrolledWindow --------------------------------------------------
    {
        gtype: 'GtkScrolledWindow',
        property: 'hscrollbar-policy',
        gtk: 'automatic',
        reactNative: 'vertical only — `horizontal` defaults to false',
        source: 'React Native’s `ScrollViewProps`.',
        verdict: 'normalised',
        normalisedTo: 'never',
        reason: 'GTK would scroll sideways as well, which is a second scroll axis the author did not ask for.',
    },
    {
        gtype: 'GtkScrolledWindow',
        property: 'vexpand',
        gtk: false,
        reactNative: '`flexGrow` 0, as for any widget',
        source: 'Yoga: an unset `flexGrow` is 0.',
        verdict: 'primitive',
        reason: '`FlatList` writes it on its scroller, and it is a layout decision rather than a default: the scroller is one of up to three children of the outer box and it is the one that takes the leftover space, because a header and a footer are their own natural height.',
    },
    {
        gtype: 'GtkScrolledWindow',
        property: 'hexpand',
        gtk: false,
        reactNative: '`flexGrow` 0, as for any widget',
        source: 'Yoga: an unset `flexGrow` is 0.',
        verdict: 'primitive',
        reason: 'As `vexpand`, one axis over — `FlatList`’s scroller fills its box.',
    },
    {
        gtype: 'GtkScrolledWindow',
        property: 'kinetic-scrolling',
        gtk: true,
        reactNative: 'no counterpart on a desktop',
        source: '—',
        verdict: 'kept',
        reason: 'Touch-and-flick scrolling is GTK’s own behaviour on a touchscreen and costs nothing with a mouse. Turning it off would remove a desktop affordance to match a phone API that does not describe it.',
    },

    // --- Gtk.Entry -----------------------------------------------------------
    {
        gtype: 'GtkEntry',
        property: 'has-frame',
        gtk: true,
        reactNative: 'unstyled — a bare text field with no border',
        source: 'React Native’s `TextInput` draws no chrome of its own on either platform.',
        verdict: 'kept',
        reason: 'DELIBERATE, and the one row here that is a design choice rather than a match: an Adwaita entry without its frame is not a text field a desktop user recognises. The divergence is visible, which is what separates it from the silent ones — an author sees the frame immediately and can remove it from the stylesheet.',
    },
    {
        gtype: 'GtkEntry',
        property: 'visibility',
        gtk: true,
        reactNative: '`secureTextEntry` defaults to false',
        source: 'React Native’s `TextInputProps`.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },

    // --- Gtk.Switch ----------------------------------------------------------
    {
        gtype: 'GtkSwitch',
        property: 'active',
        gtk: false,
        reactNative: '`value` defaults to false',
        source: 'React Native’s `SwitchProps`.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },

    // --- Gtk.Widget, which every primitive inherits --------------------------
    {
        gtype: 'GtkWidget',
        property: 'halign',
        gtk: 'fill',
        reactNative: 'stretch',
        source: 'Yoga’s own default — `ReactCommon/yoga/yoga/style/Style.h`: `Align alignItems_ = Align::Stretch`.',
        verdict: 'agrees',
        reason: 'GTK’s `fill` and CSS’s `stretch` are the same instruction under different words — `intents.ts` maps them to each other for the explicit case too.',
    },
    {
        gtype: 'GtkWidget',
        property: 'hexpand',
        gtk: false,
        reactNative: '`flexGrow` 0',
        source: 'Yoga: an unset `flexGrow` is 0.',
        verdict: 'agrees',
        reason: 'Neither grows until asked. `flex-1` is what asks, and `intents.ts` resolves it against the PARENT’s axis.',
    },
    // --- Adw.Dialog ----------------------------------------------------------
    {
        gtype: 'AdwDialog',
        property: 'can-close',
        gtk: true,
        reactNative: 'a modal is dismissed by its `visible` prop and by nothing else',
        source: 'React Native’s `Modal`: `visible` is the only thing that shows or hides it, and `onRequestClose` is documented as required on Android and tvOS precisely because the modal does not dismiss itself.',
        verdict: 'primitive',
        reason: 'Not a default divergence but the contract that makes the two models agree. A dialog left able to close itself would take the sheet down on Escape while the element stayed mounted with `visible` still true — nothing on screen, and no prop change left to re-present it. With `can-close: false` the user’s dismissal arrives as `close-attempt` (that is `onRequestClose`) and only unrendering the element closes the dialog, through the portal placement’s `force_close`.',
    },
    {
        gtype: 'GtkWidget',
        property: 'opacity',
        gtk: 1,
        reactNative: '1',
        source: 'React Native’s style default.',
        verdict: 'agrees',
        reason: 'Nothing to do. `Animated.View` writes this property, which is why it is worth having checked.',
    },
    {
        gtype: 'GtkWidget',
        property: 'overflow',
        gtk: 'visible',
        reactNative: 'visible',
        source: 'React Native’s `overflow` style default.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },
    {
        gtype: 'GtkWidget',
        property: 'can-target',
        gtk: true,
        reactNative: '`pointerEvents` defaults to `auto`',
        source: 'React Native’s `ViewProps`.',
        verdict: 'agrees',
        reason: 'Nothing to do.',
    },
];

/** Every row this layer writes a value for, as `(gtype, property)`. Read by the spec. */
export const NORMALISED_DEFAULTS: readonly DefaultRow[] = DEFAULT_ROWS.filter((row) => row.verdict === 'normalised');

/**
 * The row for one `(gtype, property)`, or undefined.
 *
 * FALLS BACK TO `GtkWidget`, and that is not a convenience: `hexpand`, `opacity` and
 * `halign` are `Gtk.Widget`'s properties, so a primitive writing one on a
 * `Gtk.ScrolledWindow` is writing the same property this ledger records once. Keying
 * a row per widget that inherits them would be twenty copies of one fact.
 */
export const defaultRowFor = (gtype: string, property: string): DefaultRow | undefined =>
    DEFAULT_ROWS.find((row) => row.gtype === gtype && row.property === property) ??
    DEFAULT_ROWS.find((row) => row.gtype === 'GtkWidget' && row.property === property);
