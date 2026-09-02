// The ONE API surface — the half that is neither GTK nor React Native. Every widget is a
// prop type here and two implementations elsewhere; `parity.spec.ts` is what holds both
// implementations to this declaration rather than letting each half be internally
// consistent and free to disagree with the other.
//
// PROPS ARE NAMED IN LIBADWAITA'S VOCABULARY, camelCased. `maximumSize` is
// `AdwClamp:maximum-size`, not a React Native `maxWidth` — the package's promise is the
// Adwaita design language on React Native, so the property a reader looks up in
// libadwaita's documentation is the property they write. A SIGNAL is named the way
// `@gjsify/gtk-host`'s generated surface names it (`onActivated` for `::activated`,
// `onNotifyActive` for `notify::active`), for the same reason one level out: the GTK half
// hands the prop straight to the host, so a second spelling here would be a translation
// table nothing checks.
//
// A PROPERTY THIS PACKAGE DOES NOT CARRY IS ABSENT, NEVER PRESENT AND IGNORED. The
// boxed-list rows have icon-name properties (`AdwButtonRow:start-icon-name`,
// `AdwActionRow:icon-name`) that name an entry in a GTK ICON THEME, which React Native
// has no counterpart for and this package ships no renderer for. A prop that reaches one
// half and evaporates on the other is the divergence the whole package exists to close,
// so those names are not declared at all and the omissions are listed in the README.

import type {
    AdwBannerButtonStyle,
    AdwComboOptionInput,
    AdwLengthUnit,
    AdwToast,
    AdwToolbarStyle,
    AdwWrapBoxJustify,
    AdwWrapBoxOrientation,
    AdwWrapBoxPackDirection,
    AdwWrapPolicy,
} from '@gjsify/adwaita-core';
import type { ReactNode, Ref } from 'react';

/**
 * What a widget that HOLDS a child accepts.
 *
 * Not every widget does. `Adw.WindowTitle` is two labels and no child slot; `Adw.Avatar`,
 * `Adw.Banner`, `Adw.Spinner` and `Adw.ButtonContent` are leaves; `Adw.ButtonRow` has no
 * child API in libadwaita at all, and `Adw.SwitchRow` and `Adw.EntryRow` fill their one
 * slot themselves. Their prop types deliberately do NOT extend this, so a child written
 * into one is a TYPE error rather than a node `@gjsify/gtk-host` refuses at runtime on one
 * half while React Native renders it on the other. A `children` a widget would have to
 * drop is a hole in the surface, not a convenience.
 */
export interface AdwWidgetProps {
    children?: ReactNode;
}

/** `Adw.Bin` — a widget with one child and no layout of its own. */
export type AdwBinProps = AdwWidgetProps;

/**
 * `Adw.Clamp` — constrain a child's size and centre it.
 *
 * The defaults named below are libadwaita's own; in code both halves read them from
 * `@gjsify/adwaita-core`'s `ADW_CLAMP_DEFAULTS` rather than repeating them.
 */
export interface AdwClampProps extends AdwWidgetProps {
    /** `maximum-size` — how wide the child may get. Default 600. */
    maximumSize?: number;
    /** `tightening-threshold` — where the eased tightening starts. Default 400. */
    tighteningThreshold?: number;
}

/**
 * `Adw.HeaderBar` — the start / centre / end bar at the top of a window.
 *
 * THE THREE SLOTS ARE PROPS, NOT CHILDREN, and the names are the GTK host's own slot
 * names (`start`, `end`, `title` — `packages/framework/gtk-host/src/descriptors/adw.ts`),
 * which are `adw_header_bar_pack_start` / `_pack_end` / `:title-widget`. A bare child
 * would have to pick one of them, and `Adw.HeaderBar`'s buildable default picking `start`
 * is a GTK detail no React caller should have to know.
 *
 * PACK ORDER DOES NOT ARISE HERE, and that is the one place this surface is SIMPLER than
 * the imperative API rather than different from it. `adw_header_bar_pack_end` PREPENDS
 * (adw-header-bar.c:1106), so `packEnd(menu); packEnd(search)` draws `search | menu`;
 * `HeaderBarState` in `@gjsify/adwaita-core` stores the end slot in DRAW order for
 * exactly that reason. A prop is already draw order — `end={<><Search /><Menu /></>}` is
 * what it looks like — so there is no order to reverse and no rule to get backwards.
 */
