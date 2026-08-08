// Adwaita button-content behaviour — headless (ADR 0004).
//
// `AdwButtonContent` is the icon+label child of a button, and its job description
// is one sentence in the C docs: "handles style classes and connecting the
// mnemonic to the button automatically" (adw-button-content.c:42-43). Both of
// those were missing from both ports.
//
// THE STYLE CLASS IS THE PAYLOAD. `adw_button_content_root` puts
// `image-text-button` on the parent button (:115) and `unroot` takes it off
// again (:126). `grep -rn "image-text-button"` over both renderer trees returned
// NOTHING, and the stylesheet gives that class `padding-left/right: 9px`
// (_buttons.scss:77-80) where a plain button has 17px of text padding
// (:72-75) — so every icon+label button in both ports has been drawn with the
// wrong horizontal padding for its whole life, and no test was in a position to
// say so.
//
// Read the whole selector before copying the number out of it. The block at
// _buttons.scss:77-91 ALSO declares `> box, > box > box { border-spacing: 4px }`,
// and that part does NOT reach an `AdwButtonContent`: the node tree is
// `button > buttoncontent > box > {image,label}` (adw-button-content.c:47-52), so
// the button's direct child is `buttoncontent`, not `box`. The icon↔label gap
// stays the 6px from `buttoncontent > box` (_buttons.scss:626-628). The 4px
// variant is for a button whose child
// is a hand-rolled box — the `.text-button.image-button` case in the same
// selector list. Inside a split button the winning rule is different again:
// `splitbutton.image-text-button > button` (:499-507) pads the INNER button and
// gives ITS direct box 6px.
//
// The rest is small and was also absent:
//
//   - an empty `icon-name` resolves to `image-missing` (:355-356) — see the
//     documented contradiction on {@link buttonContentIconName};
//   - the label is HIDDEN when empty and the icon takes the freed space
//     (:398-399), both keyed on the FIRST CHARACTER;
//   - `use-underline` (:431-445) makes `_` a mnemonic marker, default FALSE
//     (:253-256) — the opposite of the banner button, which is pinned to TRUE by
//     its template;
//   - `can-shrink` (:462, :489-491) is `PANGO_ELLIPSIZE_END` on the label,
//     default FALSE (:269-272). The browser port had it; the NativeScript port
//     had no such property.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing, touches no global.
//
// ON THE TWO ICON REPRESENTATIONS: `AdwButtonContent:icon-name` is an icon-theme
// NAME (`gtk_image_set_from_icon_name`, :294/:358), so that is what this module
// models. `@gjsify/adwaita-nativescript` takes a raw SVG string instead, which is
// not a second representation of the property — it is the NS port having no
// name→asset lookup. The one question that is genuinely representation-free is
// "is the slot empty", so that is exposed on its own as
// {@link buttonContentIconIsEmpty} and the name derivation is layered on top of
// it. A renderer holding SVGs answers the empty question with core and picks its
// own fallback asset; a renderer holding names uses the name derivation whole.
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
 * Whether the icon slot is empty — the `!icon_name[0]` test at :355.
 *
 * The one icon question that does not depend on how a renderer represents the
 * icon: a name is empty or it is not, an SVG string is empty or it is not. Kept
 * separate from {@link buttonContentIconName} so the NativeScript port, which
 * holds SVG source rather than theme names, has something in core to ask.
 */
export function buttonContentIconIsEmpty(icon: string): boolean {
    return icon.length === 0;
}

/**
 * The icon-theme name the image is actually set from: `icon_name`, or
 * `image-missing` when it is empty (:355-358).
 *
 * UPSTREAM CONTRADICTION — the code and the docs disagree, and this follows the
 * CODE. Both doc comments say the icon "is not shown" when `icon-name` is empty
 * (:228 on the property, :343 on the setter), but nothing in the widget ever
 * hides `self->icon`: `gtk_widget_set_visible` is called on the LABEL (:300,
 * :398) and never on the image, `init` sets the image to `image-missing` while
 * `icon_name` is still `""` (:284, :294), and the setter re-applies that
 * fallback for every empty value (:355-356). A default-constructed
 * `AdwButtonContent` therefore draws the broken-image glyph. Both ports followed
 * the prose and hid the icon; a vector written from the prose would have pinned
 * that guess and shipped it under the word "conformance", which is the one thing
 * these tables must not do.
 */
export function buttonContentIconName(iconName: string): string {
    return buttonContentIconIsEmpty(iconName) ? BUTTON_CONTENT_FALLBACK_ICON : iconName;
}

/**
 * Whether the label node is in the tree: `gtk_widget_set_visible (self->label,
 * label[0])` (:398).
 *
 * First character, not truthiness and not a trim — `" "` is a label and its node
 * is shown, exactly as with the banner button.
 */
export function buttonContentLabelVisible(label: string): boolean {
    return label.length > 0;
}

/**
 * Whether the icon takes the box's free space: `gtk_widget_set_hexpand
 * (self->icon, !label[0])` (:399), matching the `TRUE` init sets while the label
 * is still empty (:296).
 *
 * The complement of {@link buttonContentLabelVisible} by construction, and named
 * for what it DOES rather than derived at each call site: with no label the icon
 * expands and so centres itself inside the button; with a label the pair sits
 * together under the box's `halign: CENTER` (:289).
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
 * One entry of the ancestor chain `adw_button_content_root` walks, nearest
 * first, tagged by the only distinction the C makes.
 *
 * `'button'` is a `GtkButton` (or any subclass); `'menu-button'` and
 * `'split-button'` are `GtkMenuButton` and `AdwSplitButton`, neither of which
 * derives from `GtkButton` — `AdwSplitButton` is a `GtkWidget`
 * (adw-split-button.c:112), which is exactly why it cannot be found by
 * `gtk_widget_get_ancestor (…, GTK_TYPE_BUTTON)` and needs the retarget.
 * `'other'` is any other container.
 */
export type ButtonContentAncestor = 'button' | 'menu-button' | 'split-button' | 'other';

/**
 * Which ancestor receives {@link BUTTON_CONTENT_STYLE_CLASS}, as an INDEX into
 * `ancestors` (nearest first), or `null` when there is no button ancestor.
 *
 * `adw_button_content_root` (:108-116) takes the nearest `GtkButton`, then makes
 * ONE substitution: if that button's DIRECT parent is an `AdwSplitButton`, the
 * class goes on the split button instead (:112-113), because the split button is
 * the node the stylesheet styles (`splitbutton.image-text-button > button`,
 * _buttons.scss:499-507). Inside a `GtkMenuButton` no substitution happens, so
 * the menu button's INTERNAL button keeps the class — which is what the class
 * docs describe (:56-59).
 *
 * `null` is this port's answer to a case the C does not survive: with no button
 * ancestor at all `gtk_widget_get_ancestor` returns `NULL`, and the very next
 * lines call `gtk_widget_get_parent (NULL)` and `gtk_widget_add_css_class (NULL,
 * …)` (:112-115), which are two `CRITICAL`s. A renderer has nothing to style,
 * and saying so is better than reproducing a crash.
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
 * `parentClass` is constant, and is in the state anyway so a renderer takes the
 * class from the same call that gives it the rest — the whole defect this module
 * fixes was a renderer never being handed that string at all.
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
