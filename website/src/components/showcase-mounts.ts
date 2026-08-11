// Lazy `mount()` loaders for every browser-mountable showcase — the one place a
// showcase's browser entry is named. CLIENT-ONLY: this pulls in three.js,
// Excalibur and adwaita-web, so never import it from Astro frontmatter (the
// SSR-safe half is `showcase-registry.ts`). The `import()`s are spelled out with
// literal specifiers because a computed one is not statically analysable: Vite
// could not give each showcase its own chunk, and the landing page would
// download all of them to mount one.

import type { ShowcaseMountOpts, ShowcaseName } from './showcase-registry.ts';

/**
 * What a host holds on to after mounting. All optional: only the slideshow
 * pauses demos that scroll out of view, and terminal-variant slides have no
 * handle at all.
 */
export interface ShowcaseHandle {
    pause?: () => void;
    resume?: () => void;
    readonly isPaused?: boolean;
}

type ShowcaseMounter = (container: HTMLElement, opts: ShowcaseMountOpts) => Promise<ShowcaseHandle | undefined>;

/**
 * Name → mounter. The `Record<ShowcaseName, …>` annotation is the mechanism that
 * keeps the landing page honest: adding a showcase to `SHOWCASE_NAMES` stops this
 * object type-checking until its mounter is here, so a showcase cannot reach a
 * page with no way to mount it. That is how the LDraw showcase shipped as an
 * empty box — registered as a slide, with no matching arm in the slideshow's
 * private, unchecked `switch`.
 */
export const SHOWCASE_MOUNTS: Record<ShowcaseName, ShowcaseMounter> = {
    'three-postprocessing-pixel': async (container, opts) => {
        const { mount } = await import('@gjsify/example-dom-three-postprocessing-pixel/browser');
        return mount(container, opts);
    },
    'three-geometry-teapot': async (container, opts) => {
        const { mount } = await import('@gjsify/example-dom-three-geometry-teapot/browser');
        return mount(container, opts);
    },
    'three-loader-ldraw': async (container, opts) => {
        const { mount } = await import('@gjsify/example-dom-three-loader-ldraw/browser');
        return mount(container, opts);
    },
    'excalibur-jelly-jumper': async (container, opts) => {
        const { mount } = await import('@gjsify/example-dom-excalibur-jelly-jumper/browser');
        return mount(container, opts);
    },
    'canvas2d-fireworks': async (container) => {
        const { mount } = await import('@gjsify/example-dom-canvas2d-fireworks/browser');
        return mount(container);
    },
    'minimalist-browser': async (container, opts) => {
        const { mount } = await import('@gjsify/example-dom-minimalist-browser/browser');
        return mount(container, opts);
    },
    'webrtc-loopback': async (container, opts) => {
        const { mount } = await import('@gjsify/example-dom-webrtc-loopback/browser');
        return mount(container, opts);
    },
    'adwaita-storybook': async (container, opts) => {
        const { mount } = await import('@gjsify/example-gtk-adwaita-storybook/browser');
        return mount(container, opts);
    },
};

/**
 * Mount `name` into `container`, or report why nothing appeared. The guard is not
 * dead code: `name` arrives as a `data-` attribute, a string the type system
 * never saw, so a typo in a slide id or embed prop lands here rather than in the
 * compiler — without it the symptom is a silent empty frame.
 */
export async function mountShowcase(
    name: string,
    container: HTMLElement,
    opts: ShowcaseMountOpts,
): Promise<ShowcaseHandle | undefined> {
    const mounter = (SHOWCASE_MOUNTS as Record<string, ShowcaseMounter | undefined>)[name];
    if (!mounter) {
        console.error(
            `[showcase] no mounter registered for "${name}" — add it to SHOWCASE_NAMES ` +
                '(showcase-registry.ts) and SHOWCASE_MOUNTS (showcase-mounts.ts).',
        );
        return undefined;
    }
    return mounter(container, opts);
}
