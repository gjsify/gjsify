// <gtk-viewport> — a window onto a child too large to show whole: GTK's answer for a
// widget that does not know how to scroll itself.
//
// WHAT IT IS, in GTK's own words: "Implements scrollability for widgets that don't support
// scrolling on their own" (gtkviewport.c:40-41). It has ONE property of its own
// (`scroll-to-focus`) and takes its two adjustments from `Gtk.Scrollable`, the interface
// every scroller in a `GtkScrolledWindow` is addressed through. This element is therefore
// the CONTENT HALF of `<gtk-scrolled-window>`, exactly as it is in GTK: setting a
// non-scrollable child on a scrolled window makes the window "add the child to a
// Gtk.Viewport and then set the viewport as the child" (gtkscrolledwindow.c:785-793).
//
// THE ADJUSTMENTS ARE GTK'S ARITHMETIC, VERBATIM. `viewport_set_adjustment_values`
// (gtkviewport.c:577-610) configures each axis as
//
//     configure(value, lower: 0, upper: child_size, step: viewport_size * 0.1,
//               page: viewport_size * 0.9, page_size: viewport_size)
//
// so a step is a tenth of the window and a page nine tenths of it — which is why a
// GtkViewport under the mouse wheel moves by the same PROPORTION whatever it wraps. In a
// browser those six numbers are what the scrollport already knows: `scrollLeft` /
// `scrollTop` are the value, `scrollWidth` / `scrollHeight` the upper and `clientWidth` /
// `clientHeight` the page size. The port READS them; it does not recompute a layout GTK
// negotiated itself. The two are one element HERE for the same reason they are two nodes
// there: the `viewport` node is the box that clips and the one that is measured, and a
// browser scrollport is both at once.
//
// THE CHILD IS ALLOCATED ITS NATURAL SIZE, never shrunk — GTK measures the child and hands
// it that (gtkviewport.c:129-160), so content wider than the window makes the window scroll
// sideways instead of being squeezed into it. The CSS spelling of "never shrink it" is
// `flex: none` on the child of a flex scrollport, which is in `_viewport.scss`; a child that
// shrinks instead reports its minimum as its size, which is the one thing a viewport exists
// to avoid.
//
// `scroll-to-focus` is the other property, and it is `gtk_viewport_scroll_to` driven by
// `notify::focus-widget`: when the focus widget changes, the viewport moves its adjustment
// so the focused widget is inside the window (gtkviewport.c:274-292, 620-645). A `focusin`
// on the host is the same reach — it fires for every focus change inside this subtree and
// nowhere else, which is also the `FOCUS_WITHIN` test the C applies first
// (gtkviewport.c:625). `scrollIntoView` then replaces `gtk_scroll_info_compute_scroll` and
// the two animated `set_value` calls.
//
// NO SLOT BINDING, deliberately. The element HAS no internal structure: a child's place is
// the child list, so there is nothing to route it into, and `bindSlottedChildren` exists for
// the elements that built a box around their content. `<gtk-scrolled-window>`'s own binding
// targets THIS element, so the child's placement is one hop from the widget the author wrote
// it in.
//
// A11y: GTK gave the widget the role `GTK_ACCESSIBLE_ROLE_GENERIC` in 4.12
// (gtkviewport.c:63-66), so the element carries `role="generic"` and nothing else: what is
// inside the window is what a screen reader announces.
//
// NOT PORTED: `hscroll-policy` / `vscroll-policy` (`GtkScrollable`'s enum) choose whether
// `upper` is the child's MINIMUM size or its NATURAL size — a size negotiation over a
// protocol this layout does not run, since a browser scrollport has exactly one content
// size. `hadjustment` / `vadjustment` are read-only properties here for the same reason
// `GtkViewport` keeps configuring them: it OWNS them (gtkviewport.c:601-610).
//
// Reference: refs/gtk/gtk/gtkviewport.c (size_allocate, viewport_set_adjustment_values,
//   scroll_to_focus, focus_change_handler, scroll_to)
// Reference: refs/gtk/gtk/gtkscrolledwindow.c:785-793 (a non-scrollable child is wrapped)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { clampAdjustmentValue, normalizeAdjustment, type AdwAdjustment } from '@gjsify/adwaita-core';

