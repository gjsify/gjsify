// `Adw.Spinner` / `AdwSpinnerPaintable` — the animation, headless (ADR 0004).
//
// The spinner is not a rotating quarter-circle. The arc BREATHES: it extends,
// overlaps, contracts and idles, all while the whole figure turns — a four-phase
// cycle whose length is deliberately chosen so that a whole number of arc cycles
// fits a whole number of turns. `_spinner.scss` drew a fixed 90° `border-top-color`
// chase at 0.8s, which is a different animation with a different period, and the
// NativeScript port draws the platform's.
//
// The DRAWN arc spans 2.7° to 102.8°, not to `MAX_ARC_LENGTH`'s 162°: both ends
// lerp towards it and then subtract the same drift term, which is what advances
// the figure. `SPINNER_ARC_ENVELOPE` in the conformance table is the measured
// answer — reading the constant as the drawn length is the obvious mistake.
//
// Every number here is a `#define` in the C. They are exported rather than
// inlined because the browser renderer needs the geometry per frame and the
// vectors need the same numbers to judge it with — the one thing that must not
// happen is a second reading of these constants.
//
// Reference: refs/libadwaita/src/adw-spinner.c
// Reference: refs/libadwaita/src/adw-spinner-paintable.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { adwLerp, easeInOutSine } from './easing.js';

/** `SPIN_DURATION_MS` (adw-spinner-paintable.c:20) — one full turn. */
export const ADW_SPINNER_SPIN_DURATION_MS = 1200;

/**
 * `START_ANGLE` (adw-spinner-paintable.c:21) — a fixed phase offset added to
 * both arc ends (:379-380), so the figure does not start at 3 o'clock.
 *
 * Neither port had it, which is a constant rotation error rather than a wrong
 * speed — invisible in a still frame, visible against a GTK spinner beside it.
 */
export const ADW_SPINNER_START_ANGLE = Math.PI * 0.35;

/**
 * `CIRCLE_OPACITY` (adw-spinner-paintable.c:22) — the track is the WIDGET's
 * colour at 15%, not a hardcoded grey.
 *
 * The browser port used `rgba(127, 127, 127, 0.25)`: too dark, and
 * hue-independent, so a spinner on a coloured background lost its track
 * relationship entirely.
 */
export const ADW_SPINNER_TRACK_OPACITY = 0.15;

/** `MIN_ARC_LENGTH` (:24) — GSK refuses to draw an arc shorter than this. */
export const ADW_SPINNER_MIN_ARC_LENGTH = Math.PI * 0.015;

/** `MAX_ARC_LENGTH` (:25) — the LERP TARGET, 162°. The drawn arc peaks at 102.8°. */
export const ADW_SPINNER_MAX_ARC_LENGTH = Math.PI * 0.9;

/** `IDLE_DISTANCE` (:26). */
export const ADW_SPINNER_IDLE_DISTANCE = Math.PI * 0.9;

/** `OVERLAP_DISTANCE` (:27). */
export const ADW_SPINNER_OVERLAP_DISTANCE = Math.PI * 0.7;

/** `EXTEND_DISTANCE` (:28). */
export const ADW_SPINNER_EXTEND_DISTANCE = Math.PI * 1.1;

/** `CONTRACT_DISTANCE` (:29). */
export const ADW_SPINNER_CONTRACT_DISTANCE = Math.PI * 1.35;

/**
 * `N_CYCLES` (:33) — how many full TURNS the animation runs before repeating.
 *
 * The C states the constraint it satisfies: the cycle length
 * `IDLE + EXTEND + CONTRACT - OVERLAP` must divide `N_CYCLES * 2pi` exactly, or
 * the arc would jump when the animation loops. It does — 53 turns is 40 arc
 * cycles — and {@link ADW_SPINNER_CYCLES_PER_LOOP} is that quotient, asserted
 * rather than assumed.
 */
export const ADW_SPINNER_N_CYCLES = 53;

/**
 * One arc cycle, in radians of base angle:
 * `IDLE_DISTANCE + EXTEND_DISTANCE + CONTRACT_DISTANCE - OVERLAP_DISTANCE`
 * (adw-spinner-paintable.c:112, :130).
 */
export const ADW_SPINNER_CYCLE_LENGTH =
    ADW_SPINNER_IDLE_DISTANCE +
    ADW_SPINNER_EXTEND_DISTANCE +
    ADW_SPINNER_CONTRACT_DISTANCE -
    ADW_SPINNER_OVERLAP_DISTANCE;

/** Whole arc cycles per animation loop — an integer, which is the C's constraint. */
export const ADW_SPINNER_CYCLES_PER_LOOP = (ADW_SPINNER_N_CYCLES * Math.PI * 2) / ADW_SPINNER_CYCLE_LENGTH;

/**
 * The base angle a NON-animating spinner is drawn at — `EXTEND_DISTANCE -
 * OVERLAP_DISTANCE / 2` (adw-spinner-paintable.c:375-376), i.e. `pi * 0.75`.
 *
 * Reached whenever there is no animation object: before the paintable has a
 * widget, and in a still frame. Both ports left the resting pose undefined, so a
 * spinner that had not started yet drew whatever its keyframe origin happened to
 * be.
 */
