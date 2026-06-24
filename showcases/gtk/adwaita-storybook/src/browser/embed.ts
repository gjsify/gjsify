// Embeddable browser target — `mount(container)` renders the Adwaita storybook
// into any DOM element, mirroring the `mount()` contract the DOM showcases
// expose (e.g. `@gjsify/example-dom-minimalist-browser/browser`). The gjsify
// website uses it to embed the storybook live in its showcase pages and the
// home-page slideshow.
//
// The storybook's root is an `<adw-window class="sb-window">`; the website's
// embed CSS sizes any `adw-window` to fill its slot, so the storybook fills the
// container the same way the native window fills its toplevel. The renderer is
// responsive (it collapses to single-pane navigation below 720px, like the
// native `Adw.Breakpoint`), so it adapts to both the wide doc-page embed and
// narrow mobile layouts.

import { mountStorybook } from '@gjsify/adwaita-storybook';
import { stories } from './stories.js';

export interface ShowcaseHandle {
    /** No-op: the storybook renders no animation, so there's nothing to pause. */
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

export interface MountOptions {
    /** Window title shown in the sidebar header (default "Adwaita Storybook"). */
    title?: string;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    mountStorybook(container, { title: options?.title ?? 'Adwaita Storybook', stories });

    // The storybook is static (no rAF loop), so pause/resume are inert — they
    // exist only to satisfy the slideshow's optional ShowcaseHandle contract.
    let paused = false;
    return {
        pause(): void {
            paused = true;
        },
        resume(): void {
            paused = false;
        },
        get isPaused(): boolean {
            return paused;
        },
    };
}