/** `viewport_set_adjustment_values`'s two fractions of the visible size. */
const STEP_FRACTION = 0.1;
const PAGE_FRACTION = 0.9;

/** The two axes a scrollport reports numbers for, in the order GTK declares them. */
const AXES = ['horizontal', 'vertical'] as const;
type Axis = (typeof AXES)[number];

/** The adjustment of a scrollport on one axis — GTK's configure, read off the DOM. */
function axisAdjustment(clip: HTMLElement, axis: Axis): AdwAdjustment {
    const vertical = axis === 'vertical';
    const viewportSize = vertical ? clip.clientHeight : clip.clientWidth;
    const contentSize = vertical ? clip.scrollHeight : clip.scrollWidth;
    const value = vertical ? clip.scrollTop : clip.scrollLeft;
    return normalizeAdjustment({
        value,
        lower: 0,
        // GTK holds `upper` at the child size and lets `set_value`'s clamp deal with a
        // content smaller than the window; `normalizeAdjustment` wants `upper >= lower`,
        // so the larger of the two is what the range is written with.
        upper: Math.max(contentSize, viewportSize),
        stepIncrement: viewportSize * STEP_FRACTION,
        pageIncrement: viewportSize * PAGE_FRACTION,
        pageSize: viewportSize,
    });
}

export class GtkViewport extends HTMLElement {
    private _observer: ResizeObserver | null = null;
    private _watch: MutationObserver | null = null;

    static get observedAttributes() {
        return ['scroll-to-focus'];
    }

    /**
     * `GtkScrollable:hadjustment` — the horizontal position, as the portable value.
     *
     * Computed on read rather than stored: `viewport_set_adjustment_values` reconfigures both
     * axes on every allocation, so there is no state to cache and nothing an author can write.
     */
    get hadjustment(): AdwAdjustment {
        return axisAdjustment(this, 'horizontal');
    }

    /** `GtkScrollable:vadjustment` — the vertical position, as the portable value. */
    get vadjustment(): AdwAdjustment {
        return axisAdjustment(this, 'vertical');
    }

    /**
     * `GtkViewport:scroll-to-focus` — whether the viewport keeps the focus widget in view.
     * TRUE in the pspec (gtkviewport.c:450), and an unknown value is the DEFAULT rather than
     * "off": only the literal `false` turns it off, which is what FALSE in a construct bag
     * means and what a boolean attribute has to spell out to be read at all.
     */
    get scrollToFocus(): boolean {
        return this.getAttribute('scroll-to-focus') !== 'false';
    }

    set scrollToFocus(value: boolean) {
        this.setAttribute('scroll-to-focus', value ? 'true' : 'false');
    }

    connectedCallback() {
        this.setAttribute('role', 'generic');
        // `scroll` does not bubble, so the platform's own is heard here, on the node that
        // raised it, and re-announced as GTK's `GtkAdjustment::value-changed`.
        this.addEventListener('scroll', this._announce, { passive: true });
        this._observe();
        this._bindFocus();
    }

    disconnectedCallback() {
        this.removeEventListener('scroll', this._announce);
        this.removeEventListener('focusin', this._onFocusIn);
    }

    /**
     * Announce whenever a number the adjustments are made of has changed.
     *
     * GTK reconfigures both axes on every allocation — `viewport_set_adjustment_values` runs
     * out of `size_allocate`, and `gtk_adjustment_configure` compresses the notifications into
     * one. A browser reports the same event as the scrollport's own box changing (this
     * element) and its CONTENT changing (the children), and neither is the other's: a child
     * that grows leaves the viewport's box exactly where it was, which is why BOTH are watched.
     * The content watcher is what makes a scrolled window's bars appear the moment content
     * lands in it, and it is `gtk_widget_queue_resize` on the child propagating upward.
     */
    private _observe(): void {
        if (this._observer !== null) return;
        this._observer = new ResizeObserver(() => this._announce());
        this._observer.observe(this);
        for (const child of this.children) this._observer.observe(child);
        // A child added or removed is a size to watch; `observe` is idempotent, so the ones
        // already watched are simply named again.
        this._watch = new MutationObserver(() => {
            for (const child of this.children) this._observer?.observe(child);
            this._announce();
        });
        this._watch.observe(this, { childList: true });
    }

