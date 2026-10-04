// <gtk-scrollbar> — the trough-and-slider a `GtkScrolledWindow` draws on each edge it can
// scroll, and a widget in its own right (GTK ships one; a caller rarely builds one).
//
// IT IS A `GtkRange`, AND THE RANGE IS ITS CHILD, NOT ITS SIBLING. `GtkScrollbar` creates a
// `GtkRange` and parents it to itself (`gtkscrollbar.c:263-278`), so the CSS node is
//
//     scrollbar
//     ╰── range[.fine-tune]
//         ╰── trough
//             ╰── slider
//
// and the slider's GEOMETRY is `GtkRange`'s: `gtk_range_compute_slider_position` makes the
// slider `trough * page_size / (upper - lower)` long and places it at
// `(trough - slider) * (value - lower) / (upper - lower - page_size)` — two DIFFERENT
// denominators, which is why both are computed here rather than written as two
// percentages of one length. The `range` level has no element of its own here; the
// trough-and-slider pair is the two nodes below it, and `_scrollbar.scss` says so where
// the selectors are rewritten.
//
// `GtkScrollbar` has TWO properties: `adjustment` and `orientation`, the second being
// `GtkOrientable`'s defaulted to HORIZONTAL in `gtk_scrollbar_init` (gtkscrollbar.c:263-278).
// There is no adjustment of its own — unlike `GtkRange`, which makes one — and a NULL one is
// not a null range: `gtk_range_set_adjustment` SUBSTITUTES a zero adjustment
// (`gtk_adjustment_new (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)`, gtkrange.c:687-688), so a bare
// `<gtk-scrollbar>` is a bar over `upper == lower`, where `upper - lower == 0` makes
// `gtk_range_compute_slider_position` fall back to the slider's OWN measured size and put it
// at 0 (gtkrange.c:2779-2793) — a full-length thumb that cannot move. The widget stays
// SENSITIVE: nothing in gtkscrollbar.c, gtkrange.c or gtkscrolledwindow.c ever calls
// `gtk_widget_set_sensitive` on it, so there is no insensitivity to report. The adjustment
// is the portable value (ADR 0047), so a bar authored here is the one a
// `<gtk-scrolled-window>` drives and the one a NativeScript `GtkAdjustment` would carry.
//
// THE POINTER RULES ARE `GtkRange`'s AT THE SETTINGS DEFAULT THEY SHIP WITH:
// `gtk-primary-button-warps-slider` is TRUE (gtksettings.c:734-736), so a primary click in
// the trough WARPS the slider to the click — onto the slider's own CENTRE, since the
// slider's size is not fixed (gtkrange.c:2074-2096) — while a middle click, or Shift with
// a primary one, PAGES toward it (gtkrange.c:2097-2115). Shift turns the drag into a FINE
// adjustment: `update_zoom_state` adds `.fine-tune`, and `update_slider_position` then
// scales the pointer's travel by `min(1, trough / range)` — `0.25` where that factor would
// come out at 1, which is what a scale forces (gtkrange.c:2163-2177, 1793-1804).
//
// A11y: `role="scrollbar"` with `aria-valuemin` / `aria-valuemax` / `aria-valuenow` —
// `GTK_ACCESSIBLE_ROLE_SCROLLBAR` (gtkscrollbar.c:259) and the `GtkAccessibleRange` interface,
// whose three numbers are the adjustment's own: `upper - page_size`, `lower` and `value`,
// in that order (gtkscrollbar.c:309-313, 322-324).
//
// NOT PORTED: the autoscroll a SECONDARY click in the trough starts
// (gtkrange.c:2116-2132) is a repeating timer against the trough's edge, and a browser
// opens its context menu there. Mark snapping (`update_slider_position`'s loop over
// `n_marks`) belongs to `GtkScale`, which is where marks are declared.
//
// Reference: refs/gtk/gtk/gtkscrollbar.c (init, class_init, the CSS node diagram)
// Reference: refs/gtk/gtk/gtkrange.c (compute_slider_position, coord_to_value,
//   click_gesture_pressed, update_zoom_state, update_slider_position)
// Reference: refs/libadwaita/src/stylesheet/widgets/_scrolling.scss:1-138 (scrollbar, range,
//   trough, slider and the .fine-tune variant)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    clampAdjustmentValue,
    normalizeAdjustment,
    normalizeBoxOrientation,
    parseAdjustment,
    type AdwAdjustment,
    type AdwAdjustmentInput,
    type BoxOrientation,
} from '@gjsify/adwaita-core';

