// Adwaita window chrome — headless (ADR 0004).
//
// The chrome widgets look like "props onto a container", and that is exactly how
// both renderers had implemented them. They are not: three of them carry real
// arithmetic in the C source that neither port had, and the ports had already
// drifted apart on five defaults.
//
//   - `AdwClampLayout` is an EASING CURVE, not a `max-width`: three thresholds
//     (`lower`/`max`/`upper`), an ease-out-cubic tightening region between the
//     first two, ceil-vs-floor rounding that differs per direction, and a
//     `small`/`medium`/`large` class stamped on the child. The browser port
//     approximated it with `max-width` and the NativeScript port with an EXACT
//     `view.width = maximumSize`, so a 360-DIP phone was handed a 600-DIP child.
//   - `AdwToolbarView` allocates through TWO CHAINED GLib CLAMPs over
//     top/bottom min+nat and the content minimum, and derives four style classes
//     (`raised`, `border`, `undershoot-top`, `undershoot-bottom`) from the bar
//     styles, the extend flags and the ALLOCATED bar heights. Both ports had a
//     three-slot stack and none of the classes.
//   - `Adw.Spinner` has one sizing contract — `radius = min(floor(min(w,h)/2),
//     32)`, `lineWidth = diameter / 8`, measured minimum AND natural 16 — from
//     which the documented "never smaller than 16×16, never larger than 64×64"
//     falls out. The two ports had picked 24 and 32 out of the air and the web
//     one drew a 2px ring where Adwaita draws 3px.
//
// The two numeric input guards the ports wrote per widget (`parseFloat(attr ||
// 'DEFAULT')` on the web, `Number.isFinite(v) && v > 0 ? v : DEFAULT` on NS) are
// here as {@link normalizeClampSize} and {@link resolveSpinnerSize}, because the
// two forms disagreed on `0`, on `NaN` and on negatives — which is three of the
// bugs this module removes, not a style difference.
//
// `adwLerp`, `easeOutCubic` and `inverseLerp` used to be module-private here,
// with a note saying they belonged to whichever module lifted the animation
// family. `spinner.ts` lifted it, so they live in `easing.ts` now and this
// module imports them.
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c
// Reference: refs/libadwaita/src/adw-toolbar-view.c
// Reference: refs/libadwaita/src/adw-spinner.c
// Reference: refs/libadwaita/src/adw-spinner-paintable.c
// Reference: refs/libadwaita/src/adw-animation-util.c (adw_lerp)
// Reference: refs/libadwaita/src/adw-easing.c (ease_out_cubic)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

// `inverseLerp` here is adw-clamp-layout.c:147-153 — given `a`, `b` and a
// result, recover `t`. NOT the `inverse_lerp` in adw-view-stack.c, which solves
// for `b`.
import { adwLerp, easeOutCubic, inverseLerp } from './easing.js';
import { glibClamp } from './glib.js';

// --- Adw.Clamp / AdwClampLayout ----------------------------------------------

/**
 * `ADW_EASE_OUT_TAN_CUBIC` (adw-clamp-layout.c:184) — the tangent of
 * `ease_out_cubic` at 0, which is what makes `upper` the point where the eased
 * curve would have reached `max` at a constant rate.
 */
const ADW_EASE_OUT_TAN_CUBIC = 3;

/**
 * The inputs every clamp computation needs: the two properties plus the child's
 * measured minimum and natural size in the clamp's own orientation.
 *
 * Sizes are already-resolved PIXELS. `AdwClampLayout:unit` (default `sp`) scales
 * them against the GTK text-scale factor, which is a platform capability rather
 * than headless logic — a renderer that has one runs `adwLengthToPx` (exported
 * from `./split-view.js`) before calling in.
 */