export interface AdwHeaderBarProps {
    /**
     * `title-widget` — a custom centre.
     *
     * Either/or with {@link title}/{@link subtitle}, as `adw_header_bar_set_title_widget`
     * is with the derived label it empties out of the centre bin (:1201).
     */
    titleWidget?: ReactNode;
    /**
     * The centre's title.
     *
     * A DIVERGENCE FROM LIBADWAITA, and the same one both other renderers carry:
     * `Adw.HeaderBar` has NO `title` property at all. Its derived centre is a plain
     * `gtk_label_new (NULL)` (`construct_title_label`, adw-header-bar.c:512) over a title
     * RESOLVED from the navigation page, then the dialog, then the window, then the
     * application name (`update_title`, :475) — and an app that wants a subtitle sets an
     * `AdwWindowTitle` as its title widget. A declarative surface wants the attribute, so
     * authoring one installs an {@link AdwWindowTitleProps} centre; it is recorded as
     * `HeaderBarRenderState.derivedSubtitle` in `@gjsify/adwaita-core`.
     */
    title?: string;
    /** The centre's subtitle. Same divergence as {@link title}. */
    subtitle?: string;
    /** `pack_start` — the leading slot, in draw order. */
    start?: ReactNode;
    /** `pack_end` — the trailing slot, in draw order. */
    end?: ReactNode;
}

/** `Adw.StatusPage` — a centred empty state: icon, title, description and one child. */
export interface AdwStatusPageProps extends AdwWidgetProps {
    /**
     * `icon-name` — the symbolic icon above the title.
     *
     * CARRIED ON BOTH HALVES AND DRAWN ONLY ON GTK. An icon NAME needs an icon theme to
     * resolve it, and React Native has none — the same wall `@gjsify/adwaita-nativescript`
     * hit, which took an SVG string instead. The README names it; `status-page.native.spec.tsx`
     * pins that the tree has no icon node, so the day one appears is a decision and not a
     * drift.
     */
    iconName?: string;
    /** `title` — the bold line. An empty title takes no space (`string_is_not_empty`). */
    title?: string;
    /** `description` — the dim line below it. Empty takes no space. */
    description?: string;
}

/**
 * `Adw.ToolbarView` — a content area framed by top and/or bottom bars.
 *
 * `children` IS THE CONTENT, i.e. `Adw.ToolbarView:content`: the buildable default child
 * on GTK, the unnamed slot in `@gjsify/adwaita-web` and the fallback slot in
 * `@gjsify/adwaita-nativescript`. The two bar slots are props under the names all three
 * renderers already give their bar containers.
 */
export interface AdwToolbarViewProps extends AdwWidgetProps {
    /** `adw_toolbar_view_add_top_bar` — what sits above the content. */
    topBar?: ReactNode;
    /** `adw_toolbar_view_add_bottom_bar` — what sits below it. */
    bottomBar?: ReactNode;
    /** `top-bar-style`. Default `flat`. */
    topBarStyle?: AdwToolbarStyle;
    /** `bottom-bar-style`. Default `flat`. */
    bottomBarStyle?: AdwToolbarStyle;
    /** `extend-content-to-top-edge` — the content runs UNDER the top bar. Default false. */
    extendContentToTopEdge?: boolean;
    /** `extend-content-to-bottom-edge`. Default false. */
    extendContentToBottomEdge?: boolean;
}

/** `Adw.WindowTitle` — a title over a subtitle, for the centre of a header bar. */
export interface AdwWindowTitleProps {
    /** `title`. The label is HIDDEN when this is empty, not merely blank. */
    title?: string;
    /** `subtitle`. Hidden when empty, by the same rule. */
    subtitle?: string;
}

/**
 * `Adw.WrapBox` — a box whose children flow onto new lines when they run out of room.
 *
 * All fourteen properties, each under libadwaita's own name. The three length properties
 * come in pairs with their unit, which is why `childSpacing` and `childSpacingUnit` are
 * two props and not one string: they are two GObject properties, and they are resolved
 * against the unit SEPARATELY, so the two spacings can legitimately disagree about it.
 */
