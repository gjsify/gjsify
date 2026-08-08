// Window chrome for NativeScript — the pure half.
//
// The arithmetic is HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004).
// What this module adds is the NativeScript-shaped edges of it: the "no layout
// pass yet" case, and turning class LISTS into the space-separated `className`
// string NS views carry (there is no `classList` in the NS CSS subset).
//
// The clamp is why this exists. `AdwClamp.setChild` used to do
// `view.width = this._maximumSize`, and an NS `width` is an EXACT size, not a
// cap — so a 360 DIP phone was handed a 600 DIP child that overflowed the
// screen, where `Adw.Clamp` would have given it all 360. Below the tightening
// threshold libadwaita hands the child exactly the available size
// (adw-clamp-layout.c:226-227); the cap only starts biting further up, and it
// eases in rather than snapping.
//
// `AdwBanner` is here for the opposite reason: it has no arithmetic at all, and
// that is exactly why nobody checked it. Its whole spec is five property
// defaults and three derivations, and the port had `revealed` initialised to
// TRUE with no `visibility` written in the constructor — so a banner showed
// itself here while the same markup stayed hidden in the browser. It belongs in
// this module because its NS edge IS a class swap plus a visibility mapping, and
// {@link replaceClasses} already lives here; libadwaita groups it the same way,
// shipping `banner` in `_toolbars.scss` next to `toolbarview`.
//
// Free of `@nativescript/core` imports — like `icon-path.ts`, `row-press.ts`,
// `avatar-color.ts` and `split-view-width.ts` — so the spec suite exercises the
// shipping code rather than a transcription of it. The widget classes cannot
// serve that role: they `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable off-device.
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c
// Reference: refs/libadwaita/src/adw-toolbar-view.c
// Reference: refs/libadwaita/src/adw-spinner.c
// Reference: refs/libadwaita/src/adw-banner.c + adw-banner.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ADW_BANNER_BUTTON_STYLE_CLASSES,
    ADW_BANNER_DEFAULTS,
    ADW_CLAMP_DEFAULTS,
    ADW_CLAMP_SIZE_CLASSES,
    ADW_SPINNER_MIN_SIZE,
    ADW_TOOLBAR_BAR_CLASSES,
    ADW_TOOLBAR_VIEW_CLASSES,
    ADW_TOOLBAR_VIEW_DEFAULTS,
    type AdwBannerButtonStyle,
    type AdwBannerProps,
    type AdwClampSizeClass,
    type AdwToolbarStyle,
    bannerButtonStyleClasses,
    clampAllocate,
    normalizeClampSize,
    resolveSpinnerSize,
    spinnerGeometry,
    stripMarkup,
    toolbarViewClasses,
} from '@gjsify/adwaita-core';

export {
    ADW_BANNER_BUTTON_STYLE_CLASSES,
    ADW_BANNER_DEFAULTS,
    ADW_CLAMP_SIZE_CLASSES,
    ADW_SPINNER_MIN_SIZE,
    ADW_TOOLBAR_BAR_CLASSES,
    ADW_TOOLBAR_VIEW_CLASSES,
    ADW_TOOLBAR_VIEW_DEFAULTS,
};
export type { AdwBannerButtonStyle, AdwClampSizeClass, AdwToolbarStyle };

// --- AdwClamp ----------------------------------------------------------------

/** `Adw.Clamp:maximum-size` default, in DIPs. */
export const DEFAULT_CLAMP_MAX_SIZE = ADW_CLAMP_DEFAULTS.maximumSize;

/** `Adw.Clamp:tightening-threshold` default, in DIPs. */
export const DEFAULT_CLAMP_TIGHTENING_THRESHOLD = ADW_CLAMP_DEFAULTS.tighteningThreshold;

/** The two clamp properties, as the widget holds them. */
export interface ClampProps {
    /** How wide the child may ever get. Defaults to libadwaita's 600. */
    maximumSize: number;
    /** Where the eased tightening starts. Defaults to libadwaita's 400. */
    tighteningThreshold: number;
}

/** The property defaults a fresh clamp starts with. */
export function defaultClampProps(): ClampProps {
    return {
        maximumSize: DEFAULT_CLAMP_MAX_SIZE,
        tighteningThreshold: DEFAULT_CLAMP_TIGHTENING_THRESHOLD,
    };
}

