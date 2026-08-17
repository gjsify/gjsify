// Browser wiring for GtkScrolledWindow's edge indicators — the DOM half of
// `@gjsify/adwaita-core`'s `scrolling.ts`, which owns the arithmetic.
//
// WHY a discovery pass and not a widget. GTK has a `scrolledwindow` node, so the
// stylesheet can say `toolbarview.undershoot-top scrolledwindow` and be done. The
// browser has no such element — any block with `overflow: auto` is one — so the
// equivalent scope has to be computed. The scope is deliberately the same as
// upstream's: a DESCENDANT selector, so a toolbar view shades EVERY scroller under
// it, not only the one it directly wraps. That is what makes the storybook's three
// panes (story list, preview, controls) each shade themselves independently.
//
// WHY the top and bottom indicators share one pseudo-element each. Undershoot and
// overshoot at the same edge are mutually exclusive by construction: an undershoot
// says content is hidden past the edge, an overshoot says the position is past it,
// and `overshootDistance` is 0 for as long as `isScrolledFromStart` is true. One
// box per edge, switched by which state is live.
//
// WHY sticky. The indicator has to stay welded to the scrollport edge while the
// content moves under it, and it must consume no layout. `position: sticky` plus a
// negative margin equal to its height is the only combination that does both — an
// absolutely-positioned child of a scroll container scrolls away with the content.
// The one constraint this leaves: a scroller that is itself a flex/grid container
// with a `gap` pays that gap once for the pseudo-element. Scrollers are wrappers,
// so this has not bitten; a scroller with a gap should move it to an inner box.
//
// Reference: refs/gtk/gtk/gtkscrolledwindow.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_scrolling.scss
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+.

import {
    ADW_OVERSHOOT_SETTLE_MS,
    ADW_UNDERSHOOT_CLASSES,
    accumulateOvershoot,
    overshootDistance,
    type ScrollAdjustment,
    scrollUndershootClasses,
} from '@gjsify/adwaita-core';

/** Marks a scroller adwaita-web has taken over, so the stylesheet can target it. */
const SHADED_CLASS = 'adw-scroll-shaded';

/** The custom property carrying the live overshoot size, in px. */
const OVERSHOOT_PROPERTY = '--adw-overshoot';

/** Which edge is currently overshooting, as a state class. */
const OVERSHOOT_CLASSES = ['overshoot-top', 'overshoot-bottom'] as const;

/**
 * `overflow` values that make a box a scrollport.
 *
 * `overlay` is a WebKit alias for `auto` that a browser may still report from
 * author CSS even though it is removed from the spec, so a scroller written that
 * way is one and has to be treated as one.
 */
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

/** Per-axis adjustments as the DOM reports them. */
function adjustmentsOf(el: HTMLElement): { vertical?: ScrollAdjustment; horizontal?: ScrollAdjustment } {
    const style = getComputedStyle(el);
    const vertical = SCROLLABLE_OVERFLOW.has(style.overflowY)
        ? { value: el.scrollTop, lower: 0, upper: el.scrollHeight, pageSize: el.clientHeight }
        : undefined;
    const horizontal = SCROLLABLE_OVERFLOW.has(style.overflowX)
        ? { value: el.scrollLeft, lower: 0, upper: el.scrollWidth, pageSize: el.clientWidth }
        : undefined;
    return { vertical, horizontal };
}

/** Whether a box scrolls on either axis at all. */
function isScroller(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return SCROLLABLE_OVERFLOW.has(style.overflowY) || SCROLLABLE_OVERFLOW.has(style.overflowX);
}

/**
 * A wheel delta in CSS pixels, whatever unit the event chose to speak in.
 *
 * `deltaMode` is not decoration — Firefox reports `DOM_DELTA_LINE` (3-ish per
 * detent) where Chrome reports pixels (100-ish per detent), so an unconverted
 * delta makes the overshoot two orders of magnitude smaller on one browser. The
 * line height is the conventional 16px default scaled by the browser's own
 * three-lines-per-detent step.
 */
function wheelDeltaPx(event: WheelEvent, port: number): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * port;
    return event.deltaY;
}

/** Which vertical edges may draw an undershoot — a toolbar view's own two flags. */
export interface AdwUndershootEdges {
    /** `undershoot-top` on the view: the top bar is flat and was allocated a height. */
    top: boolean;
    /** `undershoot-bottom` on the view. */
    bottom: boolean;
}

/**
 * Keeps every scroller under a root marked with its live edge indicators.
 *
 * One instance per toolbar view. Scroll and wheel are listened for in the CAPTURE
 * phase on the root: `scroll` does not bubble, but capture propagation runs down
 * the whole path regardless, so one pair of listeners covers scrollers that appear
 * later without re-binding per element.
 */
export class AdwScrollShading {
    private _root: HTMLElement;
    private _mutations: MutationObserver | null = null;
    private _resize: ResizeObserver | null = null;
    /** The unclamped position per scroller, i.e. `priv->unclamped_vadj_value`. */
    private _unclamped = new WeakMap<HTMLElement, number>();
    private _settleTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
    /** Every scroller currently marked, so teardown and rescans can clear them. */
    private _shaded = new Set<HTMLElement>();
    private _pendingScan = 0;
    private _undershootEdges: AdwUndershootEdges = { top: true, bottom: true };

    constructor(root: HTMLElement) {
        this._root = root;
    }