export interface AdwWrapBoxProps extends AdwWidgetProps {
    /** `child-spacing` — the gap between children on one line, in {@link childSpacingUnit}. Default 0. */
    childSpacing?: number;
    /** `child-spacing-unit`. Default `px` — NOT the split views' `sp`. */
    childSpacingUnit?: AdwLengthUnit;
    /** `line-spacing` — the gap between lines, in {@link lineSpacingUnit}. Default 0. */
    lineSpacing?: number;
    /** `line-spacing-unit`. Default `px`. */
    lineSpacingUnit?: AdwLengthUnit;
    /** `align` — where the children sit ALONG the line: 0 start, 0.5 middle, 1 end. Default 0. */
    align?: number;
    /** `justify` — whether and how a COMPLETE line is stretched. Default `none`. */
    justify?: AdwWrapBoxJustify;
    /** `justify-last-line` — whether the FINAL line is stretched too. Default false. */
    justifyLastLine?: boolean;
    /** `line-homogeneous` — whether every line takes the same space. Default false. */
    lineHomogeneous?: boolean;
    /** `natural-line-length`, in {@link naturalLineLengthUnit}. `-1` (the default) is UNSET. */
    naturalLineLength?: number;
    /** `natural-line-length-unit`. Default `px`. */
    naturalLineLengthUnit?: AdwLengthUnit;
    /** `pack-direction` — which end of a line children are packed from. Default `start-to-end`. */
    packDirection?: AdwWrapBoxPackDirection;
    /** `wrap-reverse` — whether lines wrap upwards. Default false. */
    wrapReverse?: boolean;
    /** `wrap-policy` — whether an overflowing line squeezes its children. Default `natural`. */
    wrapPolicy?: AdwWrapPolicy;
    /** `orientation` — the axis children are packed along. Default `horizontal`. */
    orientation?: AdwWrapBoxOrientation;
}

/**
 * `Adw.Avatar` — a round avatar showing initials derived from a name, or a
 * fallback icon.
 *
 * `size` IS REQUIRED, and that is the one place this file departs from "libadwaita's
 * defaults are the defaults". `AdwAvatar:size`'s GParamSpec default is the `-1`
 * sentinel meaning "take the size from the stylesheet", and a renderer with no
 * stylesheet cannot honour a stylesheet value. Measured against libadwaita 1.9.3, that
 * path is degenerate on GTK too: a default-constructed avatar measures 20 wide and 18
 * tall — not even square — and raises one `Pango-CRITICAL` from `update_font_size`,
 * because the font cap for a negative size is negative. Reproducing that is not a goal
 * and inventing a number behind the caller's back is how the two halves come to
 * disagree, so the caller says.
 *
 * `custom-image` IS ABSENT. It is a `GdkPaintable` on GTK and an image source on React
 * Native — two types with no shared spelling, and this file may import neither. The
 * consequence is that `avatarMode` here only ever answers `'initials'` or `'icon'`.
 */
export interface AdwAvatarProps {
    /** `size` — the diameter. Required; see above. */
    size: number;
    /** `text` — the name the initials AND the colour are derived from. */
    text?: string;
    /** `show-initials` — initials instead of the fallback icon. Default false. */
    showInitials?: boolean;
    /** `icon-name` — the fallback icon. Default libadwaita's `adw-avatar-default-symbolic`. */
    iconName?: string;
}

/**
 * `Adw.Banner` — a full-width strip carrying one in-context message and an optional
 * action button.
 *
 * ON `useMarkup`'s DEFAULT, which is measured and not the one written down.
 * `AdwBanner:use-markup`'s GParamSpec declares TRUE (adw-banner.c:422-425) and
 * `@gjsify/adwaita-core`'s `ADW_BANNER_DEFAULTS` records that — but a freshly
 * constructed `Adw.Banner` READS BACK FALSE, measured on libadwaita 1.9.3.
 * `adw_banner_get_use_markup` delegates to `gtk_label_get_use_markup (self->title)`,
 * `adw-banner.ui` never sets `use-markup` on that label, and a pspec default is only
 * applied to properties construction actually writes. So the declared default is never
 * reached. Both halves here answer FALSE for an omitted value, because that is what the
 * widget on the other side of the surface answers.
 */
