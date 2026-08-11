// Breakpoint binding for the browser renderer.
//
// The condition grammar, the evaluator and the transition-only apply/unapply
// state machine are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004).
// What each renderer must supply is the SIZE SOURCE: GTK has
// `Adw.Window::notify::default-width`, NativeScript has a view's `layoutChanged`
// (`addBreakpoints` in `@gjsify/adwaita-nativescript`), and the browser has
// `ResizeObserver` — which this module supplies under the same name, so the two
// ports read alike.
//
// Without a size source `<adw-navigation-split-view collapsed>` is a manual attribute the
// application has to flip itself, and markup that adapts on GTK and on NativeScript stays
// frozen in one layout in the browser.
//
// Reference: refs/libadwaita/src/adw-breakpoint.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwBreakpoint } from '@gjsify/adwaita-core';

/**
 * Drive `breakpoints` from `element`'s own box, and return a dispose function.
 *
 * `ResizeObserver` delivers an initial observation on `observe()`, so the breakpoints
 * settle on the correct state before first paint — no flash of the wrong layout, no
 * separate seeding pass. The size read is the BORDER box in CSS pixels, the browser's
 * counterpart to the `sp`/DIP units an Adwaita condition is written in.
 */
export function addBreakpoints(element: Element, breakpoints: readonly AdwBreakpoint[]): () => void {
    const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        // borderBoxSize is the spec'd path; contentRect is the fallback for the shape older
        // engines report.
        const box = entry.borderBoxSize?.[0];
        const size = box
            ? { width: box.inlineSize, height: box.blockSize }
            : { width: entry.contentRect.width, height: entry.contentRect.height };
        for (const breakpoint of breakpoints) breakpoint.evaluate(size);
    });
    observer.observe(element);
    return () => observer.disconnect();
}

/**
 * Wire a `breakpoint="<condition>"` attribute to a boolean setter, the browser equivalent
 * of an `Adw.Breakpoint` with one `add_setter()` call. Returns a dispose function; call it
 * before re-binding and on disconnect.
 *
 * A missing or unparsable condition binds nothing and returns a no-op, leaving whatever
 * the attribute already says untouched — an element must not silently flip state because
 * its condition had a typo.
 */
export function bindBreakpointSetter(
    element: Element,
    condition: string | null,
    setValue: (active: boolean) => void,
): () => void {
    if (!condition) return () => {};
    const breakpoint = new AdwBreakpoint(condition, {
        onApply: () => setValue(true),
        onUnapply: () => setValue(false),
    });
    return addBreakpoints(element, [breakpoint]);
}
