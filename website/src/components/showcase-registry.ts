// The set of showcases the website can mount in a browser, and the mount
// options each one needs. Imported by Astro FRONTMATTER (server side), so it
// must stay free of any `@gjsify/example-*` import — the mount table that does
// import them is client-only and lives in `showcase-mounts.ts`. Splitting the
// two keeps the showcase bundles (three.js, Excalibur) out of the SSR graph;
// merging them would drag every demo through the docs build for nothing.
//
// This file is the single source of truth for *which* showcases exist. Two
// components consume it — `ShowcaseEmbed.astro` (one embed per docs page) and
// `ShowcaseSlideshow.astro` (the landing page) — and both used to carry their
// own hand-written `switch` over the same names. That duplication is what broke
// the LDraw showcase: it was added to the embed's switch and to the slideshow's
// slide list, but not to the slideshow's switch, so the landing page rendered
// the slide's code panel and terminal around an empty placeholder. One table
// consumed by both is what makes that shape impossible.

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
 * Every browser-mountable showcase, in catalogue order. Adding one here without
 * adding its mounter to `SHOWCASE_MOUNTS` is a type error — see the `Record<
 * ShowcaseName, ...>` annotation in `showcase-mounts.ts`.
 *
 * Names map to `@gjsify/example-dom-<name>` and `showcases/dom/<name>/`;
 * `adwaita-storybook` is the one GTK-category entry
 * (`@gjsify/example-gtk-adwaita-storybook`, under `showcases/gtk/`). Each must
 * be a dependency of `@gjsify/website` and export `./browser` with a named
 * `mount()`.
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
 * `assetBase` is stored WITHOUT Astro's `base` prefix and resolved by the host
 * (see `withBase`), because the same table is read from frontmatter and from a
 * client script and only the latter can read `import.meta.env.BASE_URL` at the
 * point of use. Directories match the `dest`s in
 * `website/scripts/copy-showcase-assets.mjs`; a showcase absent here ships no
 * runtime assets.
 */
export const SHOWCASE_DEFAULT_OPTS: Partial<Record<ShowcaseName, ShowcaseMountOpts>> = {
    'three-postprocessing-pixel': { assetBase: 'demos/pixel/' },
    'three-geometry-teapot': { assetBase: 'demos/teapot/' },
    'three-loader-ldraw': { assetBase: 'demos/ldraw/' },
    // Muted by default: a demo that starts making noise on a page the visitor
    // only scrolled past is the wrong first impression.
    'excalibur-jelly-jumper': { assetBase: 'demos/jelly-jumper/', startMuted: true },
};

/**
 * Resolve a showcase's default mount options against Astro's configured `base`
 * (e.g. `/gjsify/` in production), then layer any page-specific overrides on
 * top. Call it wherever `import.meta.env.BASE_URL` is readable.
 */
export function showcaseMountOpts(
    name: ShowcaseName,
    base: string,
    overrides?: ShowcaseMountOpts,
): ShowcaseMountOpts {
    const defaults = SHOWCASE_DEFAULT_OPTS[name];
    return {
        ...defaults,
        ...(defaults?.assetBase ? { assetBase: `${base}${defaults.assetBase}` } : {}),
        ...overrides,
    };
}