export const ADW_SPINNER_STILL_PROGRESS = ADW_SPINNER_EXTEND_DISTANCE - ADW_SPINNER_OVERLAP_DISTANCE / 2;

/**
 * `normalize_angle` (adw-spinner-paintable.c:97-107) — fold into `[0, 2pi]`.
 *
 * The C loops rather than taking a modulo, and the boundary follows: it stops at
 * `angle > G_PI * 2`, so exactly `2pi` is left alone where a modulo would give 0.
 */
export function normalizeSpinnerAngle(angle: number): number {
    let value = angle;
    while (value < 0) value += Math.PI * 2;
    while (value > Math.PI * 2) value -= Math.PI * 2;
    return value;
}

/**
 * `get_arc_start` (adw-spinner-paintable.c:109-125) — the trailing end of the
 * arc, relative to the base angle.
 *
 * The `- angle * MAX_ARC_LENGTH / l` term is the drift that makes the arc
 * advance around the circle as it breathes; without it the figure would pulse in
 * place.
 */
export function spinnerArcStart(angle: number): number {
    const local = angle % ADW_SPINNER_CYCLE_LENGTH;
    const t = local > ADW_SPINNER_EXTEND_DISTANCE ? 1 : easeInOutSine(local / ADW_SPINNER_EXTEND_DISTANCE);
    return (
        adwLerp(ADW_SPINNER_MIN_ARC_LENGTH, ADW_SPINNER_MAX_ARC_LENGTH, t) -
        (local * ADW_SPINNER_MAX_ARC_LENGTH) / ADW_SPINNER_CYCLE_LENGTH
    );
}

/**
 * `get_arc_end` (adw-spinner-paintable.c:127-145) — the leading end.
 *
 * Its phase is offset by `EXTEND_DISTANCE - OVERLAP_DISTANCE`: the end only
 * starts moving once the start has extended past the overlap, which is what
 * makes the arc grow before it slides.
 */
export function spinnerArcEnd(angle: number): number {
    const local = angle % ADW_SPINNER_CYCLE_LENGTH;
    const extendMinusOverlap = ADW_SPINNER_EXTEND_DISTANCE - ADW_SPINNER_OVERLAP_DISTANCE;
    let t: number;
    if (local < extendMinusOverlap) t = 0;
    else if (local > ADW_SPINNER_CYCLE_LENGTH - ADW_SPINNER_IDLE_DISTANCE) t = 1;
    else t = easeInOutSine((local - extendMinusOverlap) / ADW_SPINNER_CONTRACT_DISTANCE);
    return (
        adwLerp(0, ADW_SPINNER_MAX_ARC_LENGTH - ADW_SPINNER_MIN_ARC_LENGTH, t) -
        (local * ADW_SPINNER_MAX_ARC_LENGTH) / ADW_SPINNER_CYCLE_LENGTH
    );
}

/** The two ends of the drawn arc, in radians clockwise from 3 o'clock. */
export interface SpinnerArc {
    /** Trailing end, folded into `[0, 2pi]`. */
    start: number;
    /** Leading end, folded into `[0, 2pi]`. */
    end: number;
    /**
     * Arc length along the circle, `start - end` unwrapped into `(0, 2pi]`.
     *
     * The segment runs from `end` to `start` (`gsk_path_builder_add_segment
     * (builder, circle, &end_point, &start_point)`, :395) — the naming is the C's
     * and it is the opposite way round from what "start" suggests.
     */
    length: number;
}

/**
 * The arc for a base angle — `adw_spinner_paintable_snapshot_with_weight`
 * (adw-spinner-paintable.c:373-383).
 *
 * `progress` is the animation's value: 0 at the start of a loop, rising linearly
 * to `N_CYCLES * 2pi`. A renderer that has no animation passes
 * {@link ADW_SPINNER_STILL_PROGRESS}.
 */
export function spinnerArc(progress: number): SpinnerArc {
    const base = progress;
    const start = normalizeSpinnerAngle(base + spinnerArcStart(base) + ADW_SPINNER_START_ANGLE);
    const end = normalizeSpinnerAngle(base + spinnerArcEnd(base) + ADW_SPINNER_START_ANGLE);
    let length = start - end;
    // The segment wraps whenever the trailing end has crossed 2pi and the leading
    // one has not; a zero-length reading means a full circle, never an empty arc,
    // because the two ends are never equal in the C's phase relationship.
    while (length <= 0) length += Math.PI * 2;
    return { start, end, length };
}

/**
 * The animation's value after `elapsedMs` — `adw_timed_animation_new (widget, 0,
 * N_CYCLES * 2pi, SPIN_DURATION_MS * N_CYCLES, target)` with `ADW_LINEAR` easing
 * and `repeat_count = 0`, i.e. forever (adw-spinner-paintable.c:532-540).
 *
 * A linear ramp over the whole loop reduces to one turn per
 * {@link ADW_SPINNER_SPIN_DURATION_MS}; the loop length only decides where it
 * restarts, and it restarts at a point the arc phase agrees with.
 */
export function spinnerProgressAt(elapsedMs: number): number {
    const loopMs = ADW_SPINNER_SPIN_DURATION_MS * ADW_SPINNER_N_CYCLES;
    const within = ((elapsedMs % loopMs) + loopMs) % loopMs;
    return (within / ADW_SPINNER_SPIN_DURATION_MS) * Math.PI * 2;
}
