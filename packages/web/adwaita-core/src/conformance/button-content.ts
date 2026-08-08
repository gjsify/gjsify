// Button-content conformance vectors — the spec both renderers are held to.
//
// The style-class table is the important one. `AdwButtonContent` exists partly
// to put `image-text-button` on its parent button (adw-button-content.c:115),
// the stylesheet gives that class a DIFFERENT horizontal padding from a plain
// text button (_buttons.scss:77-80 = 9px, against :72-75 = 17px), and
// `grep -rn "image-text-button"` over both renderer trees returned nothing. The
// only thing that could ever have noticed is a table like this one.
//
// CITE THE SELECTOR THAT WINS. The same block that declares the 9px padding also
// declares `> box, > box > box { border-spacing: 4px }` (:82-84), and that half
// does NOT apply here: the node tree is `button > buttoncontent > box`
// (:47-52), so the button's direct child is `buttoncontent` and neither `> box`
// nor `> box > box` matches through it. The icon↔label gap is the 6px from
// `buttoncontent > box` (:626-628). Inside a split button the class sits on the
// `splitbutton` node and `splitbutton.image-text-button > button` (:499-507)
// wins instead — 9px on the INNER button, and 6px on its direct box.
//
// Reference: refs/libadwaita/src/adw-button-content.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One property-default expectation. */
export interface ButtonContentDefaultVector {
    /** The `AdwButtonContent` property name, as GObject spells it. */
    property: 'icon-name' | 'label' | 'use-underline' | 'can-shrink';
    /** The `GParamSpec` default. */
    value: string | boolean;
    /** Why this row exists. */
    rule: string;
}

/** The four `GParamSpec` defaults (adw-button-content.c:229-272). */
export const BUTTON_CONTENT_DEFAULT_VECTORS: ReadonlyArray<ButtonContentDefaultVector> = [
    { property: 'icon-name', value: '', rule: 'empty string (:229-232), matching `g_strdup ("")` in init (:284)' },
    { property: 'label', value: '', rule: 'empty (:239-242), so the label node starts hidden (:300)' },
    { property: 'use-underline', value: false, rule: 'FALSE (:253-256) — the OPPOSITE of the banner button' },
    { property: 'can-shrink', value: false, rule: 'FALSE (:269-272), i.e. PANGO_ELLIPSIZE_NONE (Since 1.4)' },
];