    attributeChangedCallback(name: string) {
        // The handler's own registration depends on the value, so a change re-binds it — the
        // shape `scripts/check-adwaita-connect-rebind.mjs` accepts. GTK notifies here too
        // (gtkviewport.c:616), and a property notify is the whole of that call.
        this.dispatchEvent(
            new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: this.scrollToFocus } }),
        );
        if (!this.isConnected) return;
        this._bindFocus();
    }

    /**
     * `gtk_adjustment_set_value` on one of the viewport's OWN adjustments — the half of a
     * scrolled window's job that moves content rather than deciding whether to.
     *
     * The value is clamped first, which is `set_value`'s documented behaviour ("The value is
     * clamped to lie between lower and upper") and the reason a bar may ask for a position its
     * own range has just outgrown.
     */
    scrollAxis(axis: Axis, value: number): void {
        const adjustment = axisAdjustment(this, axis);
        const next = clampAdjustmentValue(adjustment, value);
        if (next === adjustment.value) return;
        if (axis === 'vertical') this.scrollTop = next;
        else this.scrollLeft = next;
        this._announce();
    }

    /**
     * `gtk_viewport_scroll_to` — move the position so `descendant` is inside the window.
     * `null` asks only for the position to be CLAMPED, which is what a content that shrank
     * needs from a value that was legal a moment ago.
     *
     * GTK animates the move (`gtk_adjustment_animate_to_value`, gtkviewport.c:637-638) for
     * `ANIMATION_DURATION` unless the widget should not animate — the browser's spelling of
     * that setting is `prefers-reduced-motion`, and `scrollIntoView`'s own `behavior` is where
     * the choice belongs.
     *
     * `scrollTo` IS a platform method with an options form, so both are here and the KIND of
     * the argument decides: a node is GTK's `scroll_to(descendant)` and anything else is the
     * scrollport's own `scrollTo(options)`, which this element is (one element for the two
     * GTK nodes is the port's own decision, see the header).
     */
    scrollTo(descendant: Element | null): void;
    scrollTo(options?: ScrollToOptions): void;
    scrollTo(x: number, y: number): void;
    scrollTo(descendantOrOptions?: Element | ScrollToOptions | number | null, y?: number): void {
        if (!(descendantOrOptions instanceof Element) && descendantOrOptions !== null) {
            Element.prototype.scrollTo.call(this, descendantOrOptions as ScrollToOptions | undefined, y);
            return;
        }
        const descendant = descendantOrOptions;
        if (
            descendant !== null &&
            descendant !== this &&
            typeof (descendant as HTMLElement).scrollIntoView === 'function'
        ) {
            (descendant as HTMLElement).scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            });
            this._announce();
            return;
        }
        for (const axis of AXES) {
            const adjustment = axisAdjustment(this, axis);
            const clamped = clampAdjustmentValue(adjustment, adjustment.value);
            if (clamped === adjustment.value) continue;
            if (axis === 'vertical') this.scrollTop = clamped;
            else this.scrollLeft = clamped;
        }
        this._announce();
    }

    /** The adjustments of both axes, as the detail of the `value-changed` event. */
    get adjustments(): { hadjustment: AdwAdjustment; vadjustment: AdwAdjustment } {
        return { hadjustment: this.hadjustment, vadjustment: this.vadjustment };
    }

    /**
     * One event for both adjustments: a browser scroll moves them together, and the C's
     * `GtkAdjustment::value-changed` is a signal of the ADJUSTMENT rather than of the viewport
     * that reads it. Bubbling, so `<gtk-scrolled-window>` hears it without holding a reference
     * to anything in here.
     */
    private _announce = (): void => {
        this.dispatchEvent(new CustomEvent('value-changed', { bubbles: true, detail: this.adjustments }));
    };

    /** `setup_focus_change_handler` / `clear_focus_change_handler`, on one event instead of a root signal. */
    private _bindFocus(): void {
        this.removeEventListener('focusin', this._onFocusIn);
        if (!this.scrollToFocus) return;
        this.addEventListener('focusin', this._onFocusIn);
    }

    private _onFocusIn = (event: Event): void => {
        const target = event.target;
        // The event came from inside, which is the C's `FOCUS_WITHIN` test; a target that is
        // the host itself is the viewport taking focus, not a widget to reveal.
        if (!(target instanceof Element) || target === this) return;
        this.scrollTo(target);
    };
}

customElements.define('gtk-viewport', GtkViewport);
