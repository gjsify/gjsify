// Adwaita banner behaviour — headless (ADR 0004).
//
// `Adw.Banner` has no arithmetic; its whole specification is five property
// defaults and three derivations. Two defaults read backwards from the rendered
// widget and are the reason this module exists: `revealed` is FALSE
// (adw-banner.c:456-459, and the class docs say so at :47) and `use-markup` is
// TRUE (:422-425).
//
// MODIFICATION: the spec value for `use-markup` lives here, but the browser
// renderer deliberately departs from it and says so at its call site — Pango
// markup and HTML are different languages, and `innerHTML`-by-default would make
// an injection sink out of a widget that is not one in GTK.
//
// Reference: refs/libadwaita/src/adw-banner.c (AdwBanner)
// Reference: refs/libadwaita/src/adw-banner.ui (the template both labels come from)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss (banner :243-262)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { stripMnemonic } from './glib.js';

/**
 * `AdwBannerButtonStyle` as a string union — the two enum nicks
 * (adw-banner.c:23-35, Since 1.7).
 */
export type AdwBannerButtonStyle = 'default' | 'suggested';

/** Both `AdwBannerButtonStyle` members, in enum order. */
export const ADW_BANNER_BUTTON_STYLES: readonly AdwBannerButtonStyle[] = ['default', 'suggested'];

/**
 * Every style class `button-style` MANAGES on the banner button. A renderer swaps
 * within this set and leaves every other class alone — the C only ever adds or
 * removes `suggested-action` (:766, :769), it never rewrites the class list.
 */
export const ADW_BANNER_BUTTON_STYLE_CLASSES: readonly string[] = ['suggested-action'];

/** The five `Adw.Banner` properties, as a renderer holds them. */
export interface AdwBannerProps {
    /** `title` — the message. Pango markup when {@link useMarkup}. */
    title: string;
    /** `button-label` — empty means no button. */
    buttonLabel: string;
    /** `revealed` — whether the strip is on screen. */
    revealed: boolean;
    /** `use-markup` — whether {@link title} is Pango markup. */
    useMarkup: boolean;
    /** `button-style` — grey (`'default'`) or `.suggested-action`. */
    buttonStyle: AdwBannerButtonStyle;
}

/**
 * The property defaults a freshly constructed `Adw.Banner` has, straight from the
 * `GParamSpec`s.
 */
export const ADW_BANNER_DEFAULTS: Readonly<AdwBannerProps> = {
    title: '', // :391-394
    buttonLabel: '', // :408-411
    revealed: false, // :456-459
    useMarkup: true, // :422-425
    buttonStyle: 'default', // :443-447 (ADW_BANNER_BUTTON_DEFAULT)
};

/** Whether `value` is one of the two `AdwBannerButtonStyle` nicks. */
export function isBannerButtonStyle(value: unknown): value is AdwBannerButtonStyle {
    return value === 'default' || value === 'suggested';
}

/**
 * The button style for a renderer-supplied string — an HTML attribute, an XML
 * property, a JSON config.
 *
 * MODIFICATION: anything that is not a nick becomes `'default'`, where
 * `adw_banner_set_button_style` guards the ENUM range and keeps the old value
 * (:756-757). It can afford to — by then the value already IS an
 * `AdwBannerButtonStyle`; a string never becomes one, so there is nothing to keep.
 * Falling back to the property default is what `g_object_set` does with an invalid
 * nick.
 */
export function parseBannerButtonStyle(value: string | null | undefined): AdwBannerButtonStyle {
    return isBannerButtonStyle(value) ? value : ADW_BANNER_DEFAULTS.buttonStyle;
}

/**
 * The style classes the banner button carries for `style` —
 * `adw_banner_set_button_style`'s switch (:764-774).
 */
export function bannerButtonStyleClasses(style: AdwBannerButtonStyle): readonly string[] {
    return style === 'suggested' ? ADW_BANNER_BUTTON_STYLE_CLASSES : [];
}

/**
 * Whether the action button is shown: `gtk_widget_set_visible (button, label &&
 * label[0])` (:663).
 *
 * FIRST CHARACTER, not a trim — `" "` is a label and its button is shown,
 * blank-looking though it is. A renderer that trimmed would drop a button GTK
 * draws.
 */
export function bannerButtonVisible(label: string | null | undefined): boolean {
    return typeof label === 'string' && label.length > 0;
}

/**
 * The text painted on the action button.
 *
 * The template pins the button to `use-underline=True` (adw-banner.ui:33) with no
 * property to turn it off, so `_` in `button-label` is ALWAYS an accelerator
 * marker. The TITLE has no counterpart here on purpose: the same template pins it
 * to `use-underline=False` (adw-banner.ui:20), so a title keeps its underscores
 * and passing one through this function is a bug, not a symmetry.
 */
export function bannerButtonText(label: string): string {
    return stripMnemonic(label);
}

/** What one banner derivation tells a renderer to draw. */
export interface AdwBannerRenderState {
    /** Whether the strip is on screen (`GtkRevealer:reveal-child`, :817). */
    revealed: boolean;
    /** Whether {@link AdwBannerProps.title} is to be read as Pango markup. */
    useMarkup: boolean;
    /** Whether the action button is in the tree (:663). */
    buttonVisible: boolean;
    /** The button's label with mnemonic markers removed. */
    buttonText: string;
    /** The style classes `button-style` puts on the button (:764-774). */
    buttonClasses: readonly string[];
}

/**
 * The full render state for a banner, filling every unset property from
 * {@link ADW_BANNER_DEFAULTS}. `Partial` on purpose: a renderer reading attributes
 * has "not set" as a real state, and it must resolve to the libadwaita default
 * rather than to a field initialiser.
 */
export function bannerRenderState(props: Partial<AdwBannerProps> = {}): AdwBannerRenderState {
    const resolved = { ...ADW_BANNER_DEFAULTS, ...props };
    return {
        revealed: resolved.revealed,
        useMarkup: resolved.useMarkup,
        buttonVisible: bannerButtonVisible(resolved.buttonLabel),
        buttonText: bannerButtonText(resolved.buttonLabel),
        buttonClasses: bannerButtonStyleClasses(resolved.buttonStyle),
    };
}