export interface ClampParams {
    /** `maximum-size` — how wide the child may get. Default 600. */
    maximumSize: number;
    /** `tightening-threshold` — where the eased tightening starts. Default 400. */
    tighteningThreshold: number;
    /** The child's measured minimum in the clamped orientation. */
    childMin: number;
    /** The child's measured natural size in the clamped orientation. */
    childNat: number;
}

/** The libadwaita property defaults (adw-clamp-layout.c:414, :438, :462-464). */
export const ADW_CLAMP_DEFAULTS: { readonly maximumSize: number; readonly tighteningThreshold: number } = {
    maximumSize: 600,
    tighteningThreshold: 400,
};

/** The three breakpoints every other clamp computation is written in terms of. */
export interface ClampThresholds {
    /** Below this the child gets ALL the available size — `MAX(MIN(threshold, maximum), childMin)`. */
    lower: number;
    /** The largest size the child will ever be allocated — `MAX(lower, maximum)`. */
    max: number;
    /** The available size at which the child finally reaches {@link max}. */
    upper: number;
}

/**
 * `lower`/`max`/`upper` (adw-clamp-layout.c:173-176, :210-213).
 *
 * Exported because both the measure and the allocate path need them, and
 * because the two cases the renderers got wrong live entirely in these three
 * lines: a threshold ABOVE the maximum collapses the tightening region
 * (`lower === max === upper`), and a child whose own minimum exceeds the maximum
 * raises all three to that minimum — which is how `maximum-size="0"` means "give
 * the child its minimum", not "give it nothing".
 */
export function clampThresholds(params: ClampParams): ClampThresholds {
    const lower = Math.max(Math.min(params.tighteningThreshold, params.maximumSize), params.childMin);
    const max = Math.max(lower, params.maximumSize);
    return { lower, max, upper: lower + ADW_EASE_OUT_TAN_CUBIC * (max - lower) };
}

/** {@link clampChildSize} once the thresholds are already in hand. */
function childSizeFrom(forSize: number, thresholds: ClampThresholds, childNat: number): number {
    const { lower, max, upper } = thresholds;

    // `for_size < 0` is GTK's "measure me unconstrained".
    if (forSize < 0) return Math.min(childNat, Math.ceil(max));
    if (forSize <= lower) return forSize;
    if (forSize >= upper) return Math.ceil(max);

    return Math.floor(adwLerp(lower, max, easeOutCubic(inverseLerp(lower, upper, forSize))));
}

/**
 * `child_size_from_clamp` (adw-clamp-layout.c:193-232) — how much of `forSize`
 * the child is allocated.
 *
 * The result is never larger than `forSize`, which is the whole point and what
 * `view.width = maximumSize` in the NativeScript port broke: below `lower` the
 * child gets EXACTLY the available size, so a narrow phone gets a narrow child.
 * The cap only bites from `upper` upward; between the two the size is eased so
 * the transition into the cap is smooth rather than a corner.
 */
export function clampChildSize(forSize: number, params: ClampParams): number {
    return childSizeFrom(forSize, clampThresholds(params), params.childNat);
}

/**
 * `clamp_size_from_child` (adw-clamp-layout.c:156-191) — the INVERSE, used while
 * measuring: how much space the clamp itself must report for the child to end up
 * at `childSize`.
 *
 * The inverse of `ease_out_cubic` is `1 + cbrt(t - 1)`, and the rounding goes the
 * OTHER way from {@link clampChildSize} (`ceil`, not `floor`) so the reported
 * request never lands a pixel short of what the child asked for.
 */
export function clampSizeFromChild(childSize: number, params: ClampParams): number {
    const { lower, max, upper } = clampThresholds(params);

    if (childSize <= lower) return childSize;
    // C returns the `double` upper through an `int` return type.
    if (childSize >= max) return Math.trunc(upper);

    const progress = 1 + Math.cbrt(inverseLerp(lower, max, childSize) - 1);
    return Math.ceil(adwLerp(lower, upper, progress));
}

