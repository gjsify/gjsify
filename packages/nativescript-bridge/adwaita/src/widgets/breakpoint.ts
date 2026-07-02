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
export {
    AdwBreakpoint,
    evaluateBreakpointCondition,
    parseBreakpointCondition,
} from '@gjsify/adwaita-core';
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
 * Bind breakpoints to a view so they re-evaluate on every layout pass (the NS
 * stand-in for Adwaita's window-size signal): the view's `layoutChanged` event
 * drives {@link AdwBreakpoint.evaluate} with the post-layout DIP size, and a
 * `loaded` seed evaluates once the first size is known. Each breakpoint is
 * evaluated independently. Returns a dispose function that detaches the listeners.
 */
export function addBreakpoints(view: View, breakpoints: AdwBreakpoint[]): () => void {
    const recompute = (): void => {
        const size = measureView(view);
        if (!size) return;
        for (const bp of breakpoints) bp.evaluate(size);
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
