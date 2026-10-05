// <gtk-scrolled-window> — the widget every scrolling GTK window is built from: one child,
// two adjustments, and up to two scrollbars that appear only when there is something to
// scroll.
//
// THE PARTS ARE GTK'S PARTS, NOT AN ARRANGEMENT OF THIS ONE'S. The child goes into a
// `<gtk-viewport>` — `gtk_scrolled_window_set_property(child)` "will add the child to a
// Gtk.Viewport and then set the viewport as the child" (gtkscrolledwindow.c:780-793), which
// `gtk_scrolled_window_set_child` does at gtkscrolledwindow.c:4362-4374 — and
// each scrollbar is a `<gtk-scrollbar>` holding the adjustment of one axis, which is how
// GTK reaches them too: `gtk_scrollbar_get_adjustment (GTK_SCROLLBAR (priv->hscrollbar))`
// is the phrase the whole of `gtkscrolledwindow.c` reads a position through. So the
// adjustments are computed by the VIEWPORT, from its own scroll metrics, in GTK's own
// fractions (`viewport_set_adjustment_values`, gtkviewport.c:159-189), and this widget owns
// only what a scrolled window owns: WHICH scrollbars are visible, WHERE they sit, and what
// the keys do.
//
// VISIBILITY IS `update_scrollbar_visibility_flags` AND NOTHING ELSE — an automatic bar is
// visible when `upper - lower > page_size` (gtkscrolledwindow.c:1553-1579), which is the
// content being longer than the window, read here as the same comparison of the same six
// numbers. GTK's guess-and-recheck loop around it (gtkscrolledwindow.c:1608-1750) exists
// because a GTK widget must be ASKED for its size and the answer moves when a scrollbar
// takes some of it. A browser reports both numbers at once, so the loop has nothing to
// converge on and the comparison is taken once per layout.
//
// WHERE THE BARS SIT IS `gtk_scrolled_window_allocate_scrollbar` (gtkscrolledwindow.c:3227-3305),
// including its two complications: `window-placement` moves them to the other edges
// (`top-left` is the default, and the L/R half is direction-aware upstream — `:dir(rtl)` is
// that here, from `is_left = ltr != is_start` at :3244-3249), and an
// OVERLAY bar is laid out INSIDE the content's own allocation, over it
// (`priv->use_indicators`, gtkscrolledwindow.c:3255-3300) rather than beside it.
//
// `overlay-scrolling` is read twice in GTK too: `use_indicators` is the AND of this property
// with the `gtk-overlay-scrolling` SETTING, which is TRUE by default
// (gtksettings.c:967-979), and the indicator is the "narrow, auto-hiding" scrollbar
// `setup_indicator` fades in on every value change and back out `INDICATOR_FADE_OUT_DELAY`
// after the last one (gtkscrolledwindow.c:191-196, 3807-3847). The settings half is the
// `(hover: hover)` media query here: whether a pointer that can HOVER exists is what decides
// between indicators and permanent bars — the sentence GTK's own class documentation puts
// the other way round ("If no mouse device is present, the scrollbars will overlaid as
// narrow, auto-hiding indicators over the content", gtkscrolledwindow.c:108-112).
//
// THE EDGE INDICATORS ARE NOT REDRAWN HERE. `AdwScrollShading` already owns the undershoot
// and overshoot bookkeeping for every scroller in this package — the unclamped position a
// browser scrollport throws away, the `MAX_OVERSHOOT_DISTANCE` clamp, the classes
// libadwaita's `scrolledwindow.undershoot-top` selector wants — and it is given this widget
// as its root, exactly as `<adw-toolbar-view>` gives it its own. Its `onOvershoot` hook is
// what turns a wheel push past an edge into this widget's `edge-overshot`.
//
// THE KEYS ARE `gtk_scrolled_window_class_init`'s OWN bindings, which are not the obvious
// ones: every arrow needs CONTROL, and Page Up/Down and Home/End are bound TWICE — bare for
// the VERTICAL axis and with CONTROL for the horizontal one
// (gtkscrolledwindow.c:894-910). `scroll-child` is an ACTION signal, so the adjustment moves
// FIRST and the signal follows. `may_hscroll` / `may_vscroll` decide whether a key scrolls at
// all, and an EXTERNAL policy counts — the bar is not drawn, but the widget can still be
// driven (gtkscrolledwindow.c:916-930).
//
// `min-content-width` / `max-content-width` (and the heights) are GTK's SIZE REQUESTS
// (`gtk_scrolled_window_measure`, gtkscrolledwindow.c:1821-1985): what the window asks its
// parent for along that axis, which is `min-width` / `max-width` here. -1, the pspec's
// default, is "not written" and sets nothing.
//
// THE TWO `propagate-natural-*` PROPERTIES MOVE THE CHILD'S OWN SIZE REQUEST UP, and they
// are asked of the CHILD (`gtk_widget_measure (priv->child, …, &min_child_size,
// &nat_child_size)`, gtkscrolledwindow.c:1881-1883) and added to this window's NATURAL
// request (`natural_req += nat_child_size`, :1887-1888 and :1905-1906). A scrollport asks
// its parent for a size with `min-width`, so the natural request is the child asked to be at
// least its `max-content` size — the CSS name for the natural one — and `hscrollbar-policy:
// never`, which adds the child's MINIMUM request instead (:1890-1892), is the same line
// with `min-content`. The larger of the two wins, which is what adding both to two requests
// and clamping them comes to. Which of the two is asked for AT ALL is `need_child_size`
// (:1841-1844), so an unwritten request sets nothing on either.
//
// A11y: `role="generic"`, which GTK 4.12 gave the widget in place of the `group` it used
// to report (gtkscrolledwindow.c:137-142, 913). The scrollport inside is the announced part.
//
// KNOWN_GAPS, the property behind each: `kinetic-scrolling` — the momentum after a touch
// release is the platform's own and a page cannot hand a browser a deceleration curve;
// `edge-overshot` fires for the VERTICAL edges only, because the shading controller
// accumulates one axis, and its horizontal pair has no unclamped value to read.
//
// Reference: refs/gtk/gtk/gtkscrolledwindow.c (class_init's key bindings, measure,
//   size_allocate, allocate_scrollbar, update_scrollbar_visibility_flags, may_hscroll,
//   setup_indicator, scroll_child, move_focus_out, get_overshoot)
// Reference: refs/libadwaita/src/stylesheet/widgets/_scrolling.scss:129-167 (scrolledwindow)
// Reference: refs/gtk/gtk/gtksettings.c:967-979 (the setting overlay-scrolling ANDs with)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import type { AdwAdjustment } from '@gjsify/adwaita-core';