/** Which of the three size classes `adw_clamp_layout_allocate` stamps on the child. */
export type AdwClampSizeClass = 'small' | 'medium' | 'large';

/**
 * All three size classes, so a renderer can CLEAR the ones that no longer apply.
 *
 * `adw_clamp_layout_allocate` removes the other two on every pass and removes
 * all three from a child it stops laying out (adw-clamp-layout.c:333-336), so
 * "which classes does the clamp own" is part of the contract, not a detail each
 * renderer gets to restate.
 */
export const ADW_CLAMP_SIZE_CLASSES: ReadonlyArray<AdwClampSizeClass> = ['small', 'medium', 'large'];

/** Everything one clamp allocation decides. */
export interface ClampAllocation {
    /** The size the child is allocated along the clamped axis. */
    childSize: number;
    /** `ceil(max)` — the cap the `large` class is keyed off. */
    childMaximum: number;
    /** `ceil(lower)` — the threshold the `small` class is keyed off. */
    lowerThreshold: number;
    /** The style class the CHILD must carry. */
    sizeClass: AdwClampSizeClass;
    /** Leading offset that centres the child along the clamped axis. */
    offset: number;
}

/**
 * `adw_clamp_layout_allocate` (adw-clamp-layout.c:317-386) — child size, the
 * style class the child carries, and the centring offset, in one call.
 *
 * The class boundaries are INCLUSIVE at both ends and are compared against the
 * CEILED thresholds, not the raw doubles; the offset is C integer division, so
 * it truncates rather than rounds.
 */
export function clampAllocate(availableSize: number, params: ClampParams): ClampAllocation {
    const thresholds = clampThresholds(params);
    const childMaximum = Math.ceil(thresholds.max);
    const lowerThreshold = Math.ceil(thresholds.lower);
    const childSize = childSizeFrom(availableSize, thresholds, params.childNat);

    const sizeClass: AdwClampSizeClass =
        childSize >= childMaximum ? 'large' : childSize <= lowerThreshold ? 'small' : 'medium';

    return {
        childSize,
        childMaximum,
        lowerThreshold,
        sizeClass,
        offset: Math.trunc((availableSize - childSize) / 2),
    };
}

/**
 * Normalise a `maximum-size` / `tightening-threshold` coming from an attribute
 * or a property assignment into the `g_param_spec_int (…, 0, G_MAXINT, …)` range
 * both properties declare (adw-clamp-layout.c:413-416, :448-451).
 *
 * Three inputs used to produce three different results across the three
 * implementations, and this is the one answer for all of them:
 *   - `0` is IN RANGE and means "clamp the child to its own minimum". The web
 *     port's `attr || '600'` never fired for the string `"0"` and produced
 *     `max-width: 0`; the NS port's `value > 0` guard silently substituted 600.
 *   - a value GObject would refuse (`NaN`, a non-numeric attribute) never
 *     reaches the layout, so the property keeps its DEFAULT. The web port
 *     assigned `NaNpx`, which the CSSOM drops — leaving whatever cap was set
 *     before silently in force.
 *   - a negative is out of range and clamps to the range floor, 0.
 */
export function normalizeClampSize(value: number | string | null | undefined, fallback: number): number {
    const parsed = typeof value === 'string' ? Number.parseFloat(value) : (value ?? Number.NaN);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.trunc(parsed));
}

// --- Adw.ToolbarView ---------------------------------------------------------

/** `AdwToolbarStyle` (adw-toolbar-view.c:120-125). */
export type AdwToolbarStyle = 'flat' | 'raised' | 'raised-border';

/** The toolbar-view property defaults (adw-toolbar-view.c:572, :608, :731-732). */
export const ADW_TOOLBAR_VIEW_DEFAULTS: {
    readonly topBarStyle: AdwToolbarStyle;
    readonly bottomBarStyle: AdwToolbarStyle;
    readonly extendContentToTopEdge: boolean;
    readonly extendContentToBottomEdge: boolean;
} = {
    topBarStyle: 'flat',
    bottomBarStyle: 'flat',
    extendContentToTopEdge: false,
    extendContentToBottomEdge: false,
};