/** The two nodes below GTK's `range` level, spelled as GTK spells them. */
const TROUGH_CLASS = 'adw-scrollbar-trough';
const SLIDER_CLASS = 'adw-scrollbar-slider';

/**
 * The zoom factor `update_slider_position` falls back to when the measured one comes out
 * at 1.0 — a scale's, where the trough is longer than the range it slides over.
 */
const ZOOM_FALLBACK = 0.25;

/**
 * One wheel detent, in CSS pixels.
 *
 * `GtkScrollbar`'s own doc answers the wheel question in units of the adjustment
 * ("`page-increment` … when the user asks to move by a page"), and `scroll_delta_to_value`
 * multiplies a WHEEL delta — which GDK reports PER DETENT — by that page increment
 * (gtkrange.c:1889-1896). Firefox reports three LINES per detent and Chrome about a
 * hundred pixels, so both are converted with the convention `src/scroll-shading.ts`
 * already states.
 */
const LINES_PER_DETENT = 3;
const PIXELS_PER_LINE = 16;

/** `GtkScrollType`'s six kinds, which is what a `scroll-child` names. */
export type GtkScrollType = 'step-backward' | 'step-forward' | 'page-backward' | 'page-forward' | 'start' | 'end';

/**
 * `gtk_range_set_adjustment`'s substitute for a NULL adjustment — `gtk_adjustment_new (0.0,
 * 0.0, 0.0, 0.0, 0.0, 0.0)` (gtkrange.c:687-688), the six numbers in `gtk_adjustment_new`'s
 * own order (value, lower, upper, step, page, page_size).
 *
 * `upper == lower` is the state every scrollbar starts in and the one `upper - lower == 0`
 * in `gtk_range_compute_slider_position` answers with the slider's own size at position 0
 * (gtkrange.c:2779-2793). Frozen: it is the same object for every bar that has no
 * adjustment, and nothing writes to it.
 */
const ZERO_ADJUSTMENT: AdwAdjustment = Object.freeze({
    value: 0,
    lower: 0,
    upper: 0,
    stepIncrement: 0,
    pageIncrement: 0,
    pageSize: 0,
});

export class GtkScrollbar extends HTMLElement {
    private _trough!: HTMLElement;
    private _slider!: HTMLElement;
    private _observer: ResizeObserver | null = null;
    private _built = false;
    private _adjustment: AdwAdjustment | null = null;
    /** `priv->slide_initial_slider_position` — the slider's position when the drag began. */
    private _grabPosition = 0;
    /** `priv->slide_initial_coordinate_delta` — how far into the slider the pointer was. */
    private _grabDelta = 0;
    /** `priv->zoom` — the fine adjustment, `.fine-tune` and all. */
    private _zoom = false;
    private _dragging = false;

    static get observedAttributes() {
        return ['orientation', 'adjustment'];
    }

    /** `GtkOrientable:orientation` — HORIZONTAL in `gtk_scrollbar_init`; unknown is that. */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    /**
     * `GtkScrollbar:adjustment` — the range this bar moves, as the portable value.
     *
     * NEVER `null`, which is the half of this property that is easy to get wrong: GTK's
     * pspec default is NULL, but `gtk_range_set_adjustment` answers a NULL with the ZERO
     * adjustment (gtkrange.c:687-688) and `gtk_range_get_adjustment` creates it on demand
     * (gtkrange.c:658-659), so a bare `GtkScrollbar` reads back a real adjustment whose
     * `upper` is 0. A read that could return null would be a property GTK's own does not
     * have, and the slider geometry would have to carry a second "nothing here" case.
     *
     * A string is read as the JSON the attribute carries, so the property and the
     * attribute are one write; a partial object MERGES, which is
     * `gtk_adjustment_configure`'s own contract (gtkadjustment.c). Assigning `null` is
     * `gtk_scrollbar_set_adjustment (self, NULL)`: the zero adjustment again, and the
     * property is assigned rather than merged.
     */
    get adjustment(): AdwAdjustment {
        return this._adjustment ?? ZERO_ADJUSTMENT;
    }

