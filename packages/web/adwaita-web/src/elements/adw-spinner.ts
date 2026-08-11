// <adw-spinner> — A continuously-spinning loading indicator.
// Attributes: size (px; the BOX, floored at the measured minimum 16).
//
// THE BOX AND THE RING ARE DIFFERENT THINGS. `adw_spinner_measure` reports MIN_SIZE as
// both minimum and natural and has no upper bound, while `adw_spinner_snapshot` hands
// the widget's real size to the paintable, which caps only `radius` and still centres on
// the box. So `size="200"` occupies 200px of layout and draws a 64px ring in the middle.
//
// THE ARC IS NOT A ROTATING QUARTER-CIRCLE. It extends, overlaps, contracts and idles on
// an ease-in-out-sine while the figure turns; the arithmetic is `@gjsify/adwaita-core`'s
// `spinnerArc`, shared with the vectors that judge it. That needs a per-frame value, so
// this element draws an SVG arc and advances it from one module-level ticker. CSS
// keyframes cannot express it — a `border-top-color` chase is a fixed 90 degrees.
//
// IT KEEPS SPINNING UNDER REDUCED MOTION, deliberately: a frozen busy indicator reads as
// a hang, which is why `adw_spinner_paintable_set_widget` calls
// `adw_animation_set_follow_enable_animations_setting (…, FALSE)`. Do not reintroduce a
// `@media (prefers-reduced-motion: reduce) { animation: none }` rule for it.
//
// Reference: refs/libadwaita/src/adw-spinner.c (MIN_SIZE, adw_spinner_measure, the a11y role)
// Reference: refs/libadwaita/src/adw-spinner-paintable.c (the animation + geometry)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ADW_SPINNER_STILL_PROGRESS,
    ADW_SPINNER_TRACK_OPACITY,
    resolveSpinnerSize,
    spinnerArc,
    spinnerGeometry,
    spinnerProgressAt,
} from '@gjsify/adwaita-core';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Every mapped spinner, driven by ONE `requestAnimationFrame` loop.
 *
 * The C animates per widget off the frame clock, which costs nothing extra because the
 * clock is already ticking. A browser has no such clock, so the equivalent is one shared
 * rAF: N spinners must not mean N loops, and the loop must not exist while none are mapped.
 */
const mapped = new Set<AdwSpinner>();
let frameHandle = 0;

function tick(now: number): void {
    for (const spinner of mapped) spinner.drawAt(now);
    frameHandle = mapped.size > 0 ? requestAnimationFrame(tick) : 0;
}

function startTicking(): void {
    if (frameHandle === 0 && mapped.size > 0) frameHandle = requestAnimationFrame(tick);
}

export class AdwSpinner extends HTMLElement {
    static get observedAttributes() {
        return ['size'];
    }

    private _svg: SVGSVGElement | null = null;
    private _track: SVGCircleElement | null = null;
    private _arc: SVGCircleElement | null = null;
    /** Path length of the ring, so the dash arithmetic is done once per resize. */
    private _circumference = 0;
    /** Ring radius in px — the dash lengths are arc-length, i.e. radians × r. */
    private _radius = 0;
    /** The timestamp this spinner was mapped at, so its progress starts at 0. */
    private _origin: number | null = null;

    connectedCallback() {
        this._build();
        // `widget_map_cb` plays the animation on MAP, not on construction: an off-screen
        // spinner burns nothing.
        mapped.add(this);
        this._origin = null;
        startTicking();
    }

    disconnectedCallback() {
        mapped.delete(this);
    }

    attributeChangedCallback() {
        this._sync();
    }

    /**
     * Draw the frame for `now`, in `requestAnimationFrame` timebase. Public because the
     * shared ticker is a module-level function, and because a test needs to place the
     * spinner at a known moment without waiting for real frames.
     */
    drawAt(now: number): void {
        if (this._origin === null) this._origin = now;
        this._paint(spinnerProgressAt(now - this._origin));
    }

    private _build(): void {
        if (this._svg) return;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('fill', 'none');
        // The ring is decorative; the ROLE is on the host.
        svg.setAttribute('aria-hidden', 'true');

        const track = document.createElementNS(SVG_NS, 'circle');
        track.setAttribute('stroke', 'currentColor');
        // C's `CIRCLE_OPACITY` of the WIDGET's colour, not a hardcoded grey, so the track
        // follows the text colour everywhere.
        track.setAttribute('stroke-opacity', String(ADW_SPINNER_TRACK_OPACITY));

        const arc = document.createElementNS(SVG_NS, 'circle');
        arc.setAttribute('stroke', 'currentColor');
        // C's `GSK_LINE_CAP_ROUND`; square-cut ends are visible from 48px up.
        arc.setAttribute('stroke-linecap', 'round');

        svg.append(track, arc);
        this._svg = svg;
        this._track = track;
        this._arc = arc;
        this.replaceChildren(svg);

        // C's `gtk_widget_class_set_accessible_role (…, PROGRESS_BAR)` plus
        // `GTK_ACCESSIBLE_STATE_BUSY, TRUE`; without both, screen readers announce nothing.
        this.setAttribute('role', 'progressbar');
        this.setAttribute('aria-busy', 'true');

        this._sync();
    }

    /** Re-derive the box, the ring and the stroke from the `size` attribute. */
    private _sync(): void {
        const svg = this._svg;
        const track = this._track;
        const arc = this._arc;
        if (!svg || !track || !arc) return;

        const size = resolveSpinnerSize(this.getAttribute('size'));
        const { diameter, lineWidth } = spinnerGeometry(size, size);
        // THE BOX: whatever was asked for, floored at the measured minimum.
        this.style.width = `${size}px`;
        this.style.height = `${size}px`;
        // THE RING: capped at 64, centred by the host's flex box.
        svg.setAttribute('width', String(diameter));
        svg.setAttribute('height', String(diameter));
        svg.setAttribute('viewBox', `0 0 ${diameter} ${diameter}`);

        // The stroke is centred on the path, so the circle sits half a stroke in.
        const radius = (diameter - lineWidth) / 2;
        this._radius = radius;
        this._circumference = 2 * Math.PI * radius;
        for (const circle of [track, arc]) {
            circle.setAttribute('cx', String(diameter / 2));
            circle.setAttribute('cy', String(diameter / 2));
            circle.setAttribute('r', String(radius));
            circle.setAttribute('stroke-width', String(lineWidth));
        }
        // A resize while unmapped still has to leave a drawable frame behind:
        // the resting pose, which is what a paintable without an animation draws.
        this._paint(this._origin === null ? ADW_SPINNER_STILL_PROGRESS : this._lastProgress);
    }

    /** The progress the last painted frame used, so a resize can repaint it. */
    private _lastProgress = ADW_SPINNER_STILL_PROGRESS;

    private _paint(progress: number): void {
        const arc = this._arc;
        if (!arc || this._radius <= 0) return;
        this._lastProgress = progress;
        const { end, length } = spinnerArc(progress);
        const drawn = length * this._radius;
        arc.setAttribute('stroke-dasharray', `${drawn} ${Math.max(this._circumference - drawn, 0)}`);
        // An SVG circle's path starts at 3 o'clock and runs clockwise, the same origin and
        // direction as the C's angles, so a radian is a path distance and the dash only
        // has to be shifted to `end`.
        arc.setAttribute('stroke-dashoffset', String(-end * this._radius));
    }
}

customElements.define('adw-spinner', AdwSpinner);