/**
 * Read an `AdwToolbarStyle` off an attribute or a property assignment.
 *
 * Anything outside the enum is the default: C rejects it outright
 * (`g_return_if_fail (style <= ADW_TOOLBAR_RAISED_BORDER)`,
 * adw-toolbar-view.c:1004) and leaves the property at whatever it was.
 */
export function parseToolbarStyle(value: string | null | undefined): AdwToolbarStyle {
    return value === 'raised' || value === 'raised-border' ? value : ADW_TOOLBAR_VIEW_DEFAULTS.topBarStyle;
}

/**
 * The style classes a bar box carries for `style`
 * (adw-toolbar-view.c:1011-1024, :1097-1110).
 *
 * `raised-border` is `raised` PLUS `border` — the border replaces the shadow in
 * the stylesheet, it does not replace the raised background.
 */
export function toolbarBarStyleClasses(style: AdwToolbarStyle): string[] {
    switch (style) {
        case 'raised':
            return ['raised'];
        case 'raised-border':
            return ['raised', 'border'];
        default:
            return [];
    }
}

/** Everything `update_undershoots` + the two style setters need to decide the classes. */
export interface ToolbarViewClassInput {
    /** `top-bar-style`. */
    topBarStyle: AdwToolbarStyle;
    /** `bottom-bar-style`. */
    bottomBarStyle: AdwToolbarStyle;
    /** `extend-content-to-top-edge`. */
    extendContentToTopEdge: boolean;
    /** `extend-content-to-bottom-edge`. */
    extendContentToBottomEdge: boolean;
    /** The ALLOCATED top-bar height, i.e. `Adw.ToolbarView:top-bar-height`. */
    topBarHeight: number;
    /** The ALLOCATED bottom-bar height, i.e. `Adw.ToolbarView:bottom-bar-height`. */
    bottomBarHeight: number;
}

/** The classes a toolbar view owns on ITSELF, so a renderer can clear them. */
export const ADW_TOOLBAR_VIEW_CLASSES: ReadonlyArray<string> = ['undershoot-top', 'undershoot-bottom'];

/** The classes a toolbar view owns on each BAR BOX, so a renderer can clear them. */
export const ADW_TOOLBAR_BAR_CLASSES: ReadonlyArray<string> = ['raised', 'border'];

/** The three class lists a toolbar view distributes over its own node and its two bar boxes. */
export interface ToolbarViewClasses {
    /** Classes on the VIEW — `undershoot-top` / `undershoot-bottom`. */
    view: string[];
    /** Classes on the top-bar box. */
    topBar: string[];
    /** Classes on the bottom-bar box. */
    bottomBar: string[];
}

/**
 * `update_undershoots` (adw-toolbar-view.c:215-232) plus the two per-bar style
 * class setters, as one derivation.
 *
 * An undershoot is the scroll-fade under a FLAT bar, so all three conditions
 * must hold: the bar is flat (a raised bar has its own shadow), the content does
 * NOT extend under it (there is nothing to fade), and the bar was actually
 * allocated a height (an absent bar fades nothing). The height being the
 * ALLOCATED one — not "is there a bar widget" — is why this reads a number.
 */
export function toolbarViewClasses(input: ToolbarViewClassInput): ToolbarViewClasses {
    const view: string[] = [];
    if (input.topBarStyle === 'flat' && !input.extendContentToTopEdge && input.topBarHeight > 0) {
        view.push('undershoot-top');
    }
    if (input.bottomBarStyle === 'flat' && !input.extendContentToBottomEdge && input.bottomBarHeight > 0) {
        view.push('undershoot-bottom');
    }
    return {
        view,
        topBar: toolbarBarStyleClasses(input.topBarStyle),
        bottomBar: toolbarBarStyleClasses(input.bottomBarStyle),
    };
}

