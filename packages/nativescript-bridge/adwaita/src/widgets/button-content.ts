// Button-content plumbing for NativeScript — the pure half.
//
// The BEHAVIOUR is headless and lives in `@gjsify/adwaita-core` (ADR 0004). What
// this module adds are the three NativeScript-shaped edges of it:
//
//   1. the parent button's `className`. `AdwButtonContent` exists partly to put
//      `image-text-button` on the button that hosts it (adw-button-content.c:115)
//      and take it off again on unroot (:126) — and `grep -rn
//      "image-text-button"` over this tree used to return nothing, so every
//      icon+label button here was drawn with a plain button's padding instead of
//      the 9px the class carries (_buttons.scss:77-80). NS views hold a
//      space-separated string rather than a `classList`, so the swap goes
//      through {@link replaceClasses} exactly as the toolbar view's does;
//   2. the icon FALLBACK. This port is handed SVG SOURCE rather than an
//      icon-theme name, so it cannot resolve `image-missing` by name the way the
//      browser renderer does — it imports the asset and substitutes it for an
//      empty slot itself. Core answers the representation-free half of that
//      question ({@link buttonContentIconIsEmpty});
//   3. `visibility`, which is how an NS view expresses `gtk_widget_set_visible`.
//
// FIDELITY GAP, stated rather than papered over: `can-shrink` is
// `PANGO_ELLIPSIZE_END` on the label (adw-button-content.c:489-491), and the
// NativeScript CSS subset has no ellipsize — `Label` exposes `textWrap` and
// nothing else portable, and a single-line NS label CLIPS. The property is held
// and reported (so the shared story control and the shared vectors drive
// something real, which they did not before: the property was absent here
// entirely), and it puts a `can-shrink` class on the content for the theme, but
// the truncation ellipsis is not available on this platform.
//
// Free of `@nativescript/core` value imports — like `icon-path.ts`,
// `row-press.ts` and `split-button.ts` — so the spec suite exercises the real
// shipping code off-device. `adw-button-content.ts` cannot serve that role: it
// `extends StackLayout`, which evaluates the bare `@nativescript/core` specifier
// at module-eval and is unresolvable on GJS/Node.
//
// Reference: refs/libadwaita/src/adw-button-content.c (AdwButtonContent)
// Reference: refs/libadwaita/src/stylesheet/widgets/_buttons.scss
//            (image-text-button :77-91 · buttoncontent :626-645)
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

// Re-exported so `adw-button-content.ts` and its consumers get both halves from
// one place, the way `split-button.ts` re-exports the shared menu types.
export { BUTTON_CONTENT_STYLE_CLASS, buttonContentEllipsize, buttonContentLabelText, buttonContentLabelVisible };
export type { ButtonContentEllipsize };

/** The class the content carries while `can-shrink` is set, for the theme to key off. */
export const BUTTON_CONTENT_CAN_SHRINK_CLASS = 'can-shrink';

/** Every class this widget MANAGES on its own node. */
const OWN_CLASSES: readonly string[] = [BUTTON_CONTENT_CAN_SHRINK_CLASS];

/**
 * The SVG the icon view is given: the app's, or the `image-missing` asset for an
 * empty slot.
 *
 * That fallback is `gtk_image_set_from_icon_name (icon, "image-missing")`
 * (adw-button-content.c:355-356), applied by `init` too while `icon_name` is
 * still `""` (:284, :294). The widget NEVER hides the image — only the label
 * (:300, :398) — so this port keeps the icon view parented at all times and
 * swaps its source, which is the same shape as the C. The doc comments at :228
 * and :343 claim the icon is hidden instead; the code disagrees with them and
 * this follows the code (see the conformance vector's `rule`).
 */
export function buttonContentIconSvg(svg: string): string {
    return buttonContentIconIsEmpty(svg) ? imageMissingSymbolic : svg;
}

/** Whether the icon shown is the empty-slot fallback rather than an app asset. */
export function buttonContentIconIsFallback(svg: string): boolean {
    return buttonContentIconIsEmpty(svg);
}

/**
 * The parent button's `className` with `image-text-button` added — the root-time
 * half of `adw_button_content_root` (:115).
 *
 * Adds rather than rewrites, so the `adw-button suggested-action pill` a caller
 * composed survives; and it is idempotent, so a re-parent cannot double the
 * token.
 */
export function buttonContentRootedParentClassName(current: string): string {
    return replaceClasses(current, [BUTTON_CONTENT_STYLE_CLASS], [BUTTON_CONTENT_STYLE_CLASS]);
}

/**
 * The parent button's `className` with `image-text-button` removed — the unroot
 * half (:126).
 *
 * The C removes it on unroot rather than leaving it behind, so a button that
 * loses its content goes back to plain-button padding. A port that only ever
 * added the class would leave the 9px on a button that is now text-only.
 */
export function buttonContentUnrootedParentClassName(current: string): string {
    return replaceClasses(current, [BUTTON_CONTENT_STYLE_CLASS], []);
}

/** The label view's `visibility` — NS's spelling of `gtk_widget_set_visible` (:398). */
export function buttonContentLabelVisibility(label: string): 'visible' | 'collapse' {
    return buttonContentLabelVisible(label) ? 'visible' : 'collapse';
}

/** The content's own `className` for a `can-shrink` value, other tokens untouched. */
export function buttonContentClassName(current: string, canShrink: boolean): string {
    return replaceClasses(current, OWN_CLASSES, canShrink ? [BUTTON_CONTENT_CAN_SHRINK_CLASS] : []);
}
