// The runtime half of icon resolution — how a name OUTSIDE the compiled set gets drawn.
//
// `scripts/build-scss.mjs` inlines a chosen subset of `@gjsify/adwaita-icons` into the
// stylesheet as `--icon-<name>` custom properties plus matching `.adw-icon--<name>` mask
// classes. The subset exists because the whole set does not fit: 644 icons cost a measured
// 1 095 098 bytes of data-URI against a 190 KB stylesheet, so a consumer whose app needs a
// glyph this package does not ship needs a way in that is not "wait for a release".
//
// That is this module. `registerIcon` writes the SAME pair the generator writes — the
// custom property on the document element, the mask class into a stylesheet this module
// owns — so a registered icon is indistinguishable from a compiled one at every later
// point: `<adw-icon icon-name="…">`, a hand-written `class="adw-icon adw-icon--…"`, a
// widget attribute, `var(--icon-…)` in the consumer's own CSS.
//
//   import { registerIcon } from '@gjsify/adwaita-web';
//   import { dialogErrorSymbolic } from '@gjsify/adwaita-icons/status';
//
//   registerIcon('dialog-error-symbolic', dialogErrorSymbolic);
//   // …then anywhere: <adw-icon icon-name="dialog-error-symbolic"></adw-icon>
//
// Register BEFORE the icon is mounted where you can. An `<adw-icon>` already in the
// document draws the `image-missing` fallback (see `_icon.scss`) until the registration
// lands; the CSS is live, so it corrects itself on the next style recalculation with no
// re-render, but there is a visible frame in between.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+ — the icon SVGs.
// Original implementation.

import { normalizeIconName } from '@gjsify/adwaita-core';
import { toDataUri } from '@gjsify/adwaita-icons/utils';

import { MASK_CLASS_PREFIX } from './elements/adw-icon.js';

/** Marks the one `<style>` element this module owns, so a reload reuses it. */
const REGISTRY_STYLE_ID = 'adwaita-web-icon-registry';

/**
 * Names already given a mask rule. Re-registering a name has to update the GLYPH without
 * appending a second rule: the custom property carries the glyph and the rule only points
 * at it, so the property assignment is the whole update and a duplicate rule would be
 * dead weight that grows without bound under a live theme switcher.
 */
const ruled = new Set<string>();

/** This module's stylesheet, created on first use and appended last so nothing hides it. */
function registrySheet(): CSSStyleSheet {
    const existing = document.getElementById(REGISTRY_STYLE_ID) as HTMLStyleElement | null;
    if (existing?.sheet) return existing.sheet;

    const style = document.createElement('style');
    style.id = REGISTRY_STYLE_ID;
    document.head.appendChild(style);
    // `sheet` is non-null the moment a <style> is in a document — the property is only
    // null while the element is disconnected, which the append above rules out.
    return style.sheet as CSSStyleSheet;
}

/**
 * Make `name` drawable by every `.adw-icon` in the document, from an Adwaita symbolic SVG
 * source string (what `@gjsify/adwaita-icons` exports).
 *
 * The name is normalized exactly as `<adw-icon icon-name>` normalizes it — a single
 * `-symbolic` suffix comes off, and the rest must be one CSS token. A name that survives
 * neither THROWS rather than registering nothing: unlike a render, this is an explicit call
 * with a wrong argument, and silently doing nothing is the failure mode this whole area
 * exists to end. `<adw-icon>` keeps resolving an unusable name to "no icon", because there
 * the name came from markup and taking the page down over a typo is not proportionate.
 *
 * Registering a name the stylesheet already compiles is allowed and REPLACES the glyph:
 * the property is set on the document element, so it wins over the `:root` rule.
 */
export function registerIcon(name: string, svg: string): void {
    const resolved = normalizeIconName(name);
    if (resolved === '') {
        throw new TypeError(
            `registerIcon: ${JSON.stringify(name)} is not usable as an icon name — it has to be a single ` +
                'CSS token ([A-Za-z0-9_-]+) once an optional `-symbolic` suffix is removed.',
        );
    }

    document.documentElement.style.setProperty(`--icon-${resolved}`, toDataUri(svg));

    if (ruled.has(resolved)) return;
    const sheet = registrySheet();
    sheet.insertRule(
        `.${MASK_CLASS_PREFIX}${resolved} { mask-image: var(--icon-${resolved}); ` +
            `-webkit-mask-image: var(--icon-${resolved}); }`,
        sheet.cssRules.length,
    );
    ruled.add(resolved);
}

/**
 * Whether `name` has a glyph — compiled into the stylesheet, or registered at runtime.
 *
 * Reads the live cascade rather than a generated list, so it answers for a glyph that
 * arrived by any route, including a consumer's own `--icon-<name>` declaration. It is
 * deliberately the CUSTOM PROPERTY that is read and not the rendered `mask-image` of a
 * probe element: since `_icon.scss` gives every icon box the `image-missing` fallback,
 * a rendered mask is never `none`, and comparing against the fallback would answer
 * `false` for `image-missing` itself — the one name where being drawn and having fallen
 * back look identical.
 *
 * Narrowing worth knowing: a consumer who writes `.adw-icon--x { mask-image: url(…) }`
 * with no matching `--icon-x` gets `false` here and a drawn icon anyway. The generator and
 * {@link registerIcon} are the two things that create the pair, and both create both.
 */
export function isIconAvailable(name: string): boolean {
    const resolved = normalizeIconName(name);
    if (resolved === '') return false;
    return getComputedStyle(document.documentElement).getPropertyValue(`--icon-${resolved}`).trim() !== '';
}
