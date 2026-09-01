// The runtime half of icon resolution — how a name OUTSIDE the compiled set gets drawn.
//
// `scripts/build-scss.mjs` inlines a chosen subset of `@gjsify/adwaita-icons` into the
// stylesheet as `--icon-<name>` custom properties plus matching `.adw-icon--<name>` mask
// classes. The subset exists because the whole set does not fit — inlining every icon that
// package exports costs a measured ~1.07 MB of data-URI, some five times the stylesheet it
// would sit in — so a consumer whose app needs a glyph this package does not ship needs a
// way in that is not "wait for a release".
//
// That is this module. `registerIcon` writes the SAME pair the generator writes — the
// custom property on the document element, the mask class into a stylesheet this module
// owns — so a registered icon is indistinguishable from a compiled one at every later
// point: `<gtk-image icon-name="…">`, a hand-written `class="adw-icon adw-icon--…"`, a
// widget attribute, `var(--icon-…)` in the consumer's own CSS.
//
//   import { registerIcon } from '@gjsify/adwaita-web';
//   import { dialogErrorSymbolic } from '@gjsify/adwaita-icons/status';
//
//   registerIcon('dialog-error-symbolic', dialogErrorSymbolic);
//   // …then anywhere: <gtk-image icon-name="dialog-error-symbolic"></gtk-image>
//
// Register BEFORE the icon is mounted where you can. A `<gtk-image>` already in the
// document draws the `image-missing` fallback (see `_icon.scss`) until the registration
// lands; the CSS is live, so it corrects itself on the next style recalculation with no
// re-render, but there is a visible frame in between.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+ — the icon SVGs.
// Original implementation.

import { normalizeIconName } from '@gjsify/adwaita-core';
import { toDataUri } from '@gjsify/adwaita-icons/utils';

import { MASK_CLASS_PREFIX } from './elements/gtk-image.js';

/** Marks the one `<style>` element this module owns, so a reload reuses it. */
const REGISTRY_STYLE_ID = 'adwaita-web-icon-registry';

/**
 * Names already given a mask rule. Re-registering a name has to update the GLYPH without
 * appending a second rule: the custom property carries the glyph and the rule only points
 * at it, so the property assignment is the whole update and a duplicate rule would be
 * dead weight that grows without bound under a live theme switcher.
 */
const ruled = new Set<string>();

/** The one rule a registration adds: the class, pointing at the custom property. */
function insertMaskRule(sheet: CSSStyleSheet, name: string): void {
    sheet.insertRule(
        `.${MASK_CLASS_PREFIX}${name} { mask-image: var(--icon-${name}); ` +
            `-webkit-mask-image: var(--icon-${name}); }`,
        sheet.cssRules.length,
    );
}

/** This module's stylesheet, created on first use and appended last so nothing hides it. */
function registrySheet(): CSSStyleSheet {
    const existing = document.getElementById(REGISTRY_STYLE_ID) as HTMLStyleElement | null;
    if (existing?.sheet) return existing.sheet;

    const style = document.createElement('style');
    style.id = REGISTRY_STYLE_ID;
    document.head.appendChild(style);
    // `sheet` is non-null the moment a <style> is in a document — the property is only
    // null while the element is disconnected, which the append above rules out.
    const sheet = style.sheet as CSSStyleSheet;

    // Reaching here a SECOND time means the previous element was taken away — an SPA head
    // swap, an Astro view transition — and every rule it held went with it. The custom
    // properties did NOT: they sit on the document element. So re-issue the rules, or every
    // name registered before the swap keeps its glyph in a property nothing consumes and
    // draws the fallback forever. Nothing observes the head, so the recovery happens on the
    // next `registerIcon` call rather than at the moment of the swap.
    for (const name of ruled) insertMaskRule(sheet, name);
    return sheet;
}

/**
 * The second argument has to be SVG SOURCE, and nothing else can tell us so: `toDataUri`
 * percent-encodes whatever it is handed, so `registerIcon('x', 'not an svg')` produces a
 * perfectly well-formed `mask-image` that masks NOTHING — an icon strictly worse than an
 * unregistered one, because the registered class beats `:where(.adw-icon)` and switches the
 * `image-missing` fallback OFF, while `isIconAvailable` reports `true`. Measured in Firefox:
 * `url("data:image/svg+xml,not%20an%20svg")`, 0 % of the box painted, no throw, no warning.
 *
 * A real parser rather than a `^<svg` test: an icon read from a file carries an XML prolog
 * or a DOCTYPE before its root element, and both are legitimate here.
 */
function svgRootOf(source: string): Element {
    return new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
}

/**
 * Make `name` drawable by every `.adw-icon` in the document, from an Adwaita symbolic SVG
 * source string (what `@gjsify/adwaita-icons` exports).
 *
 * BOTH arguments are checked and a wrong one THROWS rather than registering nothing: unlike
 * a render, this is an explicit call with a wrong argument, and silently doing nothing is
 * the failure mode this whole area exists to end. The name is normalized exactly as
 * `<gtk-image icon-name>` normalizes it — a single `-symbolic` suffix comes off, and the rest
 * must be one CSS token; the SVG has to parse to an `<svg>` root. `<gtk-image>` draws
 * `image-missing` for the same unusable name instead — there it came from markup, and
 * taking the page down over a typo is not proportionate.
 *
 * Registering a name the stylesheet already compiles is allowed and REPLACES the glyph:
 * the property is set on the document element, so it wins over the `:root` rule.
 *
 * CLIENT-SIDE ONLY: this touches `document.documentElement` and `document.head`, so at
 * module top level in an SSR/SSG build it throws before a page is rendered.
 */
export function registerIcon(name: string, svg: string): void {
    const resolved = normalizeIconName(name);
    if (resolved === '') {
        throw new TypeError(
            `registerIcon: ${JSON.stringify(name)} is not usable as an icon name — it has to be a single ` +
                'CSS token ([A-Za-z0-9_-]+) once an optional `-symbolic` suffix is removed.',
        );
    }

    const root = svgRootOf(svg);
    if (root.tagName !== 'svg') {
        throw new TypeError(
            `registerIcon(${JSON.stringify(resolved)}): the second argument has to be SVG SOURCE — the ` +
                'kind of string `@gjsify/adwaita-icons` exports, not a URL, a data-URI or a DOM node. ' +
                `Parsing it produced <${root.tagName}>, so it would have masked nothing at all.`,
        );
    }

    document.documentElement.style.setProperty(`--icon-${resolved}`, toDataUri(svg));

    // BEFORE the `ruled` early return: taking the sheet is what detects a lost <style>,
    // and a name already in `ruled` is exactly the one the early return would skip.
    const sheet = registrySheet();
    if (ruled.has(resolved)) return;
    insertMaskRule(sheet, resolved);
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