/** The measured sizes one toolbar-view allocation consumes. */
export interface ToolbarViewAllocateInput {
    /** The height the view itself was allocated. */
    height: number;
    /** Top bar minimum height. */
    topMin: number;
    /** Top bar natural height. */
    topNat: number;
    /** Bottom bar minimum height. */
    bottomMin: number;
    /** Bottom bar natural height. */
    bottomNat: number;
    /** Content minimum height. `0` when there is no content. */
    contentMin: number;
    /** `extend-content-to-top-edge`. */
    extendContentToTopEdge: boolean;
    /** `extend-content-to-bottom-edge`. */
    extendContentToBottomEdge: boolean;
}

/** What one toolbar-view allocation produces. */
export interface ToolbarViewAllocation {
    /** `Adw.ToolbarView:top-bar-height`. */
    topBarHeight: number;
    /** `Adw.ToolbarView:bottom-bar-height`. */
    bottomBarHeight: number;
    /** The height the content is allocated. */
    contentHeight: number;
    /** The content's vertical offset from the view's top edge. */
    contentOffset: number;
}

/**
 * `adw_toolbar_view_size_allocate` (adw-toolbar-view.c:357-406) — the two chained
 * GLib CLAMPs that turn measured sizes into the three slot heights.
 *
 * Read it as: reserve the content's minimum and the bottom bar's minimum, hand
 * what is left to the top bar (clamped into its own min…nat), then repeat for the
 * bottom bar with the top bar's ACTUAL height. Two consequences a naive
 * "stack them" layout does not reproduce:
 *   - a STRETCHY bar (`nat > min`) grows into spare height and shrinks back
 *     toward its minimum as the content's minimum claims the space;
 *   - once the view is squeezed below everything's minimum, GLib's `CLAMP` — which
 *     tests the HIGH bound first — leaves the BARS at their minimum and lets the
 *     CONTENT go short. `Math.min(high, Math.max(low, x))` gives the same answer
 *     here only because both bounds arrive in order; the primitive is
 *     {@link glibClamp} regardless, since the inputs are caller-supplied.
 */
export function toolbarViewAllocate(input: ToolbarViewAllocateInput): ToolbarViewAllocation {
    let contentMin = input.contentMin;
    if (input.extendContentToTopEdge) contentMin -= input.topMin;
    if (input.extendContentToBottomEdge) contentMin -= input.bottomMin;
    contentMin = Math.max(contentMin, 0);

    const topBarHeight = glibClamp(input.height - contentMin - input.bottomMin, input.topMin, input.topNat);
    const bottomBarHeight = glibClamp(input.height - contentMin - topBarHeight, input.bottomMin, input.bottomNat);

    let contentHeight = input.height;
    let contentOffset = 0;
    if (!input.extendContentToTopEdge) {
        contentHeight -= topBarHeight;
        contentOffset = topBarHeight;
    }
    if (!input.extendContentToBottomEdge) contentHeight -= bottomBarHeight;

    return { topBarHeight, bottomBarHeight, contentHeight, contentOffset };
}

/** The measured sizes one toolbar-view measure consumes. */
export interface ToolbarViewMeasureInput {
    /** Which axis is being measured. */
    orientation: 'horizontal' | 'vertical';
    /** Top bar minimum along {@link orientation}. */
    topMin: number;
    /** Top bar natural along {@link orientation}. */
    topNat: number;
    /** Bottom bar minimum along {@link orientation}. */
    bottomMin: number;
    /** Bottom bar natural along {@link orientation}. */
    bottomNat: number;
    /** Content minimum along {@link orientation}. `0` when there is no content. */
    contentMin: number;
    /** Content natural along {@link orientation}. `0` when there is no content. */
    contentNat: number;
    /** `extend-content-to-top-edge`. */
    extendContentToTopEdge: boolean;
    /** `extend-content-to-bottom-edge`. */
    extendContentToBottomEdge: boolean;
}