export interface AdwBannerProps {
    /** `title` — the message. Pango markup when {@link useMarkup}. */
    title?: string;
    /** `button-label` — empty means no button. Its `_` is always a mnemonic marker. */
    buttonLabel?: string;
    /** `revealed` — whether the strip is on screen. Default false. */
    revealed?: boolean;
    /** `use-markup` — whether {@link title} is Pango markup. Default false; see above. */
    useMarkup?: boolean;
    /** `button-style` — grey (`'default'`) or `.suggested-action`. */
    buttonStyle?: AdwBannerButtonStyle;
    /** `button-clicked` — the action button was pressed. */
    onButtonClicked?: () => void;
}

/**
 * `Adw.Spinner` — a busy indicator.
 *
 * THE PROPERTIES ARE `GtkWidget`'s, BECAUSE `Adw.Spinner` HAS NONE OF ITS OWN. Its
 * whole `GParamSpec` set is inherited: `adw_spinner_measure` reports `MIN_SIZE` as both
 * the minimum AND the natural size, so the widget never grows on its own and the only
 * way to make one bigger is to ask for a size. Measured on libadwaita 1.9.3: a fresh
 * spinner measures `[16, 16]` and one with `width-request` 200 measures `[200, 200]`.
 * A `size` prop would therefore be a renderer-ism of exactly the kind `maximumSize`
 * exists to avoid — the two other Adwaita renderers each invented one.
 *
 * The BOX and the RING are different numbers, and only the box is a property: the ring
 * is `spinnerGeometry`'s, capped at 64 and centred on the box, so a 200-point request
 * occupies 200 points of layout around a 64-point ring.
 */
export interface AdwSpinnerProps {
    /** `width-request` — the box width. Unset (or `-1`) is libadwaita's natural 16. */
    widthRequest?: number;
    /** `height-request` — the box height. Unset (or `-1`) is libadwaita's natural 16. */
    heightRequest?: number;
}

/** `Adw.ButtonContent` — an icon paired with a label, for the inside of a button. */
export interface AdwButtonContentProps {
    /** `icon-name` — an icon-theme name. Empty draws `image-missing`, it does not hide the icon. */
    iconName?: string;
    /** `label` — empty hides the label node. */
    label?: string;
    /** `use-underline` — whether `_` marks a mnemonic in {@link label}. Default false. */
    useUnderline?: boolean;
    /** `can-shrink` — whether the label ellipsizes rather than widening the button. Default false. */
    canShrink?: boolean;
}

/**
 * What a caller does to an {@link AdwToastOverlayProps} through its `ref`.
 *
 * A TOAST IS PUSHED, NEVER DECLARED, and that is libadwaita's shape rather than a
 * React convenience: `adw_toast_overlay_add_toast` is a call, the overlay owns the
 * queue, and nothing about "which toast is on screen" is a property a caller writes.
 * Modelling it as a `toasts={[…]}` array would put the ordering in the caller's hands
 * on one half and in libadwaita's on the other.
 *
 * `dismissAll` and not `dismiss`: `adw_toast_overlay_dismiss_all` is the only dismissal
 * the OVERLAY has. Dismissing just the current toast is `adw_toast_dismiss`, a method on
 * the toast, so an overlay-level `dismiss()` would be a name libadwaita does not have —
 * and `AdwToastQueue.clear()` is the same operation on the other half.
 */
export interface AdwToastOverlayHandle {
    /** `add_toast` — show it now if the slot is free, otherwise queue it FIFO. */
    addToast(toast: AdwToast): void;
    /** `dismiss_all` — dismiss the visible toast and discard everything behind it. */
    dismissAll(): void;
}

/** `Adw.ToastOverlay` — wraps content and shows one transient toast at a time over it. */
export interface AdwToastOverlayProps extends AdwWidgetProps {
    /** The imperative surface — see {@link AdwToastOverlayHandle}. */
    ref?: Ref<AdwToastOverlayHandle>;
}

/**
/**
 * The two labels every boxed-list row draws — `AdwPreferencesRow:title` and
 * `AdwActionRow:subtitle`.
 *
 * Their VISIBILITY is a derivation and not a prop: libadwaita binds `string_is_not_empty`
 * onto both labels, so an empty title hides its label instead of leaving a blank line.
 * `@gjsify/adwaita-core`'s `deriveRowLabels` is that rule, and the React Native half runs
 * it — the GTK half gets it from the real widget.
 */
