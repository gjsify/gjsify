// Adwaita window chrome — headless (ADR 0004).
//
// These three widgets look like "props onto a container" and are not — each carries
// real arithmetic from the C source:
//
// - `AdwClampLayout` is an EASING CURVE, not a `max-width`: three thresholds
// (`lower`/`max`/`upper`), an ease-out-cubic tightening region between the first
// two, ceil-vs-floor rounding that differs per direction, and a
// `small`/`medium`/`large` class stamped on the child.
// - `AdwToolbarView` allocates through TWO CHAINED GLib CLAMPs over top/bottom
// min+nat and the content minimum, and derives four style classes (`raised`,
// `border`, `undershoot-top`, `undershoot-bottom`) from the bar styles, the extend
// flags and the ALLOCATED bar heights.
// - `Adw.Spinner` has one sizing contract — `radius = min(floor(min(w,h)/2), 32)`,
// `lineWidth = diameter / 8`, measured minimum AND natural 16 — from which the
// documented "never smaller than 16×16, never larger than 64×64" falls out.
//
// {@link normalizeClampSize} and {@link resolveSpinnerSize} own the numeric input
// guards, because per-widget guards disagreed on `0`, on `NaN` and on negatives.
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c
// Reference: refs/libadwaita/src/adw-toolbar-view.c
// Reference: refs/libadwaita/src/adw-spinner.c
// Reference: refs/libadwaita/src/adw-spinner-paintable.c
// Reference: refs/libadwaita/src/adw-animation-util.c (adw_lerp)
// Reference: refs/libadwaita/src/adw-easing.c (ease_out_cubic)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

// `inverseLerp` here is adw-clamp-layout's: given `a`, `b` and a result, recover `t`.
// NOT the `inverse_lerp` in adw-view-stack.c, which solves for `b`.
import { adwLerp, easeOutCubic, inverseLerp } from './easing.js';
import { glibClamp } from './glib.js';

/**
 * `ADW_EASE_OUT_TAN_CUBIC` — the tangent of `ease_out_cubic` at 0, which makes `upper`
 * the point where the eased curve would have reached `max` at a constant rate.
 */
const ADW_EASE_OUT_TAN_CUBIC = 3;

/**
 * The inputs every clamp computation needs: the two properties plus the child's measured
 * minimum and natural size in the clamp's own orientation.
 *
 * Sizes are already-resolved PIXELS. `AdwClampLayout:unit` (default `sp`) scales them
 * against the GTK text-scale factor, a platform capability rather than headless logic — a
 * renderer that has one runs `adwLengthToPx` (from `./length-unit.js`) before calling in.
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

/** The libadwaita property defaults. */
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
 * `lower`/`max`/`upper`. Exported because both the measure and the allocate path need
 * them, and because the two easily-missed cases live in these three lines: a threshold
 * ABOVE the maximum collapses the tightening region (`lower === max === upper`), and a
 * child whose own minimum exceeds the maximum raises all three to that minimum — which
 * is how `maximum-size="0"` means "give the child its minimum", not "give it nothing".
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
 * `child_size_from_clamp` — how much of `forSize` the child is allocated. The result is
 * never larger than `forSize`: below `lower` the child gets EXACTLY the available size,
 * so a narrow phone gets a narrow child. The cap only bites from `upper` upward;
 * between the two the size is eased so the transition into it is smooth.
 */
export function clampChildSize(forSize: number, params: ClampParams): number {
    return childSizeFrom(forSize, clampThresholds(params), params.childNat);
}

/**
 * `clamp_size_from_child` — the INVERSE, used while measuring: how much space the clamp
 * must report for the child to end up at `childSize`. The inverse of `ease_out_cubic` is
 * `1 + cbrt(t - 1)`, and the rounding goes the OTHER way from {@link clampChildSize}
 * (`ceil`, not `floor`) so the reported request never lands a pixel short.
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
 * All three size classes, so a renderer can CLEAR the ones that no longer apply:
 * `adw_clamp_layout_allocate` removes the other two on every pass and all three from a
 * child it stops laying out, so "which classes does the clamp own" is part of the
 * contract.
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
 * `adw_clamp_layout_allocate` — child size, the style class the child carries and the
 * centring offset, in one call. The class boundaries are INCLUSIVE at both ends and are
 * compared against the CEILED thresholds, not the raw doubles; the offset is C integer
 * division, so it truncates rather than rounds.
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
 * Normalise a `maximum-size` / `tightening-threshold` from an attribute or a property
 * assignment into the `g_param_spec_int (…, 0, G_MAXINT, …)` range both properties
 * declare:
 * - `0` is IN RANGE and means "clamp the child to its own minimum" — not "no width",
 * and not a missing value to substitute the default for;
 * - a value GObject would refuse (`NaN`, a non-numeric attribute) never reaches the
 * layout, so the property keeps its DEFAULT;
 * - a negative is out of range and clamps to the range floor, 0.
 */