import { AdwScrollShading } from '../scroll-shading.js';
import { bindSlottedChildren } from '../slotted-children.js';
import type { GtkScrollType } from './gtk-scrollbar.js';
import { GtkViewport } from './gtk-viewport.js';

/**
 * `INDICATOR_FADE_OUT_DELAY` — how long an indicator waits, after the last scroll, before
 * it fades out again (gtkscrolledwindow.c:192).
 */
const INDICATOR_FADE_OUT_DELAY = 2000;

/** `GtkPolicyType`'s four nicks; `automatic` is the pspec's default for both bars. */
export type GtkPolicyType = 'always' | 'never' | 'automatic' | 'external';

/** `GtkCornerType`'s four corners, `top-left` being the pspec's default. */
export type GtkCornerType = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** `Gtk.PositionType`'s four edges, as `edge-reached` and `edge-overshot` name them. */
export type GtkPositionType = 'left' | 'right' | 'top' | 'bottom';

/** `Gtk.DirectionType`'s two, as `move-focus-out` names them. */
export type GtkDirectionType = 'forward' | 'backward';

const POLICIES: readonly GtkPolicyType[] = ['always', 'never', 'automatic', 'external'];
const CORNERS: readonly GtkCornerType[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** An unknown nick is the pspec's default, which is what GtkBuilder's rejection leaves behind. */
function normalizePolicy(value: string | null): GtkPolicyType {
    return POLICIES.find((policy) => policy === value) ?? 'automatic';
}

function normalizeCorner(value: string | null): GtkCornerType {
    return CORNERS.find((corner) => corner === value) ?? 'top-left';
}

/** A size request in pixels, or `null` for the pspec's -1, which means "not written". */
function sizeRequest(value: string | null): number | null {
    if (value === null) return null;
    const size = Number.parseInt(value, 10);
    return Number.isFinite(size) && size >= 0 ? size : null;
}

/**
 * The two axes, in GTK's own order, with everything that differs between them.
 *
 * `end` / `farEnd` are `Gtk.PositionType`'s two names for one axis's edges, and the
 * horizontal pair is inverted under `dir(rtl)` where GTK inverts it
 * (`maybe_emit_edge_reached`, gtkscrolledwindow.c:3656-3658, and the same in
 * `_gtk_scrolled_window_set_adjustment_value` at :3346-3349) — which is
 * a CSS concern and lives in the stylesheet, so only the LTR names are named here.
 */
const AXES = [
    {
        key: 'hadjustment',
        bar: 'horizontal',
        policy: 'hscrollbar-policy',
        natural: 'propagate-natural-width',
        cssMin: 'minWidth',
        end: 'left',
        farEnd: 'right',
    },
    {
        key: 'vadjustment',
        bar: 'vertical',
        policy: 'vscrollbar-policy',
        natural: 'propagate-natural-height',
        cssMin: 'minHeight',
        end: 'top',
        farEnd: 'bottom',
    },
] as const;

/**
 * `gtk_scrolled_window_class_init`'s bindings (gtkscrolledwindow.c:894-910), read as a
 * table because the table IS the surprise: CONTROL for every arrow, and Page Up/Down and
 * Home/End on the vertical axis bare and on the horizontal one with CONTROL.
 *
 * `null` is a key this widget does not bind, which is how it reaches a focused child —
 * GTK's action handler returns FALSE and propagation continues.
 */
function resolveScrollKey(event: KeyboardEvent): { scroll: GtkScrollType; horizontal: boolean } | null {
    switch (event.key) {
        case 'ArrowLeft':
            return event.ctrlKey ? { scroll: 'step-backward', horizontal: true } : null;
        case 'ArrowRight':
            return event.ctrlKey ? { scroll: 'step-forward', horizontal: true } : null;
        case 'ArrowUp':
            return event.ctrlKey ? { scroll: 'step-backward', horizontal: false } : null;
        case 'ArrowDown':
            return event.ctrlKey ? { scroll: 'step-forward', horizontal: false } : null;
        // The pair is VERTICAL bare and HORIZONTAL with CONTROL — the reverse of what the two
        // bindings read like (gtkscrolledwindow.c:899-902).
        case 'PageUp':
            return { scroll: 'page-backward', horizontal: event.ctrlKey };
        case 'PageDown':
            return { scroll: 'page-forward', horizontal: event.ctrlKey };
        // Home and End are bound TWICE, like Page Up/Down (gtkscrolledwindow.c:904-907):
        // CONTROL for the horizontal axis and NOTHING for the vertical one.
        case 'Home':
            return { scroll: 'start', horizontal: event.ctrlKey };
        case 'End':
            return { scroll: 'end', horizontal: event.ctrlKey };
        default:
            return null;
    }
}

export class GtkScrolledWindow extends HTMLElement {
    private _viewport!: GtkViewport;
    private _bars: Record<'horizontal' | 'vertical', HTMLElement> | null = null;
    /** The size clamps `_writeSize` last wrote, which are the only ones it may clear. */
    private readonly _wroteSizes = new Set<string>();
    private _shading: AdwScrollShading | null = null;
    private _observer: ResizeObserver | null = null;
    private _hoverable: MediaQueryList | null = null;
    private _fadeTimer: ReturnType<typeof setTimeout> | null = null;
    private _built = false;

    static get observedAttributes() {
        return [
            'hscrollbar-policy',
            'vscrollbar-policy',
            'window-placement',
            'has-frame',
            'min-content-width',
            'min-content-height',
            'max-content-width',
            'max-content-height',
            'overlay-scrolling',
            'propagate-natural-width',
            'propagate-natural-height',
        ];
    }

    /** `GtkScrolledWindow:hscrollbar-policy` — `automatic` in the pspec. */
    get hscrollbarPolicy(): GtkPolicyType {
        return normalizePolicy(this.getAttribute('hscrollbar-policy'));
    }

    set hscrollbarPolicy(value: GtkPolicyType) {
        this.setAttribute('hscrollbar-policy', value);
    }

    /** `GtkScrolledWindow:vscrollbar-policy` — `automatic` in the pspec. */
    get vscrollbarPolicy(): GtkPolicyType {
        return normalizePolicy(this.getAttribute('vscrollbar-policy'));
    }

    set vscrollbarPolicy(value: GtkPolicyType) {
        this.setAttribute('vscrollbar-policy', value);
    }

    /** `GtkScrolledWindow:window-placement` — where the contents sit against the bars. */
    get windowPlacement(): GtkCornerType {
        return normalizeCorner(this.getAttribute('window-placement'));
    }

    set windowPlacement(value: GtkCornerType) {
        this.setAttribute('window-placement', value);
    }

    /** `GtkScrolledWindow:has-frame` — the `.frame` style class on the node, and nothing more. */
    get hasFrame(): boolean {
        return this.hasAttribute('has-frame');
    }

    set hasFrame(value: boolean) {
        this.toggleAttribute('has-frame', !!value);
    }

    /** `GtkScrolledWindow:overlay-scrolling` — TRUE in the pspec, and unknown is that. */
    get overlayScrolling(): boolean {
        return this.getAttribute('overlay-scrolling') !== 'false';
    }

    set overlayScrolling(value: boolean) {
        this.toggleAttribute('overlay-scrolling', !!value);
    }

    /** `GtkScrolledWindow:min-content-width`, in px, or `null` for the pspec's -1. */
    get minContentWidth(): number | null {
        return sizeRequest(this.getAttribute('min-content-width'));
    }

    set minContentWidth(value: number | null) {
        this._writeSizeRequest('min-content-width', value);
    }

    /** `GtkScrolledWindow:min-content-height`, in px, or `null` for the pspec's -1. */
    get minContentHeight(): number | null {
        return sizeRequest(this.getAttribute('min-content-height'));
    }

    set minContentHeight(value: number | null) {
        this._writeSizeRequest('min-content-height', value);
    }

    /** `GtkScrolledWindow:max-content-width`, in px, or `null` for the pspec's -1. */
    get maxContentWidth(): number | null {
        return sizeRequest(this.getAttribute('max-content-width'));
    }

    set maxContentWidth(value: number | null) {
        this._writeSizeRequest('max-content-width', value);
    }

    /** `GtkScrolledWindow:max-content-height`, in px, or `null` for the pspec's -1. */
    get maxContentHeight(): number | null {
        return sizeRequest(this.getAttribute('max-content-height'));
    }

    set maxContentHeight(value: number | null) {
        this._writeSizeRequest('max-content-height', value);
    }

    /** `GtkScrolledWindow:propagate-natural-width` — FALSE in the pspec, so absent is that. */
    get propagateNaturalWidth(): boolean {
        return this.hasAttribute('propagate-natural-width');
    }

    set propagateNaturalWidth(value: boolean) {
        this.toggleAttribute('propagate-natural-width', !!value);
    }

    /** `GtkScrolledWindow:propagate-natural-height` — FALSE in the pspec, so absent is that. */
    get propagateNaturalHeight(): boolean {
        return this.hasAttribute('propagate-natural-height');
    }

    set propagateNaturalHeight(value: boolean) {
        this.toggleAttribute('propagate-natural-height', !!value);
    }

    /**
     * `gtk_scrolled_window_get_hscrollbar` / `get_vscrollbar`, as METHODS and not getters.
     *
     * `connect-lifecycle.spec.ts` reads a get-only accessor returning an element as an
     * invitation to append into it, and a scrollbar that is not visible is not an append
     * point — which is the whole of what a getter here would be asking for.
     */
    hscrollbar(): HTMLElement | null {
        return this._bars?.horizontal ?? null;
    }

    vscrollbar(): HTMLElement | null {
        return this._bars?.vertical ?? null;
    }

    /** The `<gtk-viewport>` the child sits in — the one GTK's `set_child` builds for itself. */
    get viewport(): GtkViewport {
        return this._viewport;
    }

    connectedCallback() {
        if (!this._built) {
            this._built = true;
            this._viewport = document.createElement('gtk-viewport') as GtkViewport;
            const horizontal = document.createElement('gtk-scrollbar');
            const vertical = document.createElement('gtk-scrollbar');
            horizontal.setAttribute('orientation', 'horizontal');
            vertical.setAttribute('orientation', 'vertical');
            this._bars = { horizontal, vertical };
            bindSlottedChildren(this, [{ into: this._viewport }]).install(this._viewport, vertical, horizontal);
            this.setAttribute('role', 'generic');
            // A bar is a VIEW of the viewport's adjustment, so the viewport's
            // `value-changed` is what moves the content and a bar's is what moves the
            // other one — GTK's two directions of one signal.
            this._viewport.addEventListener('value-changed', this._onViewportValue);
            for (const bar of [horizontal, vertical]) {
                bar.addEventListener('value-changed', this._onBarValue);
                // `indicator_set_over`: the pointer over an indicator widens it, which is
                // the `.hovering` class libadwaita paints the trough wash for.
                bar.addEventListener('pointerenter', this._onIndicatorOver);
                bar.addEventListener('pointerleave', this._onIndicatorOut);
            }
            // The adjustments are read from the DOM on demand, so nothing has to be
            // recomputed on resize — but a CONTENT that changed size is a resize of the
            // viewport, and a bar's visibility is a comparison of its numbers.
            this._observer = new ResizeObserver(() => this._sync());
            this._observer.observe(this._viewport);
            this._shading = new AdwScrollShading(this, {
                onOvershoot: (distance) => this._edgeOvershot(distance),
            });
            this._shading.connect();
        }
        // The media query is an OUTSIDE binding: released on the way out and
        // re-established on every way in, which is the shape
        // `scripts/check-adwaita-connect-rebind.mjs` holds every element to.
        this._releaseHoverable();
        this._hoverable = matchMedia('(hover: hover)');
        this._hoverable.addEventListener('change', this._onHoverableChange);
        this.addEventListener('keydown', this._onKeyDown);
        this._sync();
    }

    disconnectedCallback() {
        this.removeEventListener('keydown', this._onKeyDown);
        this._releaseHoverable();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._built || !this.isConnected) return;
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this._normalized(name, value) } }),
        );
        this._sync();
    }

    /** The NORMALISED value a notify carries, which is the property and not the raw attribute. */
    private _normalized(name: string, raw: string | null): unknown {
        switch (name) {
            case 'hscrollbar-policy':
                return normalizePolicy(raw);
            case 'vscrollbar-policy':
                return normalizePolicy(raw);
            case 'window-placement':
                return normalizeCorner(raw);
            case 'overlay-scrolling':
                return raw !== 'false';
            case 'has-frame':
                return raw !== null;
            case 'propagate-natural-width':
            case 'propagate-natural-height':
                return raw !== null;
            default:
                return sizeRequest(raw);
        }
    }

    private _writeSizeRequest(name: string, value: number | null): void {
        if (value === null) this.removeAttribute(name);
        else this.setAttribute(name, String(Math.max(0, Math.trunc(value))));
    }

    /**
     * `priv->use_indicators` — the AND of the property with the `gtk-overlay-scrolling`
     * setting, whose browser spelling is whether a pointer that can hover exists at all.
     */
    private get _useIndicators(): boolean {
        return this.overlayScrolling && (this._hoverable?.matches ?? true);
    }

    /** Everything the pspec's own state decides: the classes, the bars, the sizes. */
    private _sync(): void {
        const bars = this._bars;
        // A parent reaches its own children INSIDE `connectedCallback`, where the children's
        // callbacks have not run yet: custom element reactions unwind after the parent's. The
        // bars are not connected, so this pass has no adjustment to read and no geometry to
        // decide — `connectedCallback` ends with a `_sync()` of its own, once they are.
        if (bars === null || !this._viewport.isConnected || !bars.vertical.isConnected) return;
        const placement = this.windowPlacement;
        const indicators = this._useIndicators;
        this.classList.toggle('frame', this.hasFrame);
        // The corner is a class because the bars' PLACEMENT is a layout, and the grid
        // areas that place them are CSS (`_scrolled_window.scss`) the way GTK's allocation
        // is not.
        this.classList.toggle(placement, true);
        for (const corner of CORNERS) if (corner !== placement) this.classList.toggle(corner, false);
        this.classList.toggle('overlay-scrolling', indicators);
        // `gtk_scrolled_window_measure`'s four clamps, as the four CSS size requests they
        // are: an unwritten one (-1) sets nothing at all.
        this._writeSize('min-width', 'min-content-width');
        this._writeSize('min-height', 'min-content-height');
        this._writeSize('max-width', 'max-content-width');
        this._writeSize('max-height', 'max-content-height');
        for (const axis of AXES) {
            const bar = bars[axis.bar];
            const policy = normalizePolicy(this.getAttribute(axis.policy));
            const adjustment = this._adjustment(axis.key);
            // `update_scrollbar_visibility_flags`: AUTOMATIC decides from the adjustment,
            // ALWAYS and NEVER do not, and EXTERNAL is a bar this window does not draw.
            const visible =
                policy === 'always'
                    ? true
                    : policy === 'automatic'
                      ? adjustment.upper - adjustment.lower > adjustment.pageSize
                      : false;
            bar.hidden = !visible;
            // `setup_indicator`'s own class, which is what makes libadwaita's narrow
            // auto-hiding bar out of a permanent one.
            bar.classList.toggle('overlay-indicator', indicators);
            (bar as HTMLElement & { adjustment: AdwAdjustment }).adjustment = adjustment;
            // `gtk_scrolled_window_measure`'s request for the CHILD'S size, written on the
            // scrollport that has to ask its parent for it: `propagate-natural-*` is the
            // child's NATURAL size (`max-content`), a NEVER policy is its MINIMUM one
            // (`min-content`), and the natural is the larger of the two.
            this._viewport.style[axis.cssMin] = this.hasAttribute(axis.natural)
                ? 'max-content'
                : policy === 'never'
                  ? 'min-content'
                  : '';
        }
        if (!indicators) this._clearFade();
    }

    /**
     * One of the four clamps as inline style. An unwritten clamp clears only what THIS element
     * wrote: `min-width` / `min-height` are also where a tree's `width-request` /
     * `height-request` land (`GTK_WIDGET_SIZE_CSS`), and assigning '' unconditionally erased it.
     * Where both are set the content clamp wins, which is the one the widget measures itself.
     */
    private _writeSize(property: string, attribute: string): void {
        const size = sizeRequest(this.getAttribute(attribute));
        if (size !== null) this.style.setProperty(property, `${size}px`);
        else if (this._wroteSizes.has(property)) this.style.removeProperty(property);
        if (size !== null) this._wroteSizes.add(property);
        else this._wroteSizes.delete(property);
    }

    /** The viewport's adjustment for one axis, which is where GTK reads the scrollbar's. */
    private _adjustment(key: 'hadjustment' | 'vadjustment'): AdwAdjustment {
        return this._viewport[key];
    }

    /**
     * `may_hscroll` / `may_vscroll`: a bar that is DRAWN, or an EXTERNAL policy, which is a
     * scrollbar this window does not show but can still be driven with.
     */
    private _mayScroll(horizontal: boolean): HTMLElement | null {
        const bars = this._bars;
        if (bars === null) return null;
        const bar = horizontal ? bars.horizontal : bars.vertical;
        if (!bar.hidden) return bar;
        const policy = normalizePolicy(this.getAttribute(horizontal ? 'hscrollbar-policy' : 'vscrollbar-policy'));
        return policy === 'external' ? bar : null;
    }

    /**
     * The viewport moved: hand the position to the bars, ask whether an edge was REACHED
     * (`maybe_emit_edge_reached` fires whenever the adjustment lands exactly on `lower` or
     * `upper - page_size`, gtkscrolledwindow.c:3629-3661) and fade the indicators in.
     */
    private _onViewportValue = (event: Event): void => {
        const bars = this._bars;
        if (bars === null) return;
        const detail = (event as CustomEvent<{ hadjustment: AdwAdjustment; vadjustment: AdwAdjustment }>).detail;
        for (const axis of AXES) {
            const adjustment = detail[axis.key];
            (bars[axis.bar] as HTMLElement & { adjustment: AdwAdjustment }).adjustment = adjustment;
            const max = adjustment.upper - adjustment.pageSize;
            if (adjustment.value <= adjustment.lower) this._edgeReached(axis.end);
            else if (adjustment.value >= max) this._edgeReached(axis.farEnd);
        }
        this._fadeIn();
    };

    /**
     * A bar moved: move the scrollport. GTK's direction is the other way round — the
     * adjustment belongs to the scrollbar and the scrolled window reads it — which is why
     * the bar is given the adjustment here instead of owning it: the numbers are the same
     * either way, and one writer per side is what keeps them from fighting.
     */
    private _onBarValue = (event: Event): void => {
        const bar = event.currentTarget as HTMLElement;
        const adjustment = (event as CustomEvent<{ adjustment: AdwAdjustment }>).detail.adjustment;
        if (bar.hidden) return;
        // The scrollport's position IS the adjustment's value, so this is one clamped
        // assignment — `gtk_adjustment_set_value`'s own contract.
        this._viewport.scrollAxis(
            bar.getAttribute('orientation') === 'vertical' ? 'vertical' : 'horizontal',
            adjustment.value,
        );
    };

    private _edgeReached(edge: GtkPositionType): void {
        this.dispatchEvent(new CustomEvent('edge-reached', { bubbles: true, detail: { pos: edge } }));
    }

    /**
     * `_gtk_scrolled_window_set_adjustment_value`'s `EDGE_OVERSHOT`, from the shading
     * controller's unclamped position: negative is the near edge, positive the far one,
     * and `0` is the settled case the C returns without emitting — it is the value CLAMPED
     * to `lower - MAX_OVERSHOOT_DISTANCE` and `upper - page_size + MAX_OVERSHOOT_DISTANCE`
     * that the signal compares (gtkscrolledwindow.c:3306-3352).
     */
    private _edgeOvershot(distance: number): void {
        if (distance === 0) return;
        this.dispatchEvent(
            new CustomEvent('edge-overshot', { bubbles: true, detail: { pos: distance < 0 ? 'top' : 'bottom' } }),
        );
    }

    /** The keys of `gtk_scrolled_window_class_init`, and the two signals they emit. */
    private _onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Tab' && event.ctrlKey) {
            // `move_focus_out` re-emits `move-focus` on the ROOT and GTK's focus chain
            // takes it from there (gtkscrolledwindow.c:3055-3076). The browser's own Tab
            // IS that chain, so this is the signal and the event is left to run.
            const directionType: GtkDirectionType = event.shiftKey ? 'backward' : 'forward';
            this.dispatchEvent(new CustomEvent('move-focus-out', { bubbles: true, detail: { directionType } }));
            return;
        }
        const binding = resolveScrollKey(event);
        if (binding === null) return;
        const bar = this._mayScroll(binding.horizontal);
        if (bar === null) return;
        event.preventDefault();
        (bar as HTMLElement & { scrollBy(kind: GtkScrollType): void }).scrollBy(binding.scroll);
        // RUN_LAST: the class handler has already moved the adjustment by the time a
        // listener hears this, which is what an ACTION signal means.
        this.dispatchEvent(
            new CustomEvent('scroll-child', {
                bubbles: true,
                detail: { scroll: binding.scroll, horizontal: binding.horizontal },
            }),
        );
    };

    /**
     * `indicator_start_fade(indicator, 1.0)` on every value change, and
     * `maybe_hide_indicator`'s check `INDICATOR_FADE_OUT_DELAY` after the last one — a poll
     * upstream, one timer here, and `!indicator->over` is the `.hovering` class (a pointer
     * over the indicator holds it open).
     */
    private _fadeIn(): void {
        const bars = this._bars;
        if (bars === null || !this._useIndicators) return;
        for (const bar of [bars.horizontal, bars.vertical]) bar.style.setProperty('--adw-indicator-opacity', '1');
        if (this._fadeTimer !== null) clearTimeout(this._fadeTimer);
        this._fadeTimer = setTimeout(() => this._fadeOut(), INDICATOR_FADE_OUT_DELAY);
    }

    private _fadeOut(): void {
        this._fadeTimer = null;
        const bars = this._bars;
        if (bars === null || !this._useIndicators) return;
        for (const bar of [bars.horizontal, bars.vertical]) {
            if (bar.classList.contains('hovering')) continue;
            bar.style.setProperty('--adw-indicator-opacity', '0');
        }
    }

    private _clearFade(): void {
        if (this._fadeTimer !== null) clearTimeout(this._fadeTimer);
        this._fadeTimer = null;
        const bars = this._bars;
        if (bars === null) return;
        for (const bar of [bars.horizontal, bars.vertical]) bar.style.removeProperty('--adw-indicator-opacity');
    }

    private _onIndicatorOver = (event: Event): void => {
        const bar = event.currentTarget as HTMLElement;
        bar.classList.add('hovering');
        // An indicator the pointer is ON is never faded out, so a fade already standing is
        // replaced by the visible state and its timer by this one.
        this._fadeIn();
    };

    private _onIndicatorOut = (event: Event): void => {
        (event.currentTarget as HTMLElement).classList.remove('hovering');
    };

    private _onHoverableChange = (): void => {
        this._sync();
    };

    private _releaseHoverable(): void {
        this._hoverable?.removeEventListener('change', this._onHoverableChange);
        this._hoverable = null;
    }
}

customElements.define('gtk-scrolled-window', GtkScrolledWindow);