export interface AdwRowProps {
    /** `title` — the row's first line. */
    title?: string;
    /** `subtitle` — the dim second line. */
    subtitle?: string;
}

/**
 * `Adw.ActionRow` — the fundamental boxed-list row: two labels and a trailing slot.
 *
 * CHILDREN ARE THE SUFFIX, which is `@gjsify/gtk-host`'s curated default slot for this
 * widget (`add_suffix`) and therefore not a choice made here. `add_prefix` is reachable on
 * GTK by writing `slot="prefix"` on the child and has no counterpart on the React Native
 * half, so this surface does not offer it — see the README.
 */
export interface AdwActionRowProps extends AdwRowProps, AdwWidgetProps {
    /**
     * `GtkListBoxRow:activatable` — whether a click activates the row.
     *
     * `Adw.ActionRow`'s own template sets it FALSE, so an omitted prop is a row that does
     * not react to a click, on both halves.
     */
    activatable?: boolean;
    /** `AdwActionRow::activated`. */
    onActivated?: () => void;
}

/**
 * `Adw.ButtonRow` — a boxed-list row that behaves like a button.
 *
 * NO `activatable`: the upstream template hardcodes `activatable=True` and the class
 * documentation says "AdwButtonRow is always activatable", so there is no opt-out to
 * model. `@gjsify/adwaita-core` exports that fact as `BUTTON_ROW_ACTIVATABLE` and the
 * React Native half reads it rather than writing `true`.
 */
export interface AdwButtonRowProps {
    /** `title` — the centred label. */
    title?: string;
    /** `AdwButtonRow::activated`. */
    onActivated?: () => void;
}

/**
 * `Adw.SwitchRow` — a row whose trailing control is a switch.
 *
 * CONTROLLED, on both halves: `active` is the value the row shows and `onNotifyActive` is
 * the only way it changes. That is React Native's own contract for `Switch` ("a controlled
 * component that requires an `onValueChange` callback that updates the `value` prop"), and
 * it is also what a GTK consumer gets from `@gjsify/gtk-host`, whose echo guard drops the
 * `notify::active` raised by the host's own property write.
 */
export interface AdwSwitchRowProps extends AdwRowProps {
    /** `Adw.SwitchRow:active` — whether the switch is on. Default `false`. */
    active?: boolean;
    /**
     * `notify::active`, with the new value.
     *
     * libadwaita has exactly ONE notify path for this property and it cannot see where the
     * change came from, so a drag on the handle and a click on the title arrive here
     * identically — the row is the control, not just the slider.
     */
    onNotifyActive?: (active: boolean) => void;
}

/**
 * `Adw.EntryRow` — a boxed-list row that is itself a text entry.
 *
 * THE ROW OWNS ITS TEXT, which is GObject's contract and not React's: `text` seeds the
 * entry and overwrites it whenever the prop CHANGES, and a keystroke that the consumer
 * does not echo back still stands. Both halves behave that way for the same reason — on
 * GTK because `@gjsify/gtk-host` patches a property only when it changes, on React Native
 * because `@gjsify/adwaita-core`'s `EntryRowState` is the buffer.
 */
export interface AdwEntryRowProps {
    /** `title` — the floating label, and the placeholder while the row is empty. */
    title?: string;
    /** `GtkEditable:text` — the entry contents. */
    text?: string;
    /**
     * `Adw.EntryRow:max-length` — maximum number of CHARACTERS, `0` (the default) meaning
     * unlimited. Code points, never UTF-16 units: `@gjsify/adwaita-core`'s `clampEntryText`
     * is what counts them on the React Native half, because `TextInput`'s own `maxLength`
     * counts units and cuts a surrogate pair in half.
     */
    maxLength?: number;
    /** `GtkEditable:editable` — whether the entry accepts edits. Default `true`. */
    editable?: boolean;
    /** `Adw.EntryRow:show-apply-button` — typing reveals an apply button. Default `false`. */
    showApplyButton?: boolean;
    /** `notify::text`, with the new contents. */
    onNotifyText?: (text: string) => void;
    /** `AdwEntryRow::apply` — the apply button, or Enter while it shows. */
    onApply?: () => void;
    /** `AdwEntryRow::entry-activated` — Enter when there is nothing to apply. */
    onEntryActivated?: () => void;
}

