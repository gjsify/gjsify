// Lazy `mount()` loaders for every browser-mountable showcase — the one place
// a showcase's browser entry is named. CLIENT-ONLY: importing this pulls in
// three.js, Excalibur and adwaita-web, so it must never be imported from Astro
// frontmatter. The SSR-safe half (names, asset dirs) is `showcase-registry.ts`.
//
// The dynamic `import()`s are written out one per showcase, with literal
// specifiers, on purpose: a computed specifier
// (`import('@gjsify/example-dom-' + name + '/browser')`) is not statically
// analysable, so Vite could not split each showcase into its own chunk and the
// landing page would download all of them to mount one.

import type { ShowcaseMountOpts, ShowcaseName } from './showcase-registry.ts';

/**
 * What a host holds on to after mounting. Every method is optional: the
 * slideshow pauses a demo that scrolls out of view, but a static showcase need
 * not implement that, and terminal-variant slides have no handle at all.
 */
export interface ShowcaseHandle {
    pause?: () => void;
    resume?: () => void;
    readonly isPaused?: boolean;
}

type ShowcaseMounter = (
    container: HTMLElement,
    opts: ShowcaseMountOpts,
) => Promise<ShowcaseHandle | undefined>;

/**
 * Name → mounter. The `Record<ShowcaseName, …>` annotation is the mechanism
 * that keeps the landing page honest: add a showcase to `SHOWCASE_NAMES` and
 * this object stops type-checking until its mounter is here, so a showcase
 * cannot reach a page with no way to mount it. That is exactly how the LDraw
 * showcase shipped as an empty box — it was registered as a slide, while the
 * slideshow's private `switch` (with no exhaustiveness check of any kind) was
 * never given a matching arm.
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
 * Mount `name` into `container`, or report why nothing appeared. The guard is
 * not dead code: `name` reaches here as a `data-` attribute, i.e. as a string
 * the type system never saw, so a typo in a slide id or embed prop lands here
 * rather than in the compiler. Without it the symptom is a silent empty frame,
 * which is what made this class of bug expensive to find.
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