    set adjustment(value: AdwAdjustmentInput | string | null) {
        const input =
            value === null || value === undefined ? null : typeof value === 'string' ? parseAdjustment(value) : value;
        this._adjustment = input === null ? null : normalizeAdjustment(input, this._adjustment ?? undefined);
        // A widget CONSTRUCTED writes properties without notifying (GObject has no observers
        // yet), and this element is built inside `connectedCallback`, where a parent's own
        // callback can reach a child whose callback has not run — the custom element reaction
        // queue unwinds AFTER the parent's. So the value is taken and the render waits for the
        // trough that `connectedCallback` is about to build.
        if (!this._built) return;
        this._render();
        this._notify('adjustment', { adjustment: this.adjustment });
    }

    /** The position, which is the adjustment's own value (gtkrange.c:1168-1176). */
    get value(): number {
        return this.adjustment.value;
    }

    /**
     * `gtk_adjustment_set_value`: move the range, clamped, and announce it.
     *
     * A scrollbar is a VIEW of an adjustment it does not own, so the `value-changed`
     * CustomEvent (bubbles, detail `{ adjustment }`) stands for `GtkAdjustment`'s signal —
     * and `<gtk-scrolled-window>` is what listens, exactly as GTK reads the adjustment off
     * the scrollbar it owns (`gtk_scrolled_window_scroll_child`, gtkscrolledwindow.c:3007).
     *
     * Over the zero adjustment `set_value` CLAMPS to 0 and reports no change, so a bar with
     * no adjustment of its own is inert without being a special case anywhere.
     */
    set value(value: number) {
        const adjustment = this._adjustment;
        if (adjustment === null) return;
        const next = clampAdjustmentValue(adjustment, value);
        if (next === adjustment.value) return;
        this._adjustment = { ...adjustment, value: next };
        this._render();
        this.dispatchEvent(
            new CustomEvent('value-changed', { bubbles: true, detail: { adjustment: this._adjustment } }),
        );
    }

    /**
     * The value one `GtkScrollType` moves by, which is `gtk_scrolled_window_scroll_child`'s
     * switch.
     *
     * `scrollBy` is a platform method with a delta form, so both are here and the KIND of the
     * argument decides — a `GtkScrollType` nick moves the adjustment, a number or a
     * `ScrollToOptions` is the scrollport's own call, which a bar has none of (it is not a
     * scrollport) and which therefore lands on no adjustment and does nothing.
     */
    scrollBy(kind: GtkScrollType): void;
    scrollBy(options?: ScrollToOptions): void;
    scrollBy(x: number, y: number): void;
    scrollBy(kind?: GtkScrollType | ScrollToOptions | number): void {
        if (typeof kind !== 'string') return;
        const adjustment = this.adjustment;
        switch (kind) {
            case 'step-forward':
                this.value = adjustment.value + adjustment.stepIncrement;
                break;
            case 'step-backward':
                this.value = adjustment.value - adjustment.stepIncrement;
                break;
            case 'page-forward':
                this.value = adjustment.value + adjustment.pageIncrement;
                break;
            case 'page-backward':
                this.value = adjustment.value - adjustment.pageIncrement;
                break;
            case 'start':
                this.value = adjustment.lower;
                break;
            case 'end':
                // `gtk_scrolled_window_scroll_child` sets `value = upper` and lets
                // `gtk_adjustment_set_value` clamp it (gtkscrolledwindow.c:3029-3031,
                // gtkadjustment.c:549-555) — which for a scrollbar's range is
                // `upper - page_size`, the position the thumb can actually reach.
                this.value = adjustment.upper;
                break;
        }
    }

    /** How far a wheel detent moves the value: `scroll_delta_to_value` on a WHEEL unit. */
    scrollByWheel(deltaY: number, deltaMode: number): void {
        const perDetent = deltaMode === 1 ? PIXELS_PER_LINE * LINES_PER_DETENT : 100;
        const detents = perDetent === 0 ? 0 : deltaY / perDetent;
        this.scrollBy(detents >= 0 ? 'page-forward' : 'page-backward');
    }

