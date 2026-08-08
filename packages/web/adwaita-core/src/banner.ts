// Adwaita banner behaviour — headless (ADR 0004).
//
// `Adw.Banner` has no arithmetic in it at all; its entire specification is five
// property DEFAULTS and three derivations. That is precisely why it needed
// lifting — a widget with nothing to compute is a widget nobody checks, and the
// two ports had drifted on the two defaults that decide whether anything is on
// screen and how the title is interpreted:
//
//   - `revealed` defaults to **FALSE** (adw-banner.c:456-459): a banner is
//     hidden until an app reveals it, which the class docs state outright
//     ("Banners are hidden by default", :47). `@gjsify/adwaita-nativescript`
//     initialised `_revealed = true` AND never wrote `visibility` in its
//     constructor, so the same markup produced an invisible strip in the browser
//     and a visible one on a device — the exact divergence class this package
//     exists to remove.
//   - `use-markup` defaults to **TRUE** (adw-banner.c:422-425). Both ports had
//     it opt-IN, and the browser element's comment asserted the C default was
//     off. The default lives here, as the SPEC value; the browser renderer
//     deliberately departs from it and says so at the call site, because Pango
//     markup and HTML are different languages and `innerHTML`-by-default would
//     make an injection sink out of a widget that is not one in GTK.
//
// The three derivations neither port had:
//
//   1. the button shows iff `label && label[0]` (:663) — a FIRST-CHARACTER test,
//      not a truthiness or a trimmed one, so `" "` is a label;
//   2. the button carries `use-underline=True` from the template
//      (adw-banner.ui:33), so `_` in the button label is a mnemonic marker —
//      while the TITLE label is pinned to `use-underline=False` (adw-banner.ui:20)
//      and keeps its underscores. The two halves of the same widget answer the
//      same character differently;
//   3. `button-style` (Since 1.7) adds/removes `.suggested-action` on the button
//      (:443-447 for the default, :751-777 for the switch). Neither renderer had
//      the property at all, so a suggested banner button rendered grey.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing, touches no global.
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
 * Every style class `button-style` MANAGES on the banner button.
 *
 * A renderer swaps within this set and leaves every other class alone — the C
 * only ever adds or removes `suggested-action` (:766, :769), it never rewrites
 * the button's class list.
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
 * The property defaults a freshly constructed `Adw.Banner` has, straight from
 * the `GParamSpec`s.
 *
 * Two of these are the whole reason this module exists, and both are easy to get
 * backwards from the rendered widget rather than from the source: `revealed` is
 * FALSE (:456-459) and `use-markup` is TRUE (:422-425).
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
 * Anything that is not a nick becomes `'default'`. That is NOT the C setter's
 * behaviour and cannot be: `adw_banner_set_button_style` guards the ENUM range
 * (:756-757) and returns without changing anything, because by the time it runs
 * the value is already an `AdwBannerButtonStyle`. A string never becomes one, so
 * there is nothing to keep — falling back to the property default is what
 * GObject itself does when an invalid nick reaches `g_object_set`.
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
 * The test is on the FIRST CHARACTER, so it is not a trim and not a truthiness
 * check on the trimmed value — `" "` is a one-character label and its button is
 * shown, blank-looking though it is. A renderer that trimmed here would silently
 * drop a button GTK draws.
 */
export function bannerButtonVisible(label: string | null | undefined): boolean {
    return typeof label === 'string' && label.length > 0;
}

/**
 * The text painted on the action button.
 *
 * The template pins the button to `use-underline=True` (adw-banner.ui:33) and
 * exposes no property to turn it off, so an `_` in `button-label` is ALWAYS an
 * accelerator marker — `"_Resume"` reads `Resume` with an underlined R. A
 * renderer with no accelerator layer wants the marker gone, which is what
 * {@link stripMnemonic} returns.
 *
 * The TITLE deliberately has no counterpart here: the same template pins the
 * title label to `use-underline=False` (adw-banner.ui:20), so a title keeps
 * every underscore it was given. Passing a title through this function would be
 * a bug, not a symmetry.
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
 * {@link ADW_BANNER_DEFAULTS}.
 *
 * Takes a `Partial` on purpose: a renderer reading attributes has "not set" as a
 * real state, and the whole point of this module is that "not set" resolves to
 * the libadwaita default rather than to whatever the renderer's field
 * initialiser happened to be.
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
