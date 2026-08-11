// Which showcases the website can mount in a browser, and the mount options
// each one needs. Imported by Astro FRONTMATTER, so it must stay free of any
// `@gjsify/example-*` import: that is what keeps the showcase bundles (three.js,
// Excalibur) out of the SSR graph. The client-only mount table is
// `showcase-mounts.ts`. Single source of truth for *which* showcases exist —
// `ShowcaseEmbed.astro` and `ShowcaseSlideshow.astro` both read it rather than
// each keeping a `switch` over the same names.

/** Options understood by the showcases' `mount()` functions. Each reads only its own keys. */
export interface ShowcaseMountOpts {
    /** Base URL for runtime assets copied by `website/scripts/copy-showcase-assets.mjs`. */
    assetBase?: string;
    startMuted?: boolean;
    title?: string;
    homeUrl?: string;
    enablePerf?: boolean;
}

/**
 * Every browser-mountable showcase, in catalogue order. Adding one here is a
 * type error until its mounter joins `SHOWCASE_MOUNTS` (`showcase-mounts.ts`).
 * Names map to `@gjsify/example-dom-<name>` and `showcases/dom/<name>/`, except
 * `adwaita-storybook` (`@gjsify/example-gtk-adwaita-storybook`, `showcases/gtk/`).
 * Each must be a dependency of `@gjsify/website` and export `./browser` with a
 * named `mount()`.
 */
export const SHOWCASE_NAMES = [
    'three-postprocessing-pixel',
    'three-geometry-teapot',
    'three-loader-ldraw',
    'excalibur-jelly-jumper',
    'canvas2d-fireworks',
    'minimalist-browser',
    'webrtc-loopback',
    'adwaita-storybook',
] as const;

export type ShowcaseName = (typeof SHOWCASE_NAMES)[number];

export function isShowcaseName(value: string | undefined | null): value is ShowcaseName {
    return !!value && (SHOWCASE_NAMES as readonly string[]).includes(value);
}

/**
 * Per-showcase mount options that follow from how the showcase is packaged,
 * rather than from the page embedding it.
 *
 * `assetBase` is stored WITHOUT Astro's `base` prefix because this table is read
 * from frontmatter (`ShowcaseEmbed.astro`) and from a client script
 * (`ShowcaseSlideshow.astro`) alike; each host applies the base itself through
 * `showcaseMountOpts()`. Directories match the `dest`s in
 * `website/scripts/copy-showcase-assets.mjs`; a showcase absent here ships no
 * runtime assets.
 */
export const SHOWCASE_DEFAULT_OPTS: Partial<Record<ShowcaseName, ShowcaseMountOpts>> = {
    'three-postprocessing-pixel': { assetBase: 'demos/pixel/' },
    'three-geometry-teapot': { assetBase: 'demos/teapot/' },
    'three-loader-ldraw': { assetBase: 'demos/ldraw/' },
    // Muted by default: a demo the visitor only scrolled past must not make noise.
    'excalibur-jelly-jumper': { assetBase: 'demos/jelly-jumper/', startMuted: true },
};

/**
 * Resolve a showcase's defaults against Astro's configured `base` (e.g.
 * `/gjsify/` in production), then layer page-specific overrides on top.
 */
export function showcaseMountOpts(name: ShowcaseName, base: string, overrides?: ShowcaseMountOpts): ShowcaseMountOpts {
    const defaults = SHOWCASE_DEFAULT_OPTS[name];
    return {
        ...defaults,
        ...(defaults?.assetBase ? { assetBase: `${base}${defaults.assetBase}` } : {}),
        ...overrides,
    };
}