/**
 * `Adw.ExpanderRow` — a boxed-list row that discloses further rows beneath itself.
 *
 * CHILDREN ARE THE DISCLOSED ROWS, which is `@gjsify/gtk-host`'s curated default slot
 * for this widget (`add_row`) and therefore not a choice made here. `add_prefix` and
 * `add_suffix` are reachable on GTK by writing `slot="prefix"` / `slot="suffix"` on a
 * child and have no counterpart on the React Native half, so this surface does not offer
 * them — see the README.
 *
 * THE ROW OWNS ITS DISCLOSURE, the way `Adw.EntryRow` owns its text and for the same
 * mechanical reason: `expanded` seeds the row and overwrites it whenever the PROP
 * changes, and a tap the consumer does not echo back still stands. On GTK because the
 * real widget toggles itself and `@gjsify/gtk-host` patches a property only when the prop
 * changes; on React Native because `@gjsify/adwaita-core`'s `ExpanderState` is the
 * buffer.
 */
export interface AdwExpanderRowProps extends AdwRowProps, AdwWidgetProps {
    /** `Adw.ExpanderRow:expanded` — whether the disclosure is revealed. Default `false`. */
    expanded?: boolean;
    /**
     * `notify::expanded`, with the new flag.
     *
     * A change the CONSUMER made does not come back through here — on GTK because
     * `@gjsify/gtk-host` drops the notify raised inside its own property write, on React
     * Native because the prop-sync path does not call it. Both halves therefore report a
     * disclosure the USER made and nothing else.
     */
    onNotifyExpanded?: (expanded: boolean) => void;
}

/**
 * `Adw.PreferencesPage` — a scrolling page of {@link AdwPreferencesGroupProps}.
 *
 * FOUR OF THE FIVE PROPERTIES ARE IDENTITY, NOT PAINT, and that is libadwaita's design
 * rather than a thin port: `adw_preferences_dialog_add` binds `title`, `name`, `icon-name`
 * and `use-underline` onto the view-stack page it wraps the page in, and
 * `create_search_row_subtitle` reads the title back when a second page is visible. The page
 * itself draws none of them — a view switcher and the search results do. Both sibling
 * renderers carry them for the same reason and paint them just as little.
 *
 * `description` IS the exception: it is drawn at the top of the page, above the first
 * group, and both halves draw it.
 *
 * `banner` IS ABSENT. `AdwPreferencesPage:banner` takes an `Adw.Banner` INSTANCE — a
 * GObject, not a description of one — and this file may import neither `gi://Adw` nor a
 * React Native module. Same wall, and the same answer, as `AdwAvatarProps`' `custom-image`.
 */
export interface AdwPreferencesPageProps extends AdwWidgetProps {
    /** `title` — shown by a view switcher and by search results, never by the page. */
    title?: string;
    /** `icon-name` — the symbolic a view switcher shows. Carried on both halves, drawn on neither. */
    iconName?: string;
    /** `name` — the view-stack child name. NOT `GtkWidget:name`, which the page shadows. */
    name?: string;
    /**
     * `description` — the line above the first group. Empty takes no space.
     *
     * ON THE RAW STRING, unlike {@link AdwPreferencesGroupProps}' two labels.
     * `adw_preferences_page_set_description` tests `description && *description` while
     * `update_title_visibility` reads the label's DISPLAYED text, so a pure-markup page
     * description is visible on GTK where a pure-markup group title is not. Both halves
     * therefore agree here, and the group's divergence must not be copied onto this one.
     */
    description?: string;
    /** `description-centered` — whether {@link description} is centred. Default false. */
    descriptionCentered?: boolean;
    /** `use-underline` — whether `_` marks a mnemonic in {@link title}. Default false. */
    useUnderline?: boolean;
}

