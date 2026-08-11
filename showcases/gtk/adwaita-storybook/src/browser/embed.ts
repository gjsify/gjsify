// `mount(container)` renders the storybook into any DOM element, the same contract the DOM showcases
// expose, which is how the gjsify website embeds it live.
//
// The root is an `<adw-window>`, and the website's embed CSS sizes any `adw-window` to fill its slot,
// so the storybook fills its container as the native window fills its toplevel. The renderer
// collapses to single-pane navigation below 720px, mirroring the native `Adw.Breakpoint`.

import { mountStorybook } from '@gjsify/adwaita-storybook';
import { stories } from './stories.js';

export interface ShowcaseHandle {
    /** Inert: the storybook has no rAF loop. Present only for the slideshow's handle contract. */
    pause(): void;
    resume(): void;
    readonly isPaused: boolean;
}

export interface MountOptions {
    title?: string;
}

export function mount(container: HTMLElement, options?: MountOptions): ShowcaseHandle {
    mountStorybook(container, { title: options?.title ?? 'Adwaita Storybook', stories });

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