/**
 * Normalise one clamp property, keeping a nonsense value out of the layout.
 *
 * Delegates to core so the NativeScript widget and the browser element agree on
 * the three inputs they used to answer differently — `0` (valid, and NOT the
 * default), a non-numeric value (never reaches the layout, so the DEFAULT
 * applies), and a negative (clamped to the range floor).
 */
export function normalizeClampProp(value: number | string | null | undefined, fallback: number): number {
    return normalizeClampSize(value, fallback);
}

/** What one clamp layout pass tells the widget to do with its child. */
export interface ClampAllocationForWidth {
    /**
     * The child's `width` — a DIP number, or `'auto'` while the clamp has not
     * been laid out yet, which leaves the child at its natural size instead of
     * pinning it to a width derived from a container of size zero.
     */
    width: number | 'auto';
    /** The `small`/`medium`/`large` class the child carries, or `null` before the first layout. */
    sizeClass: AdwClampSizeClass | null;
}

/**
 * The child width and size class for a clamp `availableWidth` DIPs wide.
 *
 * `availableWidth <= 0` means NativeScript has not laid the view out yet — it
 * reports a zero size before the first pass — and the honest answer there is
 * "do not constrain", the same shape `sidebarWidthFor` uses for the same reason.
 * Anything else runs libadwaita's curve, so a narrow container yields a narrow
 * child rather than the maximum.
 *
 * `childMin`/`childNat` are 0: NativeScript does not expose a child's measured
 * minimum before layout, and `lower = MAX (…, child_min)` only ever RAISES the
 * child's width — an NS child whose own content is wider than the clamp already
 * overflows rather than being cut, so nothing is lost by leaving it out.
 */
export function clampAllocationFor(availableWidth: number, props: ClampProps): ClampAllocationForWidth {
    if (!(availableWidth > 0)) return { width: 'auto', sizeClass: null };

    const { childSize, sizeClass } = clampAllocate(availableWidth, {
        maximumSize: props.maximumSize,
        tighteningThreshold: props.tighteningThreshold,
        childMin: 0,
        childNat: 0,
    });
    return { width: childSize, sizeClass };
}

// --- AdwSpinner --------------------------------------------------------------

/**
 * Default spinner diameter in DIPs — `Adw.Spinner`'s measured natural size,
 * which equals its minimum (adw-spinner.c:78-81).
 *
 * Replaces an invented 32: nothing in libadwaita produces that number.
 */
export const DEFAULT_SPINNER_SIZE = ADW_SPINNER_MIN_SIZE;

/**
 * The diameter an `ActivityIndicator` is sized to for a requested `size`.
 *
 * The platform indicator fills its view, so the view IS the ring: floored at the
 * measured minimum 16 and capped at Adwaita's 64, with the odd-size flooring
 * (`31` draws a 30 DIP ring) coming from the paintable rather than from here.
 */
export function spinnerDiameter(value: number | string | null | undefined): number {
    const size = resolveSpinnerSize(value);
    return spinnerGeometry(size, size).diameter;
}

// --- AdwToolbarView ----------------------------------------------------------

/** The four toolbar-view properties the style classes are derived from. */
export interface ToolbarViewProps {
    /** `top-bar-style`. */
    topBarStyle: AdwToolbarStyle;
    /** `bottom-bar-style`. */
    bottomBarStyle: AdwToolbarStyle;
    /** `extend-content-to-top-edge`. */
    extendContentToTopEdge: boolean;
    /** `extend-content-to-bottom-edge`. */
    extendContentToBottomEdge: boolean;
}

/** The property defaults a fresh toolbar view starts with. */
export function defaultToolbarViewProps(): ToolbarViewProps {
    return {
        topBarStyle: ADW_TOOLBAR_VIEW_DEFAULTS.topBarStyle,
        bottomBarStyle: ADW_TOOLBAR_VIEW_DEFAULTS.bottomBarStyle,
        extendContentToTopEdge: ADW_TOOLBAR_VIEW_DEFAULTS.extendContentToTopEdge,
        extendContentToBottomEdge: ADW_TOOLBAR_VIEW_DEFAULTS.extendContentToBottomEdge,
    };
}

/** The three `className` strings a toolbar view distributes over its own node and its two bar boxes. */
export interface ToolbarViewClassNames {
    /** `className` for the view. */
    view: string;
    /** `className` for the top-bar box. */
    topBar: string;
    /** `className` for the bottom-bar box. */
    bottomBar: string;
}