    /**
     * `gtk_range_get_range_area`-ish: the length of the trough, which is what the slider
     * is a fraction of. Read on demand so a caller can scale with the same numbers.
     */
    private get _troughLength(): number {
        return this.orientation === 'vertical' ? this._trough.clientHeight : this._trough.clientWidth;
    }

    connectedCallback() {
        if (!this._built) {
            this._built = true;
            this._trough = document.createElement('div');
            this._trough.className = TROUGH_CLASS;
            this._slider = document.createElement('div');
            this._slider.className = SLIDER_CLASS;
            this._trough.appendChild(this._slider);
            this.replaceChildren(this._trough);
            // On the BAR, not the trough: `gtk_range_click_gesture_pressed` picks the widget
            // under the pointer and folds everything that is not the slider into the trough
            // (gtkrange.c:2052-2058), and libadwaita gives the trough a 9px margin — so the
            // bar's own margin is trough as far as GTK is concerned and a click there warps
            // the slider like any other.
            this.addEventListener('pointerdown', this._onPointerDown);
            this.addEventListener('keydown', this._onKeyDown);
            this.addEventListener('wheel', this._onWheel, { passive: true });
            // An ARIA scrollbar is operable, and `GtkRange` answers keys on the widget's
            // own focus — so it takes a place in the tab order, as GTK's focus chain puts
            // it there. No `disconnectedCallback`: the drag listeners live on this element
            // and die with it, and a pointer capture is released by the platform when the
            // captured node leaves the document.
            this.tabIndex = 0;
            // The slider is a FRACTION of the trough, so it needs the trough's length,
            // which any resize of the trough or of the window changes. An observer on a
            // node this element owns, so it dies with it.
            this._observer = new ResizeObserver(() => this._render());
            this._observer.observe(this._trough);
            this.setAttribute('role', 'scrollbar');
        }
        if (this.hasAttribute('adjustment')) this.adjustment = this.getAttribute('adjustment');
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._built || !this.isConnected) return;
        if (name === 'adjustment') {
            this.adjustment = value;
            return;
        }
        this._notify('orientation', { orientation: this.orientation });
        this._render();
    }

    private _notify(property: string, detail: Record<string, unknown>): void {
        this.dispatchEvent(new CustomEvent(`notify::${property}`, { bubbles: true, detail }));
    }

    /**
     * The trough's three rules and the slider's drag, at the settings default
     * (`gtk_range_click_gesture_pressed`, gtkrange.c:2018-2138).
     */
    private _onPointerDown = (event: PointerEvent): void => {
        if (!this.hasAttribute('tabindex')) return;
        // `gtk_range_click_gesture_pressed` grabs the focus first and works on whatever
        // adjustment the range holds (gtkrange.c:2036-2037), so a bar with none is still
        // operable — every move it makes clamps back to 0.
        this.focus();
        const coord = this._coordinate(event);
        // `gtk_range_click_gesture_pressed` treats anything outside the slider as the
        // trough (gtkrange.c:2052-2058), and Shift inside the slider is the fine
        // adjustment.
        const onSlider = event.target === this._slider;
        this._grabPosition = this._sliderPosition();
        this._grabDelta = coord - this._grabPosition;
        this._setZoom(onSlider && event.shiftKey);
        this._dragging = onSlider;
        this._capture(event.pointerId);
        this.addEventListener('pointermove', this._onPointerMove);
        this.addEventListener('pointerup', this._onPointerEnd);
        this.addEventListener('pointercancel', this._onPointerEnd);
        if (onSlider) return;
        // Shift with the primary button, or the middle one, pages; a primary button on its
        // own warps, because `gtk-primary-button-warps-slider` defaults TRUE.
        if (event.button === 0 && !event.shiftKey) {
            this.value = this._coordinateValue(coord + this._sliderSize() / 2);
        } else if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
            this.scrollBy(this._coordinateValue(coord) > this.value ? 'page-forward' : 'page-backward');
        }
    };

    /**
     * `update_slider_position`: the pointer's travel since the grab, scaled by the zoom,
     * added to where the slider WAS — so the slider keeps the offset it was grabbed at.
     */
    private _onPointerMove = (event: PointerEvent): void => {
        if (!this._dragging) return;
        // Shift anywhere in a drag is the fine adjustment (gtkrange.c:1953-1970).
        this._setZoom(event.shiftKey);
        const coord = this._coordinate(event);
        const zoom = this._zoom ? this._zoomFactor() : 1;
        this.value = this._coordinateValue(
            this._grabPosition + zoom * (coord - (this._grabDelta + this._grabPosition)),
        );
    };

    private _onPointerEnd = (event: PointerEvent): void => {
        this._endDrag(event.pointerId);
    };

    private _endDrag(pointerId?: number): void {
        this._dragging = false;
        this._setZoom(false);
        if (pointerId !== undefined && this.hasPointerCapture(pointerId)) {
            this.releasePointerCapture(pointerId);
        }
        this.removeEventListener('pointermove', this._onPointerMove);
        this.removeEventListener('pointerup', this._onPointerEnd);
        this.removeEventListener('pointercancel', this._onPointerEnd);
    }

    /**
     * Keep the gesture alive past the bar's own edges, which is what `GtkGestureDrag` does
     * upstream for as long as the button is held.
     *
     * `setPointerCapture` THROWS for a pointer id the platform is no longer tracking, and an
     * exception here would abort the gesture before the warp or the page that follows it —
     * which is not a state a scrollbar can be in. So a refused capture is a drag that ends at
     * the bar's edge, and the synchronous move still happens.
     */
    private _capture(pointerId: number): void {
        try {
            this.setPointerCapture(pointerId);
        } catch {
            // No capture: the pointermove listener below is on this element anyway, so a
            // drag inside the bar is unaffected.
        }
    }

    /** The keys `GtkScrollbar`'s own doc names: the arrow keys step, Page Up/Down page. */
    private _onKeyDown = (event: KeyboardEvent): void => {
        const vertical = this.orientation === 'vertical';
        const kind = resolveRangeKey(event, vertical);
        if (kind === null) return;
        event.preventDefault();
        this.scrollBy(kind);
    };

    private _onWheel = (event: WheelEvent): void => {
        // `GtkScrollbar` is inside a scrolled window that scrolls on the wheel already, so
        // this only claims the event when the bar itself is the target — GTK's own
        // GtkScrollbar is not a scroll event target either.
        if (event.target !== this && event.target !== this._trough) return;
        this.scrollByWheel(event.deltaY, event.deltaMode);
    };

    private _setZoom(enabled: boolean): void {
        if (this._zoom === enabled) return;
        this._zoom = enabled;
        // `update_zoom_state` puts the class on the RANGE; here the scrollbar IS the node
        // the class reaches, which is what libadwaita's `range.fine-tune` selector wants.
        this.classList.toggle('fine-tune', enabled);
    }

    /** `update_slider_position`'s zoom: the trough per unit of range, or the fallback. */
    private _zoomFactor(): number {
        const adjustment = this.adjustment;
        const range = adjustment.upper - adjustment.lower - adjustment.pageSize;
        const measured = range <= 0 ? 1 : Math.min(1, this._troughLength / range);
        return measured === 1 ? ZOOM_FALLBACK : measured;
    }

    /**
     * `gtk_range_compute_slider_position`, in CSS pixels.
     *
     * The slider's length is a fraction of the WHOLE adjustment range and its position a
     * fraction of the SCROLLABLE one, which is why the two denominators differ and why
     * neither is a plain percentage of the trough. A range with nothing to scroll is the
     * `trough_length == slider_length` case upstream and answers 1.0.
     */
    private _render(): void {
        if (!this._built) return;
        const adjustment = this.adjustment;
        const vertical = this.orientation === 'vertical';
        this.classList.toggle('vertical', vertical);
        this.classList.toggle('horizontal', !vertical);
        this.setAttribute('aria-orientation', this.orientation);
        // There is NO insensitivity to report: nothing in gtkscrollbar.c, gtkrange.c or
        // gtkscrolledwindow.c calls `gtk_widget_set_sensitive` on a bar, so the `aria-disabled`
        // and `disabled` this element used to set for a NULL adjustment were a state GTK never
        // has. What the C publishes is the accessible RANGE, so that is all this writes.
        this.removeAttribute('aria-disabled');
        this.removeAttribute('disabled');
        const trough = this._troughLength;
        const total = adjustment.upper - adjustment.lower;
        const scrollable = total - adjustment.pageSize;
        // `upper - lower != 0` is the condition the C guards its fraction with
        // (gtkrange.c:2779-2782, 2814-2817); without it the slider takes its OWN measured
        // size, which for a libadwaita slider is the `$_slider_min_length` floor its own
        // stylesheet sets. Writing no length at all is therefore the faithful answer — the
        // stylesheet's `max (…, $_slider_min_length)` then IS that measured size.
        if (total === 0) {
            this._slider.style.removeProperty('--adw-scrollbar-size');
        } else {
            const size = Math.min(trough, trough * (adjustment.pageSize / total));
            this._slider.style.setProperty('--adw-scrollbar-size', `${size}px`);
        }
        const size = this._sliderSize();
        const free = Math.max(0, trough - size);
        // `upper - lower - page_size != 0` is the C's own condition for the POSITION
        // (gtkrange.c:2790-2793), so an unscrollable range puts the slider at the start.
        const position = scrollable === 0 ? 0 : free * ((adjustment.value - adjustment.lower) / scrollable);
        this.setAttribute('aria-valuemin', String(adjustment.lower));
        this.setAttribute('aria-valuemax', String(adjustment.upper - adjustment.pageSize));
        this.setAttribute('aria-valuenow', String(adjustment.value));
        this._slider.style.setProperty('--adw-scrollbar-position', `${position}px`);
    }

    /** Where the slider's START is along the trough, in pixels. */
    private _sliderPosition(): number {
        return Number.parseFloat(this._slider.style.getPropertyValue('--adw-scrollbar-position')) || 0;
    }

    /** The slider's own length, in pixels, from the last layout. */
    private _sliderSize(): number {
        return Number.parseFloat(this._slider.style.getPropertyValue('--adw-scrollbar-size')) || 0;
    }

    /**
     * `coord_to_value` (gtkrange.c:1842-1886): a coordinate along the trough scaled by the
     * FREE space — the trough less the slider — because the slider's centre has to reach
     * both ends and not one of them twice over.
     */
    private _coordinateValue(coord: number): number {
        const adjustment = this.adjustment;
        const free = Math.max(1, this._troughLength - this._sliderSize());
        const frac = Math.min(1, Math.max(0, coord / free));
        return adjustment.lower + frac * (adjustment.upper - adjustment.pageSize - adjustment.lower);
    }

    /** The pointer's coordinate along the trough, from the trough's own box. */
    private _coordinate(event: PointerEvent): number {
        const box = this._trough.getBoundingClientRect();
        return this.orientation === 'vertical' ? event.clientY - box.top : event.clientX - box.left;
    }
}

/**
 * The keys `GtkRange` answers, which are the ones `GtkScrollbar`'s own doc names: the
 * arrows STEP, Page Up/Down PAGE, Home/End jump to the ends.
 *
 * An arrow on the OTHER axis is not a scrollbar key — GTK's GtkRange has no key bindings
 * of its own beyond what `GtkScale` and `GtkScrollbar` document, and letting a vertical
 * bar react to Left would answer a question nobody asked.
 */
function resolveRangeKey(event: KeyboardEvent, vertical: boolean): GtkScrollType | null {
    switch (event.key) {
        case 'ArrowRight':
            return vertical ? null : 'step-forward';
        case 'ArrowLeft':
            return vertical ? null : 'step-backward';
        case 'ArrowDown':
            return vertical ? 'step-forward' : null;
        case 'ArrowUp':
            return vertical ? 'step-backward' : null;
        case 'PageDown':
            return 'page-forward';
        case 'PageUp':
            return 'page-backward';
        case 'Home':
            return 'start';
        case 'End':
            return 'end';
        default:
            return null;
    }
}

customElements.define('gtk-scrollbar', GtkScrollbar);
