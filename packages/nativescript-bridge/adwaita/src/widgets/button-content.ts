// Button-content plumbing for NativeScript — the pure half.
//
// The BEHAVIOUR is headless and lives in `@gjsify/adwaita-core` (ADR 0004). Three
// edges are NativeScript-shaped:
//
//   1. the parent button's `className`. `AdwButtonContent` exists partly to put
//      `image-text-button` on its host button (9px of padding a plain button does
//      not have) and take it off again on unroot. NS views hold a space-separated
//      string rather than a `classList`, so the swap goes through
//      {@link replaceClasses};
//   2. the icon FALLBACK: this port is handed SVG SOURCE rather than an icon-theme
//      name, so it substitutes the `image-missing` asset itself instead of
//      resolving the name;
//   3. `visibility`, NS's spelling of `gtk_widget_set_visible`.
//
// FIDELITY GAP: `can-shrink` is `PANGO_ELLIPSIZE_END` on the label and the NS CSS
// subset has no ellipsize — a single-line NS label CLIPS. The property is held,
// reported and put on the content as a class for the theme, but the truncation
// ellipsis is not available on this platform.
//
// Free of `@nativescript/core` value imports so the spec suite exercises the real
// shipping code off-device; `adw-button-content.ts` cannot, because `extends
// StackLayout` evaluates the bare specifier at module-eval.
//
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    BUTTON_CONTENT_STYLE_CLASS,
    buttonContentEllipsize,
    buttonContentIconIsEmpty,
    buttonContentLabelText,
    buttonContentLabelVisible,
} from '@gjsify/adwaita-core';
import type { ButtonContentEllipsize } from '@gjsify/adwaita-core';
import { imageMissingSymbolic } from '@gjsify/adwaita-icons/status';
import { replaceClasses } from './chrome.js';

// Re-exported so `adw-button-content.ts` and its consumers get both halves from one place.
export { BUTTON_CONTENT_STYLE_CLASS, buttonContentEllipsize, buttonContentLabelText, buttonContentLabelVisible };
export type { ButtonContentEllipsize };

/** The class the content carries while `can-shrink` is set, for the theme to key off. */
export const BUTTON_CONTENT_CAN_SHRINK_CLASS = 'can-shrink';

/** Every class this widget MANAGES on its own node. */
const OWN_CLASSES: readonly string[] = [BUTTON_CONTENT_CAN_SHRINK_CLASS];

/**
 * The SVG the icon view is given: the app's, or the `image-missing` asset for an
 * empty slot — the fallback `init` applies too, while `icon_name` is still `""`.
 *
 * The C NEVER hides the image, only the label, so this port keeps the icon view
 * parented at all times and swaps its source. Upstream's own doc comments claim the
 * icon is hidden instead; the code disagrees with them and this follows the code
 * (see the conformance vector's `rule`).
 */
export function buttonContentIconSvg(svg: string): string {
    return buttonContentIconIsEmpty(svg) ? imageMissingSymbolic : svg;
}

/** Whether the icon shown is the empty-slot fallback rather than an app asset. */
export function buttonContentIconIsFallback(svg: string): boolean {
    return buttonContentIconIsEmpty(svg);
}

/**
 * The parent button's `className` with `image-text-button` added — the root-time half
 * of `adw_button_content_root`. Adds rather than rewrites, so a caller's composed
 * classes survive, and is idempotent, so a re-parent cannot double the token.
 */
export function buttonContentRootedParentClassName(current: string): string {
    return replaceClasses(current, [BUTTON_CONTENT_STYLE_CLASS], [BUTTON_CONTENT_STYLE_CLASS]);
}

/**
 * The parent button's `className` with `image-text-button` removed — the unroot half.
 * A button that loses its content must go back to plain-button padding, or the 9px
 * stays on a now text-only button.
 */
export function buttonContentUnrootedParentClassName(current: string): string {
    return replaceClasses(current, [BUTTON_CONTENT_STYLE_CLASS], []);
}

/** The label view's `visibility` — NS's spelling of `gtk_widget_set_visible`. */
export function buttonContentLabelVisibility(label: string): 'visible' | 'collapse' {
    return buttonContentLabelVisible(label) ? 'visible' : 'collapse';
}

/** The content's own `className` for a `can-shrink` value, other tokens untouched. */
export function buttonContentClassName(current: string, canShrink: boolean): string {
    return replaceClasses(current, OWN_CLASSES, canShrink ? [BUTTON_CONTENT_CAN_SHRINK_CLASS] : []);
}