export function normalizeClampSize(value: number | string | null | undefined, fallback: number): number {
    const parsed = typeof value === 'string' ? Number.parseFloat(value) : (value ?? Number.NaN);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.trunc(parsed));
}

/** `AdwToolbarStyle`. */
export type AdwToolbarStyle = 'flat' | 'raised' | 'raised-border';

/** The toolbar-view property defaults. */
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
 * Read an `AdwToolbarStyle` off an attribute or a property assignment. Anything outside
 * the enum is the default: C rejects it outright
 * (`g_return_if_fail (style <= ADW_TOOLBAR_RAISED_BORDER)`) and leaves the property as it
 * was.
 */
export function parseToolbarStyle(value: string | null | undefined): AdwToolbarStyle {
    return value === 'raised' || value === 'raised-border' ? value : ADW_TOOLBAR_VIEW_DEFAULTS.topBarStyle;
}

/**
 * The style classes a bar box carries for `style`. `raised-border` is `raised` PLUS
 * `border` — the border replaces the shadow in the stylesheet, not the raised background.
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
 * `update_undershoots` plus the two per-bar style class setters, as one derivation.
 *
 * An undershoot is the scroll-fade under a FLAT bar, so all three conditions must hold:
 * the bar is flat (a raised bar has its own shadow), the content does NOT extend under it
 * (nothing to fade), and the bar was actually allocated a height (an absent bar fades
 * nothing). That the height is the ALLOCATED one, not "is there a bar widget", is why
 * this reads a number.
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
 * `adw_toolbar_view_size_allocate` — the two chained GLib CLAMPs that turn measured
 * sizes into the three slot heights: reserve the content's minimum and the bottom bar's
 * minimum, hand what is left to the top bar (clamped into its own min…nat), then repeat
 * for the bottom bar with the top bar's ACTUAL height. Two consequences a naive "stack
 * them" layout does not reproduce:
 * - a STRETCHY bar (`nat > min`) grows into spare height and shrinks back toward its
 * minimum as the content's minimum claims the space;
 * - once the view is squeezed below everything's minimum, GLib's `CLAMP` — which tests
 * the HIGH bound first — leaves the BARS at their minimum and lets the CONTENT go
 * short. {@link glibClamp} is used regardless, since the inputs are caller-supplied.
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
 * `adw_toolbar_view_measure` — the four-way vertical combination keyed on the two extend
 * flags, plus the horizontal MAX form. The branches are not four spellings of the same
 * sum: a bar the content extends UNDER contributes via `MAX`, a bar it does not
 * contributes via `+`. With both flags set the bars are summed first and MAXed as a
 * pair, because they still cannot overlap each other.
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
 * `adw_toolbar_view_measure`'s height-for-width branch. Two different `for_size` values,
 * not one: a STRETCHY bar leaves the content a different width at the bar's minimum than
 * at its natural size, so the content's minimum and natural must be measured against
 * different heights. They coincide exactly when every bar is rigid.
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

/**
 * `MIN_SIZE` — reported as BOTH the minimum and the natural size (`adw_spinner_measure`),
 * so a spinner never grows on its own; it only fills an allocation something else made
 * larger.
 */
export const ADW_SPINNER_MIN_SIZE = 16;

/**
 * The largest ring Adwaita ever draws: `2 * MAX_RADIUS`. With
 * {@link ADW_SPINNER_MIN_SIZE} this is the documented "never smaller than 16×16 and
 * never larger than 64×64".
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
 * `adw_spinner_paintable_snapshot_with_weight` plus `calculate_line_width` at the default
 * weight 400, where `width_apply_weight` is the identity branch. Three details:
 * - the SHORTER side decides the radius, and it is FLOORED, so a 31px box draws a 30px
 * ring rather than a 31px one;
 * - the radius is capped at 32 while the CENTRE still follows the box, so a 200px
 * allocation shows a 64px ring in the middle, not a 200px one;
 * - the stroke is `diameter / 8` exactly — 3px at 24, 6px at 48, 8px at 64.
 *
 * `MIN_RADIUS 8` is dead in the C source — nothing references it — so it is deliberately
 * NOT a floor here. The real floor is the widget's measured
 * {@link ADW_SPINNER_MIN_SIZE}.
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
 * The box a spinner is actually given for a requested `size`. `adw_spinner_measure`
 * reports 16 as the minimum and GTK never allocates below a minimum, so a smaller
 * request is not representable, and a request GObject would refuse (`NaN`, a non-numeric
 * or unset attribute) leaves the natural size in force. No upper bound HERE: an oversized
 * allocation stays oversized and {@link spinnerGeometry} caps the drawn ring, which is
 * how a 200px box can hold a 64px ring.
 */
export function resolveSpinnerSize(value: number | string | null | undefined): number {
    const parsed = typeof value === 'string' ? Number.parseFloat(value) : (value ?? Number.NaN);
    if (!Number.isFinite(parsed)) return ADW_SPINNER_MIN_SIZE;
    return Math.max(parsed, ADW_SPINNER_MIN_SIZE);
}
