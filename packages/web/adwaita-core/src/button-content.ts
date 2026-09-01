// Adwaita button-content behaviour — headless (ADR 0004).
//
// THE STYLE CLASS IS THE PAYLOAD: `adw_button_content_root` puts
// `image-text-button` on the parent button and `unroot` takes it off again; that
// class carries `padding-left/right: 9px` where a plain button has 17px.
//
// Read the whole selector before copying a number out of `_buttons.scss`: its
// `> box, > box > box { border-spacing: 4px }` never reaches an `AdwButtonContent`
// — the tree is `button > buttoncontent > box > {image,label}`, so the icon↔label
// gap is the 6px from `buttoncontent > box`. The 4px variant is for a hand-rolled
// box (`.text-button.image-button`); inside a split button
// `splitbutton.image-text-button > button` pads the INNER button.
//
// `icon-name` is an icon-theme NAME (`gtk_image_set_from_icon_name`), which is what
// this module models; `@gjsify/adwaita-nativescript` holds a raw SVG string because
// it has no name→asset lookup. Only "is the slot empty" is representation-free, so
// it is exposed on its own ({@link buttonContentIconIsEmpty}) with the name
// derivation layered on top.
//
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/adw-split-button.c (AdwSplitButton is a GtkWidget,
//            not a GtkButton — which is why the retarget exists)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { stripMnemonic } from './glib.js';

/** The style class `AdwButtonContent` stamps on its parent button, removed on unroot. */
export const BUTTON_CONTENT_STYLE_CLASS = 'image-text-button';

/**
 * The gap between the icon and the label, in px.
 *
 * MEASURED rather than read off a selector, because the selector is easy to read
 * wrong — the header above says why `_buttons.scss`'s 4px variant never reaches an
 * `AdwButtonContent`. Against libadwaita 1.9.3: an `AdwButtonContent` with
 * `icon-name` and `label` inside a `GtkButton` in a presented window puts the image
 * at x=161 width=16 and the label at x=183, i.e. exactly 6px apart.
 *
 * It is `border-spacing` on `buttoncontent > box` and NOT `GtkBox:spacing`, which
 * reads 0 on the same widget — a renderer copying the property would draw them
 * touching.
 */
export const BUTTON_CONTENT_BOX_SPACING = 6;

/** The icon `GtkImage` falls back to for an empty `icon-name`. */
export const BUTTON_CONTENT_FALLBACK_ICON = 'image-missing';

/** How `can-shrink` reaches the label — `PangoEllipsizeMode` as a string union. */
export type ButtonContentEllipsize = 'none' | 'end';

/** The four `AdwButtonContent` properties, as a renderer holds them. */
export interface AdwButtonContentProps {
    /** `icon-name` — an icon-theme name. Empty means {@link BUTTON_CONTENT_FALLBACK_ICON}. */
    iconName: string;
    /** `label` — empty hides the label node. */
    label: string;
    /** `use-underline` — whether `_` marks a mnemonic in {@link label}. */
    useUnderline: boolean;
    /** `can-shrink` — whether the label ellipsizes rather than widening the button. */
    canShrink: boolean;
}

/** The property defaults of a freshly constructed `AdwButtonContent`, from the `GParamSpec`s. */
export const ADW_BUTTON_CONTENT_DEFAULTS: Readonly<AdwButtonContentProps> = {
    iconName: '', // `g_strdup ("")` in init, not NULL
    label: '',
    useUnderline: false,
    canShrink: false,
};

/**
 * Whether the icon slot is empty — the `!icon_name[0]` test. Separate from
 * {@link buttonContentIconName} because it is the one icon question an SVG-holding
 * renderer can also ask.
 */
export function buttonContentIconIsEmpty(icon: string): boolean {
    return icon.length === 0;
}

/**
 * The icon-theme name the image is actually set from: `icon_name`, or
 * `image-missing` when it is empty.
 *
 * UPSTREAM CONTRADICTION, resolved in favour of the CODE: both libadwaita doc
 * comments say the icon "is not shown" when `icon-name` is empty, but
 * `gtk_widget_set_visible` is only ever called on the LABEL, `init` sets the image to
 * `image-missing` while `icon_name` is still `""`, and the setter re-applies that
 * fallback for every empty value. A default-constructed `AdwButtonContent` therefore
 * draws the broken-image glyph.
 */
export function buttonContentIconName(iconName: string): string {
    return buttonContentIconIsEmpty(iconName) ? BUTTON_CONTENT_FALLBACK_ICON : iconName;
}

/**
 * Whether the label node is in the tree: `gtk_widget_set_visible (self->label,
 * label[0])` — first character, not truthiness and not a trim, so `" "` is a label
 * and its node is shown.
 */
export function buttonContentLabelVisible(label: string): boolean {
    return label.length > 0;
}

/**
 * Whether the icon takes the box's free space: `gtk_widget_set_hexpand (self->icon,
 * !label[0])`. With no label the icon expands and so centres itself inside the
 * button; with a label the pair sits together under the box's `halign: CENTER`.
 */
export function buttonContentIconExpands(label: string): boolean {
    return !buttonContentLabelVisible(label);
}

/**
 * The text painted on the label, with mnemonic markers removed when `use-underline`
 * is set. Default FALSE, so an underscore survives unless the app asked for
 * mnemonics — the opposite default to the banner's action button, whose template
 * pins it to TRUE.
 */
export function buttonContentLabelText(label: string, useUnderline: boolean): string {
    return useUnderline ? stripMnemonic(label) : label;
}

/** The label's `PangoEllipsizeMode` for `can-shrink` — `END` or `NONE`. */
export function buttonContentEllipsize(canShrink: boolean): ButtonContentEllipsize {
    return canShrink ? 'end' : 'none';
}

/**
 * One entry of the ancestor chain `adw_button_content_root` walks, nearest first.
 *
 * Neither `'menu-button'` (`GtkMenuButton`) nor `'split-button'` (`AdwSplitButton`)
 * derives from `GtkButton`, so neither is found by
 * `gtk_widget_get_ancestor (…, GTK_TYPE_BUTTON)` — which is why the retarget exists.
 */
export type ButtonContentAncestor = 'button' | 'menu-button' | 'split-button' | 'other';

/**
 * Which ancestor receives {@link BUTTON_CONTENT_STYLE_CLASS}, as an INDEX into
 * `ancestors` (nearest first), or `null` when there is no button ancestor.
 *
 * `adw_button_content_root` takes the nearest `GtkButton`, then makes ONE
 * substitution: if that button's DIRECT parent is an `AdwSplitButton`, the class goes
 * on the split button instead, because that is the node the stylesheet styles
 * (`splitbutton.image-text-button > button`). Inside a `GtkMenuButton` no
 * substitution happens, so the menu button's INTERNAL button keeps the class.
 *
 * MODIFICATION: `null` where the C does not survive — with no button ancestor
 * `gtk_widget_get_ancestor` returns `NULL` and the next lines call
 * `gtk_widget_get_parent (NULL)` / `gtk_widget_add_css_class (NULL, …)`, two
 * `CRITICAL`s. A renderer has nothing to style; saying so beats reproducing a crash.
 */
export function buttonContentStyleTargetIndex(ancestors: readonly ButtonContentAncestor[]): number | null {
    const button = ancestors.indexOf('button');
    if (button < 0) return null;
    return ancestors[button + 1] === 'split-button' ? button + 1 : button;
}

/** What one button-content derivation tells a renderer to draw. */
export interface AdwButtonContentRenderState {
    iconName: string;
    /** Whether {@link iconName} is the empty-slot fallback rather than an app value. */
    iconIsFallback: boolean;
    /** Whether the icon takes the box's free space. */
    iconExpands: boolean;
    labelVisible: boolean;
    /** The label text, mnemonic markers resolved. */
    labelText: string;
    ellipsize: ButtonContentEllipsize;
    /** The style class the parent button carries while this content is rooted. */
    parentClass: string;
}

/**
 * The full render state for a button content, filling every unset property from
 * {@link ADW_BUTTON_CONTENT_DEFAULTS}. `parentClass` is constant but travels in the
 * state anyway, so a renderer cannot get everything else and still miss the class.
 */
export function buttonContentRenderState(props: Partial<AdwButtonContentProps> = {}): AdwButtonContentRenderState {
    const resolved = { ...ADW_BUTTON_CONTENT_DEFAULTS, ...props };
    return {
        iconName: buttonContentIconName(resolved.iconName),
        iconIsFallback: buttonContentIconIsEmpty(resolved.iconName),
        iconExpands: buttonContentIconExpands(resolved.label),
        labelVisible: buttonContentLabelVisible(resolved.label),
        labelText: buttonContentLabelText(resolved.label, resolved.useUnderline),
        ellipsize: buttonContentEllipsize(resolved.canShrink),
        parentClass: BUTTON_CONTENT_STYLE_CLASS,
    };
}
