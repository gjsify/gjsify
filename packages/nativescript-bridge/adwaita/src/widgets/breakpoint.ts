// AdwBreakpoint — NativeScript binding for Libadwaita-style responsive breakpoints.
//
// The condition grammar/parser (`parseBreakpointCondition`), the evaluator and
// the transition-only `AdwBreakpoint` apply/unapply state machine are HEADLESS
// and live in `@gjsify/adwaita-core` (ADR 0004) — this module re-exports them
// unchanged (no consumer-visible move) and adds the one NativeScript-specific
// piece: {@link addBreakpoints}, binding breakpoints to a view's post-layout size.
//
// FIDELITY: Adwaita evaluates against the WINDOW content size in `sp` (scalable
// px). NS exposes no window-resize signal, so a breakpoint watches its bound
// view's POST-LAYOUT size (DIPs — the NS analog of `sp`) via the view's
// `layoutChanged` event, with an initial `loaded` seed. Adwaita apps lean on
// these to collapse split views, swap header layouts, or hide chrome on narrow
// widths — the missing piece that kept the NS storybook stuck in phone layout
// on a wide (tablet / desktop) screen.
//
// Type-only `@nativescript/core` import → this module loads and is unit-testable
// off-device (like row-press / color-scheme).

import type { View } from '@nativescript/core';
import type { AdwBreakpoint, BreakpointSize } from '@gjsify/adwaita-core';

// Re-export the headless surface so existing consumers keep importing it from
// `@gjsify/adwaita-nativescript` unchanged.
export { AdwBreakpoint, evaluateBreakpointCondition, parseBreakpointCondition } from '@gjsify/adwaita-core';
export type {
    AdwBreakpointHandlers,
    BreakpointBound,
    BreakpointConditionGroup,
    BreakpointConditionLeaf,
    BreakpointConditionNode,
    BreakpointDimension,
    BreakpointSize,
} from '@gjsify/adwaita-core';

/** The DIP size of a view post-layout, or null before it has been measured. */
function measureView(view: View): BreakpointSize | null {
    const size = view.getActualSize?.();
    if (size && size.width > 0 && size.height > 0) return { width: size.width, height: size.height };
    return null;
}

/**
 * The SIZE SOURCE both shapes share: the view's `layoutChanged` event reports its post-layout DIP
 * size to `onSize`, with a `loaded` seed and an immediate read if the view is already laid out.
 * Returns a dispose function that detaches the listeners.
 */
export function observeViewSize(view: View, onSize: (size: BreakpointSize) => void): () => void {
    const recompute = (): void => {
        const size = measureView(view);
        if (size) onSize(size);
    };
    view.addEventListener('layoutChanged', recompute);
    view.addEventListener('loaded', recompute);
    // If the view is already laid out (bound late), evaluate now.
    recompute();
    return () => {
        view.removeEventListener('layoutChanged', recompute);
        view.removeEventListener('loaded', recompute);
    };
}

/**
 * The size of the WINDOW the view sits in: its topmost ancestor, which is the page the window
 * shows. `Adw.Window` breakpoints evaluate against the window content, so a toolbar view that
 * the system bars squeeze (a 609 dp window leaves it 586 dp) must not decide `min-height: 600sp`.
 * Falls back to the view itself while it has no parent, as before it is attached.
 */
function measureWindow(view: View): BreakpointSize | null {
    let top: View = view;
    while (top.parent && typeof (top.parent as View).getActualSize === 'function') top = top.parent as View;
    return measureView(top) ?? measureView(view);
}

/**
 * The size source for a WINDOW breakpoint (a `breakpoints` tree field, ADR 0093): like
 * {@link observeViewSize}, but reads the window rather than the view, and re-reads when either
 * the view or the window root re-lays out.
 */
export function observeWindowSize(view: View, onSize: (size: BreakpointSize) => void): () => void {
    let root: View | null = null;
    const recompute = (): void => {
        let top: View = view;
        while (top.parent && typeof (top.parent as View).getActualSize === 'function') top = top.parent as View;
        if (top !== root) {
            root?.removeEventListener('layoutChanged', recompute);
            root = top === view ? null : top;
            root?.addEventListener('layoutChanged', recompute);
        }
        const size = measureWindow(view);
        if (size) onSize(size);
    };
    view.addEventListener('layoutChanged', recompute);
    view.addEventListener('loaded', recompute);
    recompute();
    return () => {
        view.removeEventListener('layoutChanged', recompute);
        view.removeEventListener('loaded', recompute);
        root?.removeEventListener('layoutChanged', recompute);
    };
}

/**
 * Bind breakpoints to a view so they re-evaluate on every layout pass (the NS
 * stand-in for Adwaita's window-size signal): the view's `layoutChanged` event
 * drives {@link AdwBreakpoint.evaluate} with the post-layout DIP size, and a
 * `loaded` seed evaluates once the first size is known. Each breakpoint is
 * evaluated independently. Returns a dispose function that detaches the listeners.
 */
export function addBreakpoints(view: View, breakpoints: AdwBreakpoint[]): () => void {
    return observeViewSize(view, (size) => {
        for (const bp of breakpoints) bp.evaluate(size);
    });
}