    /**
     * Which edges may draw an UNDERSHOOT. The overshoot glow is not gated: upstream
     * draws it on every `scrolledwindow`, while the undershoot is what a toolbar
     * view turns on for a flat bar and off for a raised one, which has its own
     * shadow (`update_undershoots`).
     */
    setUndershootEdges(edges: AdwUndershootEdges): void {
        if (edges.top === this._undershootEdges.top && edges.bottom === this._undershootEdges.bottom) return;
        this._undershootEdges = { ...edges };
        for (const el of this._shaded) this._update(el);
    }

    /** Start observing. Idempotent. */
    connect(): void {
        if (this._mutations) return;
        this._root.addEventListener('scroll', this._onScroll, { capture: true, passive: true });
        this._root.addEventListener('wheel', this._onWheel, { capture: true, passive: true });
        // A rescan reads the computed overflow of every descendant, so it is coalesced
        // to one per frame: replacing a story fires a mutation record per node.
        this._mutations = new MutationObserver(() => this._scheduleRefresh());
        this._mutations.observe(this._root, { childList: true, subtree: true });
        this._resize = new ResizeObserver(() => this._scheduleRefresh());
        this._resize.observe(this._root);
        this.refresh();
    }

    /** Stop observing and clear every class this instance set. */
    disconnect(): void {
        this._root.removeEventListener('scroll', this._onScroll, { capture: true });
        this._root.removeEventListener('wheel', this._onWheel, { capture: true });
        this._mutations?.disconnect();
        this._mutations = null;
        this._resize?.disconnect();
        this._resize = null;
        if (this._pendingScan) cancelAnimationFrame(this._pendingScan);
        this._pendingScan = 0;
        for (const el of this._shaded) this._clear(el);
        this._shaded.clear();
    }

    private _scheduleRefresh(): void {
        if (this._pendingScan) return;
        this._pendingScan = requestAnimationFrame(() => {
            this._pendingScan = 0;
            this.refresh();
        });
    }

    /** Re-scan for scrollers and re-derive every indicator. */
    refresh(): void {
        const found = new Set<HTMLElement>();
        // The ROOT counts: a toolbar view whose content area scrolls on its own is
        // the common case, and `querySelectorAll` never returns the element it was
        // called on.
        if (isScroller(this._root)) found.add(this._root);
        for (const el of this._root.querySelectorAll<HTMLElement>('*')) {
            if (isScroller(el)) found.add(el);
        }
        for (const el of this._shaded) {
            if (!found.has(el)) this._clear(el);
        }
        this._shaded = found;
        for (const el of found) this._update(el);
    }

    private _clear(el: HTMLElement): void {
        el.classList.remove(SHADED_CLASS, ...ADW_UNDERSHOOT_CLASSES, ...OVERSHOOT_CLASSES);
        el.style.removeProperty(OVERSHOOT_PROPERTY);
    }

    /** Re-derive the undershoot classes of one scroller from its current position. */
    private _update(el: HTMLElement): void {
        el.classList.add(SHADED_CLASS);
        const live = scrollUndershootClasses(adjustmentsOf(el));
        for (const cls of ADW_UNDERSHOOT_CLASSES) {
            const allowed =
                (cls !== 'undershoot-top' || this._undershootEdges.top) &&
                (cls !== 'undershoot-bottom' || this._undershootEdges.bottom);
            el.classList.toggle(cls, allowed && live.includes(cls));
        }
    }

    private _onScroll = (event: Event): void => {
        const el = event.target;
        if (el instanceof HTMLElement && this._shaded.has(el)) this._update(el);
    };

    /**
     * The overshoot half. A browser scroll container clamps at its edge and reports
     * nothing further, so the push past it is read off the wheel deltas the
     * container could not consume — which is exactly the value upstream keeps in
     * `unclamped_vadj_value` and clamps one overshoot distance out.
     */
    private _onWheel = (event: WheelEvent): void => {
        const el = event.target instanceof HTMLElement ? this._scrollerFor(event.target) : null;
        if (!el) return;
        const { vertical } = adjustmentsOf(el);
        if (!vertical) return;

        const previous = this._unclamped.get(el) ?? vertical.value;
        // A scroll that landed back inside the range resets the accumulator: the
        // position the user pushed from is the real one again.
        const base = overshootDistance(previous, vertical) === 0 ? vertical.value : previous;
        const next = accumulateOvershoot(base, wheelDeltaPx(event, vertical.pageSize), vertical);
        this._unclamped.set(el, next);
        this._applyOvershoot(el, overshootDistance(next, vertical));

        // Spring back once the wheel STOPS, not between two detents of one gesture.
        clearTimeout(this._settleTimers.get(el));
        this._settleTimers.set(
            el,
            setTimeout(() => {
                this._unclamped.set(el, el.scrollTop);
                this._applyOvershoot(el, 0);
            }, ADW_OVERSHOOT_SETTLE_MS),
        );
    };

    private _applyOvershoot(el: HTMLElement, distance: number): void {
        el.classList.toggle('overshoot-top', distance < 0);
        el.classList.toggle('overshoot-bottom', distance > 0);
        if (distance === 0) el.style.removeProperty(OVERSHOOT_PROPERTY);
        else el.style.setProperty(OVERSHOOT_PROPERTY, `${Math.abs(distance)}px`);
    }

    /** The nearest shaded scroller at or above a wheel target, root included. */
    private _scrollerFor(target: HTMLElement): HTMLElement | null {
        for (let el: HTMLElement | null = target; el; el = el.parentElement) {
            if (this._shaded.has(el)) return el;
            if (el === this._root) break;
        }
        return null;
    }
}