/**
 * Swap the classes a widget MANAGES on a NativeScript `className`, leaving every
 * other token in place.
 *
 * NS views carry a space-separated string rather than a `classList`, so there is
 * no `toggle`: the whole string is rewritten on every derivation. Composing from
 * a fixed base instead would silently drop what a CONSUMER added — the storybook
 * appends `sb-sidebar-pane` to an `AdwToolbarView`, and a re-style would have
 * taken it away again.
 */
export function replaceClasses(current: string, managed: readonly string[], next: readonly string[]): string {
    const tokens = current.split(/\s+/).filter((token) => token.length > 0 && !managed.includes(token));
    for (const cls of next) {
        if (!tokens.includes(cls)) tokens.push(cls);
    }
    return tokens.join(' ');
}

/** The child `className` for a clamp allocation — the size class, and nothing else touched. */
export function clampChildClassName(current: string, sizeClass: AdwClampSizeClass | null): string {
    return replaceClasses(current, ADW_CLAMP_SIZE_CLASSES, sizeClass ? [sizeClass] : []);
}

// --- AdwBanner ----------------------------------------------------------------

/** The five banner properties, as the widget holds them. */
export type BannerProps = AdwBannerProps;

/**
 * The property defaults a fresh banner starts with — libadwaita's, not this
 * port's.
 *
 * This is the whole reason the banner is here. `AdwBanner` used to initialise
 * `_revealed = true` AND never write `visibility` in its constructor, so a
 * banner put itself on screen on a device while the same markup stayed hidden in
 * the browser. `Adw.Banner:revealed` defaults to FALSE (adw-banner.c:456-459) —
 * "Banners are hidden by default" (:47) — and `use-markup` to TRUE (:422-425),
 * which the port had backwards as well.
 */
export function defaultBannerProps(): BannerProps {
    return { ...ADW_BANNER_DEFAULTS };
}

/**
 * The text the NS title `Label` is given.
 *
 * `Adw.Banner`'s title is Pango markup by default (:422-425) and the NS CSS
 * subset has no inline-markup layer at all, so the honest reduction is the
 * markup's PLAIN TEXT: `<b>Metered</b>` reads `Metered`, which is what GTK
 * paints minus the weight, where writing the raw string would paint the tags.
 * Unparseable markup keeps the raw string, reproducing the C fallback that
 * {@link stripMarkup} already models.
 */
export function bannerTitleText(title: string, useMarkup: boolean): string {
    if (!useMarkup) return title;
    return stripMarkup(title) ?? title;
}

/**
 * The NS `visibility` for a `revealed` value.
 *
 * `Adw.Banner` reveals through a `GtkRevealer` (:817); the NS subset has no
 * revealer, so `collapse` — which takes the view out of layout entirely — is the
 * closest thing to a fully retracted one.
 */
export function bannerVisibility(revealed: boolean): 'visible' | 'collapse' {
    return revealed ? 'visible' : 'collapse';
}

/**
 * The `className` for the banner button — the managed `button-style` class
 * swapped in, every other token left alone.
 *
 * `adw_banner_set_button_style` only ever adds or removes `suggested-action`
 * (:766, :769); it never rewrites the button's class list, and neither does
 * this.
 */
export function bannerButtonClassName(current: string, style: AdwBannerButtonStyle): string {
    return replaceClasses(current, ADW_BANNER_BUTTON_STYLE_CLASSES, bannerButtonStyleClasses(style));
}

/**
 * The `className` strings for a toolbar view, given its CURRENT ones, its
 * properties and the measured bar heights.
 *
 * `topBarHeight`/`bottomBarHeight` are the ALLOCATED heights, exactly as
 * `update_undershoots` reads `gtk_widget_get_height (self->top_bar)` — a bar box
 * that was never given a height fades nothing, so it gets no undershoot.
 */
export function toolbarViewClassNames(
    current: { view: string; topBar: string; bottomBar: string },
    props: ToolbarViewProps,
    heights: { topBarHeight: number; bottomBarHeight: number },
): ToolbarViewClassNames {
    const derived = toolbarViewClasses({ ...props, ...heights });
    return {
        view: replaceClasses(current.view, ADW_TOOLBAR_VIEW_CLASSES, derived.view),
        topBar: replaceClasses(current.topBar, ADW_TOOLBAR_BAR_CLASSES, derived.topBar),
        bottomBar: replaceClasses(current.bottomBar, ADW_TOOLBAR_BAR_CLASSES, derived.bottomBar),
    };
}