/** A GTK measure result. */
export interface AdwMeasurement {
    /** Minimum size along the measured axis. */
    minimum: number;
    /** Natural size along the measured axis. */
    natural: number;
}

/**
 * `adw_toolbar_view_measure` (adw-toolbar-view.c:266-354) — the four-way vertical
 * combination keyed on the two extend flags, plus the horizontal MAX form.
 *
 * The four branches are not four spellings of the same sum: a bar the content
 * extends UNDER contributes via `MAX`, a bar it does not contributes via `+`.
 * With both flags set the two bars are summed first and MAXed as a pair, because
 * they still cannot overlap each other.
 */
export function toolbarViewMeasure(input: ToolbarViewMeasureInput): AdwMeasurement {
    if (input.orientation === 'horizontal') {
        return {
            minimum: Math.max(input.contentMin, Math.max(input.topMin, input.bottomMin)),
            natural: Math.max(input.contentNat, Math.max(input.topNat, input.bottomNat)),
        };
    }

    if (input.extendContentToTopEdge && input.extendContentToBottomEdge) {
        return {
            minimum: Math.max(input.contentMin, input.topMin + input.bottomMin),
            natural: Math.max(input.contentNat, input.topNat + input.bottomNat),
        };
    }
    if (input.extendContentToTopEdge) {
        return {
            minimum: Math.max(input.contentMin, input.topMin) + input.bottomMin,
            natural: Math.max(input.contentNat, input.topNat) + input.bottomNat,
        };
    }
    if (input.extendContentToBottomEdge) {
        return {
            minimum: Math.max(input.contentMin, input.bottomMin) + input.topMin,
            natural: Math.max(input.contentNat, input.bottomNat) + input.topNat,
        };
    }
    return {
        minimum: input.contentMin + input.topMin + input.bottomMin,
        natural: input.contentNat + input.topNat + input.bottomNat,
    };
}

/** The bar heights subtracted before the content is measured horizontally. */
export interface ToolbarViewContentForSizeInput {
    /** `extend-content-to-top-edge`. */
    extendContentToTopEdge: boolean;
    /** `extend-content-to-bottom-edge`. */
    extendContentToBottomEdge: boolean;
    /** Top bar minimum HEIGHT (always the vertical measurement, whatever axis is being measured). */
    topMinHeight: number;
    /** Top bar natural HEIGHT. */
    topNatHeight: number;
    /** Bottom bar minimum HEIGHT. */
    bottomMinHeight: number;
    /** Bottom bar natural HEIGHT. */
    bottomNatHeight: number;
}

/** The two heights the content has to be measured against. */
export interface ToolbarViewContentForSize {
    /** `for_size` for the content's MINIMUM — bars at their minimum heights. */
    forSizeMin: number;
    /** `for_size` for the content's NATURAL — bars at their natural heights. */
    forSizeNat: number;
}

/**
 * `adw_toolbar_view_measure`'s height-for-width branch (adw-toolbar-view.c:292-316).
 *
 * Two different `for_size` values, not one: a STRETCHY bar leaves the content a
 * different width at the bar's minimum than at its natural size, so the content's
 * minimum and natural have to be measured against different heights. They
 * coincide exactly when every bar is rigid, which is why one value looked
 * sufficient for as long as nobody had a stretchy bar.
 */
export function toolbarViewContentForSize(
    forSize: number,
    input: ToolbarViewContentForSizeInput,
): ToolbarViewContentForSize {
    let forSizeMin = forSize;
    let forSizeNat = forSize;
    if (!input.extendContentToTopEdge) {
        forSizeMin -= input.topMinHeight;
        forSizeNat -= input.topNatHeight;
    }
    if (!input.extendContentToBottomEdge) {
        forSizeMin -= input.bottomMinHeight;
        forSizeNat -= input.bottomNatHeight;
    }
    return { forSizeMin, forSizeNat };
}