/**
 * `Adw.PreferencesGroup` — a titled card of rows.
 *
 * THE FIVE VISIBILITY ANSWERS COME FROM `derivePreferencesGroupHeader`, on the React Native
 * half, and from libadwaita on the GTK one. They are not `title !== ''`: `header-visible` is
 * a three-way OR, `single-line` is load-bearing for the stylesheet's `min-height: 34px`, and
 * `listbox-visible` reads the RAW child count — `update_listbox_visibility` counts
 * `gtk_widget_observe_children`, not the title-filtered model `get_rows` builds, so a row
 * with an empty title still keeps the card painted.
 *
 * `header-suffix` IS ABSENT, and it is a placement question rather than a naming one.
 * `AdwPreferencesGroup:header-suffix` holds a WIDGET, so a React surface has to spell it as
 * a slot — and the group's curated descriptor in `@gjsify/gtk-host` is `ordered`
 * (`add`/`remove`, `remove-all` to reorder), which has no slots at all. Adding one means
 * changing a placement policy other conformance vectors already assert, with its own
 * measurement; it is not something a widget lands on the way past. The README names it.
 *
 * `separate-rows` IS ABSENT for the opposite reason: it is pure card styling, and this
 * package's React Native half draws no theme (see `row-shell.native.tsx`), so the GTK half
 * would honour it and the phone half could only ignore it.
 */
export interface AdwPreferencesGroupProps extends AdwWidgetProps {
    /** `title` — the card's heading. Hidden when empty, not merely blank. */
    title?: string;
    /** `description` — the dim line under it. Hidden when empty, and it forces a two-line header. */
    description?: string;
}

/**
 * `Adw.ComboRow` — a row that picks one item out of a list.
 *
 * The two labels are {@link AdwRowProps}', which every boxed-list row shares — including
 * their derived visibility, which is not `title !== ''`.
 *
 * `model` IS THE LIBADWAITA NAME AND NOT THE LIBADWAITA TYPE, which is the one liberty this
 * surface takes and the reason it can exist at all. `AdwComboRow:model` is a
 * `Gio.ListModel`; a props file that may import neither `gi://Gio` nor `react-native` cannot
 * name that type, and the gallery refuses the widget outright for exactly this
 * (`adwaita-gallery-trees.mjs`: "its items are a Gio.ListModel; a row without them teaches
 * the wrong thing"). What both halves CAN share is `@gjsify/adwaita-core`'s
 * `AdwComboOptionInput` — the option vocabulary `<adw-combo-row>` and
 * `@gjsify/adwaita-nativescript` already accept — so the property keeps libadwaita's name
 * and takes the shared description of a model. The GTK half turns it into the real
 * `Gtk.StringList` it has to be; the React Native half feeds it to `ComboState`.
 *
 * `onNotifySelected` FIRES ON EVERY CHANGE, INCLUDING A PROGRAMMATIC ONE. `ComboState` tags
 * its changes `interactive` and a renderer that re-emits `notify::selected` itself is meant
 * to gate on it — but the GTK half does not re-emit anything, it is a real GObject, and
 * `notify::` fires whenever the property moves. Gating the React Native half on
 * `interactive` would therefore make the two halves disagree about the most ordinary thing a
 * consumer does. A consumer that wants user picks only compares against the value it
 * authored.
 *
 * `expression`, `factory`, `list-factory`, `header-factory`, `enable-search` and
 * `search-match-mode` are all absent, and all for the `model` reason one step further: each
 * is a `Gtk.*` instance. Neither sibling renderer has them either.
 */
export interface AdwComboRowProps extends AdwRowProps {
    /** `model` — the selectable items. See above on the type. */
    model?: readonly AdwComboOptionInput[];
    /** `selected` — the position of the selected item. Default 0. */
    selected?: number;
    /**
     * `use-subtitle` — whether the selected item's label REPLACES {@link subtitle}. Default false.
     *
     * REPLACES, not "appears twice": `adw-combo-row.ui` binds the inline value view's `visible`
     * to this property with `sync-create|invert-boolean`, so the value is drawn in the subtitle
     * OR in the trailing slot and never in both. Both halves are held to that.
     *
     * WHEN the subtitle picks the value up is a NAMED DIVERGENCE, in the README: this surface
     * publishes it at once, libadwaita on the next selection change. Measured — the setter calls
     * `selection_changed`, and the subtitle is written by `selection_item_changed`.
     */
    useSubtitle?: boolean;
    /** `notify::selected` — the selected position moved. */
    onNotifySelected?: (selected: number) => void;
}

