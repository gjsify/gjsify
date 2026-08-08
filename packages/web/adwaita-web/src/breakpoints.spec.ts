// Breakpoint binding — the browser size source for `@gjsify/adwaita-core`.
//
// The behaviour under test is the one adwaita-web did not have: markup that
// adapts by itself, the way the same markup already adapts on GTK (Adw.Breakpoint)
// and on NativeScript (addBreakpoints). Sizes are driven by actually resizing a
// host element and awaiting a real ResizeObserver delivery, not by faking one.
import { describe, expect, it } from '@gjsify/unit';

import { AdwBreakpoint } from '@gjsify/adwaita-core';

import { addBreakpoints } from './breakpoints.js';
import type { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
import type { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';

/** A fixed-width host appended to the document, plus a way to resize it. */
function mountSized(width: number): { host: HTMLElement; resize: (w: number) => Promise<void> } {
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    document.body.appendChild(host);
    return {
        host,
        resize: async (w: number) => {
            host.style.width = `${w}px`;
            await settle();
        },
    };
}

/** Wait for a ResizeObserver delivery (it runs after layout, before paint). */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

export const AdwBreakpointsTest = async () => {
    await describe('addBreakpoints (ResizeObserver size source)', async () => {
        await it('seeds from the initial observation, without a wrong-layout flash', async () => {
            const { host } = mountSized(400);
            const seen: boolean[] = [];
            const dispose = addBreakpoints(host, [
                new AdwBreakpoint('max-width: 720px', {
                    onApply: () => seen.push(true),
                    onUnapply: () => seen.push(false),
                }),
            ]);
            await settle();
            // Narrow at construction → applied once, never "unapplied first".
            expect(seen).toStrictEqual([true]);
            dispose();
            host.remove();
        });

        await it('applies and unapplies on the transitions only', async () => {
            const { host, resize } = mountSized(400);
            const seen: boolean[] = [];
            const dispose = addBreakpoints(host, [
                new AdwBreakpoint('max-width: 720px', {
                    onApply: () => seen.push(true),
                    onUnapply: () => seen.push(false),
                }),
            ]);
            await settle();
            await resize(900); // crosses out
            await resize(1000); // still wide — no second unapply
            await resize(500); // crosses back in
            expect(seen).toStrictEqual([true, false, true]);
            dispose();
            host.remove();
        });

        await it('stops evaluating once disposed', async () => {
            const { host, resize } = mountSized(900);
            const seen: boolean[] = [];
            const dispose = addBreakpoints(host, [
                new AdwBreakpoint('max-width: 720px', { onApply: () => seen.push(true) }),
            ]);
            await settle();
            dispose();
            await resize(300);
            expect(seen).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('split views collapse themselves from a breakpoint attribute', async () => {
        await it('collapses <adw-navigation-split-view> below the condition', async () => {
            const { host, resize } = mountSized(1000);
            host.innerHTML =
                '<adw-navigation-split-view breakpoint="max-width: 720px">' +
                '<div slot="sidebar">s</div><div slot="content">c</div>' +
                '</adw-navigation-split-view>';
            const view = host.querySelector('adw-navigation-split-view') as AdwNavigationSplitView;
            await settle();
            expect(view.collapsed).toBe(false);

            await resize(500);
            expect(view.collapsed).toBe(true);
            expect(view.classList.contains('collapsed')).toBe(true);

            await resize(1000);
            expect(view.collapsed).toBe(false);
            host.remove();
        });

        await it('collapses <adw-overlay-split-view> below the condition', async () => {
            const { host, resize } = mountSized(1000);
            host.innerHTML =
                '<adw-overlay-split-view breakpoint="max-width: 720px">' +
                '<div slot="sidebar">s</div><div slot="content">c</div>' +
                '</adw-overlay-split-view>';
            const view = host.querySelector('adw-overlay-split-view') as AdwOverlaySplitView;
            await settle();
            expect(view.collapsed).toBe(false);

            await resize(500);
            expect(view.collapsed).toBe(true);
            host.remove();
        });

        await it('leaves collapsed alone when no breakpoint is set', async () => {
            const { host, resize } = mountSized(1000);
            host.innerHTML =
                '<adw-navigation-split-view collapsed>' +
                '<div slot="sidebar">s</div><div slot="content">c</div>' +
                '</adw-navigation-split-view>';
            const view = host.querySelector('adw-navigation-split-view') as AdwNavigationSplitView;
            await resize(1400);
            // Without a condition the application owns the attribute — a wide
            // viewport must not silently expand a deliberately collapsed view.
            expect(view.collapsed).toBe(true);
            host.remove();
        });

        await it('ignores an unparsable condition rather than flipping state', async () => {
            const { host, resize } = mountSized(1000);
            host.innerHTML =
                '<adw-navigation-split-view breakpoint="not a condition">' +
                '<div slot="sidebar">s</div><div slot="content">c</div>' +
                '</adw-navigation-split-view>';
            const view = host.querySelector('adw-navigation-split-view') as AdwNavigationSplitView;
            await resize(300);
            expect(view.collapsed).toBe(false);
            host.remove();
        });
    });
};
