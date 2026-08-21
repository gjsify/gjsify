// Spinner ANIMATION vectors — `AdwSpinnerPaintable`'s breathing arc. The geometry
// (`spinnerGeometry`, `resolveSpinnerSize`) lives in `conformance/chrome.ts`.
//
// Issue #1066: every renderer animated differently — the divergences are the `rule`
// column of `SPINNER_CONSTANT_VECTORS`. Two facts no row covers: the arc ends are
// `GSK_LINE_CAP_ROUND`, not square-cut, and the C opts OUT of the animation setting
// (`adw_animation_set_follow_enable_animations_setting (…, FALSE)`), so the spinner
// keeps turning under `prefers-reduced-motion` — a frozen busy indicator reads as a
// hang.
//
// SETTLED CONTRADICTION these rows sit on: a 200px request yields a 200px BOX, not a
// 200px ring, because `spinnerGeometry` caps the RING. Both renderer suites asserted
// the opposite, their element and their view having BEEN the ring. The C settles it:
// `adw_spinner_measure` reports MIN_SIZE as both minimum and natural with no upper
// bound (`MAX_SIZE` is defined and never referenced), while `adw_spinner_snapshot`
// hands the widget's real width and height to the paintable, which caps only `radius`
// and still centres on the box. So a 200px spinner occupies 200px of layout and draws
// a 64px ring in the middle.
//
// Reference: refs/libadwaita/src/adw-spinner.c
// Reference: refs/libadwaita/src/adw-spinner-paintable.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** How close two radian values have to be to count as equal. */
export const SPINNER_ARC_TOLERANCE = 1e-9;

/**
 * The arc lengths actually DRAWN, in radians — measured over one cycle at 200k
 * samples, not read off the constants.
 *
 * `MAX_ARC_LENGTH` is `pi * 0.9` (162 degrees) and both `get_arc_start` and
 * `get_arc_end` lerp TOWARDS it, but each then subtracts the drift term
 * `angle * MAX_ARC_LENGTH / cycle_length` that advances the figure around the circle.
 * The two ends drift together, so the visible arc peaks at 102.8 degrees, not 162 —
 * reading the constant as the drawn length is the obvious mistake. The minimum is
 * exactly `MIN_ARC_LENGTH`, the drift being zero at the cycle boundary.
 */
export const SPINNER_ARC_ENVELOPE = {
    /** Exactly `MIN_ARC_LENGTH` — 2.7 degrees, at the cycle boundary. */
    min: Math.PI * 0.015,
    /** 102.815... degrees. Asserted to a tolerance, not to the last digit. */
    max: 1.794463,
    /** How far a measured extreme may sit from the value above. */
    tolerance: 1e-4,
} as const;

/**
 * One named moment of `get_arc_start` / `get_arc_end` within a cycle.
 *
 * The rows name the MOMENT, not the length: lengths are derived from the C's own
 * constants rather than typed in, so what they pin is the shape — arc shortest at the
 * cycle boundary, longest around the extend/contract handover, never outside
 * `[MIN_ARC_LENGTH, MAX_ARC_LENGTH]`.
 */
export interface SpinnerArcShapeVector {
    /** Fraction of one arc cycle, 0..1. */
    phase: number;
    rule: string;
}

/**
 * The moments worth naming in one arc cycle.
 *
 * CORE-ONLY: GAP — the arc is drawn per frame from `spinnerArc` and a renderer can only show the
 * RESULT. What the browser suite checks is the round caps, and that the arc BREATHES at all
 * (`spread > 0`, whose discriminator is the constant 90° chase this element used to draw). The
 * envelope these rows pin — never outside [MIN_ARC_LENGTH, MAX_ARC_LENGTH] — is checked by no
 * renderer. Tracked in #1072
 */
export const SPINNER_ARC_PHASE_VECTORS: ReadonlyArray<SpinnerArcShapeVector> = [
    { phase: 0, rule: 'the cycle boundary — the arc is at MIN_ARC_LENGTH, its shortest' },
    { phase: 0.15, rule: 'extending: ease_in_out_sine is still accelerating' },
    { phase: 0.41, rule: 'the extend phase ends (EXTEND_DISTANCE / cycle) — the arc is at its longest' },
    { phase: 0.6, rule: 'contracting: the leading end has started catching up' },
    { phase: 0.66, rule: 'the contract phase ends and the idle one begins' },
    { phase: 0.9, rule: 'idling: both ends move together, so the length holds' },
];

/** One "is this constant what the C says" expectation. */
export interface SpinnerConstantVector {
    /** The constant's name in the C. */
    name: string;
    /** Its value, as a multiple of pi where the C writes one. */
    value: number;
    /** Where it is defined and what the ports had instead. */
    rule: string;
}

/**
 * The animation `#define`s plus `adw-spinner.c`'s own size constants.
 *
 * Four of these seven were wrong or absent in a shipping port; as a table, "the port
 * picked its own number" fails a test instead of reading as a design choice.
 *
 * CORE-ONLY: a table OF constants — what a renderer can show is the geometry they
 * produce, asserted by the browser suite through SPINNER_GEOMETRY/SIZE_VECTORS.
 */
export const SPINNER_CONSTANT_VECTORS: ReadonlyArray<SpinnerConstantVector> = [
    {
        name: 'SPIN_DURATION_MS',
        value: 1200,
        rule: ':20 — the browser used 0.8s, so its ring turned 1.5x too fast',
    },
    {
        name: 'START_ANGLE',
        value: Math.PI * 0.35,
        rule: ':21 — added to both arc ends (:379-380); absent from both ports, a constant phase error',
    },
    {
        name: 'CIRCLE_OPACITY',
        value: 0.15,
        rule: ':22 — of the WIDGET colour; the browser hardcoded rgba(127,127,127,0.25), darker and hue-independent',
    },
    {
        name: 'MIN_ARC_LENGTH',
        value: Math.PI * 0.015,
        rule: ':24 — 2.7 degrees, the shortest arc GSK will still draw',
    },
    {
        name: 'MAX_ARC_LENGTH',
        value: Math.PI * 0.9,
        rule: ':25 — 162 degrees; the browser drew a fixed 90 and never breathed',
    },
    {
        name: 'N_CYCLES',
        value: 53,
        rule: ':33 — chosen so a whole number of arc cycles fits a whole number of turns',
    },
    {
        name: 'MIN_SIZE',
        value: 16,
        rule: 'adw-spinner.c:14 — reported as BOTH minimum and natural (:78-81), so a spinner never grows on its own',
    },
];