// --- Adw.Spinner / AdwSpinnerPaintable ---------------------------------------

/**
 * `MIN_SIZE` (adw-spinner.c:14) — reported as BOTH the minimum and the natural
 * size (adw_spinner_measure, :70-84), so a spinner never grows on its own; it
 * only fills an allocation something else made larger.
 */
export const ADW_SPINNER_MIN_SIZE = 16;

/**
 * The largest ring Adwaita ever draws: `2 * MAX_RADIUS`
 * (adw-spinner-paintable.c:19). Together with {@link ADW_SPINNER_MIN_SIZE} this
 * is the documented "never smaller than 16×16 and never larger than 64×64"
 * (adw-spinner.c:27-28).
 */
export const ADW_SPINNER_MAX_SIZE = 64;

/** The circle `AdwSpinnerPaintable` strokes into a `width × height` box. */
export interface SpinnerGeometry {
    /** Ring radius, capped at `ADW_SPINNER_MAX_SIZE / 2`. */
    radius: number;
    /** Drawn diameter, `2 * radius`. */
    diameter: number;
    /** Stroke width — `diameter / 8`, the documented "2px for 16px". */
    lineWidth: number;
    /** Ring centre X within the box. */
    centerX: number;
    /** Ring centre Y within the box. */
    centerY: number;
}

/**
 * `adw_spinner_paintable_snapshot_with_weight` (adw-spinner-paintable.c:342-352)
 * plus `calculate_line_width` (:314-321) at the default weight 400, where
 * `width_apply_weight` is the identity branch (:303-306).
 *
 * Three details the renderers had each guessed at:
 *   - the SHORTER side decides the radius, and it is FLOORED, so a 31px box
 *     draws a 30px ring rather than a 31px one;
 *   - the radius is capped at 32 while the CENTRE still follows the box, so a
 *     200px allocation shows a 64px ring in the middle, not a 200px one;
 *   - the stroke is `diameter / 8` exactly — 3px at 24, 6px at 48, 8px at 64.
 *     The browser port's `max(2, round(size / 12))` drew 2px, 4px and 5px there.
 *
 * `MIN_RADIUS 8` (adw-spinner-paintable.c:18) is dead in the C source — nothing
 * references it — so it is deliberately NOT a floor here. The real floor is the
 * widget's measured {@link ADW_SPINNER_MIN_SIZE}.
 */
export function spinnerGeometry(width: number, height: number): SpinnerGeometry {
    const radius = Math.min(Math.floor(Math.min(width, height) / 2), ADW_SPINNER_MAX_SIZE / 2);
    const diameter = radius * 2;
    return {
        radius,
        diameter,
        lineWidth: diameter / 8,
        centerX: Math.round(width / 2),
        centerY: Math.round(height / 2),
    };
}

/**
 * The box a spinner is actually given for a requested `size`.
 *
 * `adw_spinner_measure` reports 16 as the minimum, and GTK never allocates a
 * widget below its minimum — so a smaller request is not representable, and a
 * request GObject would refuse (`NaN`, a non-numeric attribute, an unset one)
 * leaves the natural size in force. There is no upper bound HERE: an oversized
 * allocation stays oversized and {@link spinnerGeometry} caps the drawn ring,
 * which is how the box and the ring can differ (a 200px allocation, a 64px ring).
 *
 * Replaces the two invented defaults this package shipped — `24` in the browser
 * element and `32` in the NativeScript widget — neither of which is in the C
 * source.
 */
export function resolveSpinnerSize(value: number | string | null | undefined): number {
    const parsed = typeof value === 'string' ? Number.parseFloat(value) : (value ?? Number.NaN);
    if (!Number.isFinite(parsed)) return ADW_SPINNER_MIN_SIZE;
    return Math.max(parsed, ADW_SPINNER_MIN_SIZE);
}