/**
 * `Adw.SpinRow` — a row holding a number with a stepper.
 *
 * The two labels are {@link AdwRowProps}', as on every other boxed-list row here.
 *
 * THE RANGE IS THREE SCALARS AND libadwaita SPELLS IT AS ONE OBJECT. `AdwSpinRow:adjustment`
 * is a `Gtk.Adjustment` — a GObject that is not a widget, which is what the gallery refuses
 * the widget for — so the same rule as {@link AdwComboRowProps}' `model` applies: this file
 * cannot name the type, and the three values it carries are named here instead. The names
 * are the ADJUSTMENT's own GObject property names — `Gtk.Adjustment:lower`, `:upper`,
 * `:step-increment` — rather than a fourth private spelling.
 *
 * THAT IS A DECLARED DIVERGENCE FROM THE TWO SIBLING RENDERERS, which flatten the same three
 * onto `min`/`max`/`step`. Those are `adw_spin_row_new_with_range`'s PARAMETER names, not
 * property names, and `props.ts`' rule is that a caller writes the property they would look
 * up in libadwaita's documentation. `@gjsify/adwaita-core`'s `SpinState` calls them
 * `min`/`max`/`step` internally; both halves here map onto that, so the arithmetic is still
 * shared and only the spelling at the surface differs.
 *
 * `digits` IS A ROW PROPERTY AND NOT AN ADJUSTMENT ONE — `AdwSpinRow:digits`, the number of
 * decimal places DISPLAYED. It is carried because it is the only one of the row's own
 * properties both halves can honour: the core has no `digits`, so the React Native half
 * formats with it directly and the GTK half hands it to the real widget.
 *
 * `climb-rate`, `snap-to-ticks`, `numeric`, `update-policy` and `wrap` are absent: each
 * needs an editable text entry or a key-repeat timer that the React Native half does not
 * have, so carrying them would mean a property GTK honours and the phone ignores. Neither
 * sibling renderer has them either.
 */
export interface AdwSpinRowProps extends AdwRowProps {
    /** `value` — the current number, clamped into {@link lower}…{@link upper}. Default 0. */
    value?: number;
    /** `Gtk.Adjustment:lower` — the smallest value the stepper reaches. Default 0. */
    lower?: number;
    /** `Gtk.Adjustment:upper` — the largest. Default 100, which is `SpinState`'s own. */
    upper?: number;
    /** `Gtk.Adjustment:step-increment` — one stepper press. Default 1. */
    stepIncrement?: number;
    /** `digits` — decimal places DISPLAYED. Default 0. */
    digits?: number;
    /** `notify::value` — the value moved. Same rule as {@link AdwComboRowProps.onNotifySelected}. */
    onNotifyValue?: (value: number) => void;
}

/**
 * `Adw.PasswordEntryRow` — an entry row whose contents are masked, with a peek button.
 *
 * IT DECLARES NO PROPERTIES OF ITS OWN, and that is measured rather than assumed:
 * `AdwPasswordEntryRowProps` in `@gjsify/gtk-host`'s generated table is an EMPTY interface
 * over `AdwEntryRowProps`. Everything the subclass adds is behaviour — the mask, the peek
 * toggle installed through `add_suffix`, and the caps-lock indicator driven through the
 * private `adw_entry_row_set_show_indicator` hook. So this surface is `Adw.EntryRow`'s, and
 * `@gjsify/adwaita-core`'s `PasswordEntryRowState` composes an `EntryRowState` for the same
 * reason the C subclasses rather than copies.
 *
 * WHICH IS WHY IT EXTENDS RATHER THAN RESTATES {@link AdwEntryRowProps}. The two carried the
 * same eight members written out twice, and a second copy of a prop surface is the shape that
 * drifts silently: a member added to the entry row would simply not reach this one, and
 * `parity.spec.ts` compares each widget against its OWN base, so nothing would notice.
 *
 * `revealed` IS THEREFORE NOT A PROP, although both sibling renderers publish one. It is not
 * a libadwaita property, the peek state is private to the widget, and a prop would be the
 * one place this file invents a name. The button owns it on both halves.
 *
 * `activates-default`, `enable-emoji-completion`, `input-hints`, `input-purpose` and
 * `attributes` are absent — the last two by type, the first by there being no default widget
 * on a phone. Neither sibling renderer has them.
 */
export interface AdwPasswordEntryRowProps extends AdwEntryRowProps {}
