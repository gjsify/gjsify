// Adwaita button-content behaviour — headless (ADR 0004).
//
// `AdwButtonContent` "handles style classes and connecting the mnemonic to the
// button automatically" (adw-button-content.c:42-43).
//
// THE STYLE CLASS IS THE PAYLOAD. `adw_button_content_root` puts
// `image-text-button` on the parent button (:115) and `unroot` takes it off again
// (:126); that class carries `padding-left/right: 9px` (_buttons.scss:77-80)
// where a plain button has 17px (:72-75). Neither renderer tree contained the
// string, so every icon+label button was drawn with plain-button padding.
//
// Read the whole selector before copying a number out of it: the same block
// (_buttons.scss:77-91) also declares `> box, > box > box { border-spacing: 4px }`,
// which never reaches an `AdwButtonContent` — the tree is
// `button > buttoncontent > box > {image,label}` (:47-52), so the icon↔label gap
// is the 6px from `buttoncontent > box` (_buttons.scss:626-628). The 4px variant
// is for a hand-rolled box (`.text-button.image-button`); inside a split button
// `splitbutton.image-text-button > button` (:499-507) pads the INNER button.
//
// The two icon representations: `icon-name` is an icon-theme NAME
// (`gtk_image_set_from_icon_name`, :294/:358), which is what this module models;
// `@gjsify/adwaita-nativescript` holds a raw SVG string because it has no
// name→asset lookup. Only "is the slot empty" is representation-free, so it is
// exposed on its own ({@link buttonContentIconIsEmpty}) with the name derivation
// layered on top — an SVG-holding renderer picks its own fallback asset.
//
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/adw-split-button.c:112 (AdwSplitButton is a
//            GtkWidget, not a GtkButton — which is why the retarget exists)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
//            (image-text-button :77-91 · splitbutton override :499-507 ·
//             buttoncontent :626-645)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { stripMnemonic } from './glib.js';

/**
 * The style class `AdwButtonContent` stamps on its parent button (:115) and
 * removes again on unroot (:126).
 */
export const BUTTON_CONTENT_STYLE_CLASS = 'image-text-button';

/** The icon `GtkImage` falls back to for an empty `icon-name` (:355-356). */
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

/**
 * The property defaults a freshly constructed `AdwButtonContent` has, straight
 * from the `GParamSpec`s. All four are the empty/false end of their type.
 */
export const ADW_BUTTON_CONTENT_DEFAULTS: Readonly<AdwButtonContentProps> = {
    iconName: '', // :229-232, and `g_strdup ("")` in init (:284)
    label: '', // :239-242
    useUnderline: false, // :253-256
    canShrink: false, // :269-272
};

/**
 * Whether the icon slot is empty — the `!icon_name[0]` test at :355. Kept
 * separate from {@link buttonContentIconName} because it is the one icon question
 * an SVG-holding renderer can also ask.
 */
export function buttonContentIconIsEmpty(icon: string): boolean {
    return icon.length === 0;
}

/**
 * The icon-theme name the image is actually set from: `icon_name`, or
 * `image-missing` when it is empty (:355-358).
 *
 * UPSTREAM CONTRADICTION, resolved in favour of the CODE: both doc comments say
 * the icon "is not shown" when `icon-name` is empty (:228 on the property, :343
 * on the setter), but `gtk_widget_set_visible` is only ever called on the LABEL
 * (:300, :398), `init` sets the image to `image-missing` while `icon_name` is
 * still `""` (:284, :294), and the setter re-applies that fallback for every
 * empty value (:355-356). A default-constructed `AdwButtonContent` therefore
 * draws the broken-image glyph. Both ports followed the prose and hid the icon.
 */
export function buttonContentIconName(iconName: string): string {
    return buttonContentIconIsEmpty(iconName) ? BUTTON_CONTENT_FALLBACK_ICON : iconName;
}

/**
 * Whether the label node is in the tree: `gtk_widget_set_visible (self->label,
 * label[0])` (:398).
 *
 * First character, not truthiness and not a trim — `" "` is a label and its node
 * is shown.
 */
export function buttonContentLabelVisible(label: string): boolean {
    return label.length > 0;
}

/**
 * Whether the icon takes the box's free space: `gtk_widget_set_hexpand
 * (self->icon, !label[0])` (:399), matching the `TRUE` init sets while the label
 * is still empty (:296).
 *
 * With no label the icon expands and so centres itself inside the button; with a
 * label the pair sits together under the box's `halign: CENTER` (:289).
 */
export function buttonContentIconExpands(label: string): boolean {
    return !buttonContentLabelVisible(label);
}

/**
 * The text painted on the label, with mnemonic markers removed when
 * `use-underline` is set (:442).
 *
 * Default FALSE (:253-256), so an underscore survives unless the app asked for
 * mnemonics — the opposite default to the banner's action button, which its
 * template pins to TRUE.
 */
export function buttonContentLabelText(label: string, useUnderline: boolean): string {
    return useUnderline ? stripMnemonic(label) : label;
}

/**
 * The label's `PangoEllipsizeMode` for `can-shrink` — `END` or `NONE`
 * (:489-491), which is also how the getter reads the property back (:462).
 */
export function buttonContentEllipsize(canShrink: boolean): ButtonContentEllipsize {
    return canShrink ? 'end' : 'none';
}

/**
 * One entry of the ancestor chain `adw_button_content_root` walks, nearest first,
 * tagged by the only distinction the C makes.
 *
 * Neither `'menu-button'` (`GtkMenuButton`) nor `'split-button'`
 * (`AdwSplitButton`) derives from `GtkButton`, so neither is found by
 * `gtk_widget_get_ancestor (…, GTK_TYPE_BUTTON)` — which is why the retarget
 * exists. `'other'` is any other container.
 */
export type ButtonContentAncestor = 'button' | 'menu-button' | 'split-button' | 'other';

/**
 * Which ancestor receives {@link BUTTON_CONTENT_STYLE_CLASS}, as an INDEX into
 * `ancestors` (nearest first), or `null` when there is no button ancestor.
 *
 * `adw_button_content_root` (:108-116) takes the nearest `GtkButton`, then makes
 * ONE substitution: if that button's DIRECT parent is an `AdwSplitButton`, the
 * class goes on the split button instead (:112-113), because that is the node the
 * stylesheet styles (`splitbutton.image-text-button > button`,
 * _buttons.scss:499-507). Inside a `GtkMenuButton` no substitution happens, so
 * the menu button's INTERNAL button keeps the class (:56-59).
 *
 * MODIFICATION: `null` where the C does not survive — with no button ancestor
 * `gtk_widget_get_ancestor` returns `NULL` and the next lines call
 * `gtk_widget_get_parent (NULL)` / `gtk_widget_add_css_class (NULL, …)`
 * (:112-115), two `CRITICAL`s. A renderer has nothing to style; saying so beats
 * reproducing a crash.
 */
export function buttonContentStyleTargetIndex(ancestors: readonly ButtonContentAncestor[]): number | null {
    const button = ancestors.indexOf('button');
    if (button < 0) return null;
    return ancestors[button + 1] === 'split-button' ? button + 1 : button;
}

/** What one button-content derivation tells a renderer to draw. */
export interface AdwButtonContentRenderState {
    /** The icon-theme name the image node shows (:355-358). */
    iconName: string;
    /** Whether {@link iconName} is the empty-slot fallback rather than an app value. */
    iconIsFallback: boolean;
    /** Whether the icon takes the box's free space (:399). */
    iconExpands: boolean;
    /** Whether the label node is in the tree (:398). */
    labelVisible: boolean;
    /** The label text, mnemonic markers resolved (:442). */
    labelText: string;
    /** The label's ellipsize mode (:489-491). */
    ellipsize: ButtonContentEllipsize;
    /** The style class the parent button carries while this content is rooted (:115). */
    parentClass: string;
}

/**
 * The full render state for a button content, filling every unset property from
 * {@link ADW_BUTTON_CONTENT_DEFAULTS}.
 *
 * `parentClass` is constant but travels in the state anyway, so a renderer cannot
 * get everything else and still miss the class.
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