/** One icon-name resolution expectation. */
export interface ButtonContentIconVector {
    /** The `icon-name` value. */
    iconName: string;
    /** The name the `GtkImage` is actually set from (:355-358). */
    resolved: string;
    /** Whether the resolved name is the empty-slot fallback rather than an app value. */
    isFallback: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_button_content_set_icon_name` (:355-358).
 *
 * THE DOCS AND THE CODE DISAGREE AND THIS TABLE FOLLOWS THE CODE. Both doc
 * comments say an empty `icon-name` means the icon "is not shown" (:228 on the
 * property, :343 on the setter). Nothing in the widget hides it:
 * `gtk_widget_set_visible` is called on the LABEL only (:300, :398), `init` sets
 * the image to `image-missing` while `icon_name` is still `""` (:284, :294), and
 * the setter re-applies that fallback for every empty value (:355-356). So a
 * default-constructed `AdwButtonContent` draws the broken-image glyph, and both
 * ports — which followed the prose and hid the icon — are the ones that diverge.
 * Encoding the prose would have pinned their guess under the word "conformance".
 */
export const BUTTON_CONTENT_ICON_VECTORS: ReadonlyArray<ButtonContentIconVector> = [
    {
        iconName: 'folder-download-symbolic',
        resolved: 'folder-download-symbolic',
        isFallback: false,
        rule: 'a real theme name is passed straight to gtk_image_set_from_icon_name (:358)',
    },
    {
        iconName: '',
        resolved: 'image-missing',
        isFallback: true,
        rule: 'empty → image-missing (:355-356). The docs at :228/:343 say the icon is HIDDEN; the code never hides it, and both ports believed the docs',
    },
    {
        iconName: ' ',
        resolved: ' ',
        isFallback: false,
        rule: 'icon_name[0] is a space, so the fallback does not fire — GTK then draws a missing icon by lookup failure, not by this branch',
    },
    {
        iconName: 'image-missing',
        resolved: 'image-missing',
        isFallback: false,
        rule: 'asking for the fallback by name is not the empty case — it is an app value',
    },
];

/** One label-slot expectation. */
export interface ButtonContentLabelVector {
    /** The `label` value. */
    label: string;
    /** Whether the label node is in the tree (:398). */
    visible: boolean;
    /** Whether the icon takes the box's free space (:399). */
    iconExpands: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_button_content_set_label` (:398-399) — the two calls it makes, both keyed
 * on `label[0]` and therefore exact complements.
 */
export const BUTTON_CONTENT_LABEL_VECTORS: ReadonlyArray<ButtonContentLabelVector> = [
    { label: 'Open', visible: true, iconExpands: false, rule: 'a label shows and the icon stops expanding' },
    { label: '', visible: false, iconExpands: true, rule: 'no label: node hidden, icon takes the space (:296 too)' },
    { label: ' ', visible: true, iconExpands: false, rule: 'label[0] is a space — a character, so the node shows' },
    { label: '0', visible: true, iconExpands: false, rule: 'a C string test, not a JS truthiness one' },
    { label: '_O', visible: true, iconExpands: false, rule: 'the mnemonic marker is a character here' },
];

/** One label-text expectation. */
export interface ButtonContentTextVector {
    /** The `label` value. */
    label: string;
    /** The `use-underline` value. */
    useUnderline: boolean;
    /** What a renderer without an accelerator layer paints. */
    text: string;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_button_content_set_use_underline` (:442) applied to the label.
 *
 * Absent from both ports, and it is the property the class docs single out —
 * "handles … connecting the mnemonic to the button automatically" (:42-43). The
 * default is FALSE (:253-256), so an underscore in an unconfigured button
 * content is a LITERAL, unlike the banner's action button.
 */
export const BUTTON_CONTENT_TEXT_VECTORS: ReadonlyArray<ButtonContentTextVector> = [
    { label: '_Open', useUnderline: true, text: 'Open', rule: 'the marker is removed and marks the O' },
    { label: '_Open', useUnderline: false, text: '_Open', rule: 'the DEFAULT — an underscore is a literal (:253-256)' },
    { label: 'Save __As', useUnderline: true, text: 'Save _As', rule: 'a doubled marker is one literal underscore' },
    { label: 'Save __As', useUnderline: false, text: 'Save __As', rule: 'both survive when mnemonics are off' },
    { label: 'Open_', useUnderline: true, text: 'Open', rule: 'a trailing lone marker marks nothing and is dropped' },
    { label: '', useUnderline: true, text: '', rule: 'empty in, empty out' },
];

/** One `can-shrink` expectation. */
export interface ButtonContentEllipsizeVector {
    /** The `can-shrink` value. */
    canShrink: boolean;
    /** The label's `PangoEllipsizeMode` (:489-491). */
    ellipsize: 'none' | 'end';
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_button_content_set_can_shrink` (:489-491), which the getter reads back as
 * `ellipsize != PANGO_ELLIPSIZE_NONE` (:462).
 *
 * The browser port had this; the NativeScript port had no such property, so the
 * shared story's `canShrink` control did nothing there.
 */
export const BUTTON_CONTENT_ELLIPSIZE_VECTORS: ReadonlyArray<ButtonContentEllipsizeVector> = [
    { canShrink: false, ellipsize: 'none', rule: 'the default — the label forces the button wider (:269-272)' },
    { canShrink: true, ellipsize: 'end', rule: 'PANGO_ELLIPSIZE_END, so the label truncates instead (:490)' },
];

/** One style-class targeting expectation. */
export interface ButtonContentStyleTargetVector {
    /** The ancestor chain, NEAREST first, as `adw_button_content_root` walks it. */
    ancestors: ReadonlyArray<'button' | 'menu-button' | 'split-button' | 'other'>;
    /** Index into {@link ancestors} that receives `image-text-button`, or `null`. */
    target: number | null;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_button_content_root` (:108-116) — nearest `GtkButton`, then ONE
 * substitution: if that button's DIRECT parent is an `AdwSplitButton`, the class
 * moves to the split button (:112-113).
 *
 * Neither renderer applied the class to anything at all, so every row here is a
 * new assertion rather than a pinned behaviour. The split-button row is the one
 * with a CSS consequence beyond padding: the class on the `splitbutton` node
 * selects `splitbutton.image-text-button > button` (_buttons.scss:499-507),
 * which is a different declaration block from the plain-button one.
 */
export const BUTTON_CONTENT_STYLE_TARGET_VECTORS: ReadonlyArray<ButtonContentStyleTargetVector> = [
    { ancestors: ['button'], target: 0, rule: 'a plain Gtk.Button takes the class itself (:115)' },
    {
        ancestors: ['button', 'split-button'],
        target: 1,
        rule: 'retargeted to the AdwSplitButton (:112-113) — the node the stylesheet styles (:499-507)',
    },
    {
        ancestors: ['button', 'menu-button'],
        target: 0,
        rule: 'no substitution for a GtkMenuButton: its INTERNAL button keeps it (:56-59)',
    },
    {
        ancestors: ['button', 'other', 'split-button'],
        target: 0,
        rule: 'the substitution tests gtk_widget_get_parent, so anything between defeats it (:112)',
    },
    {
        ancestors: ['other', 'button'],
        target: 1,
        rule: 'gtk_widget_get_ancestor skips non-button ancestors (:95)',
    },
    {
        ancestors: ['split-button'],
        target: null,
        rule: 'AdwSplitButton derives from GTK_TYPE_WIDGET (adw-split-button.c:112), so get_ancestor never finds it — only the retarget reaches it',
    },
    {
        ancestors: ['other'],
        target: null,
        rule: 'no button ancestor: the C would pass NULL to get_parent/add_css_class (:112-115), two CRITICALs — a port has nothing to style',
    },
    { ancestors: [], target: null, rule: 'an unparented content is the same "nothing to style" case' },
];
