/**
 * The page needs about twenty small glyphs. They are drawn here instead of pulled from an icon
 * theme: inlining them costs no request, and a symbolic 16×16 grid is little enough geometry to
 * keep in one file. UI glyphs use `currentColor` and are sized by CSS.
 *
 * The platform and browser marks (Linux, macOS, Windows, Android, Firefox, Chromium, Edge, Safari)
 * are simplified redrawings of the trademarked logos, with `simple-icons` (CC0 1.0) as geometry
 * reference for Firefox, Apple and Linux; the others are drawn from scratch. The marks belong to
 * their owners and appear only to name the platform. Each part is a `b1…bN` path: at rest all
 * are `currentColor`, and the stylesheet fills them in the brand colours on hover and focus.
 */

export type IconName =
    | 'linux'
    | 'macos'
    | 'windows'
    | 'android'
    | 'web'
    | 'firefox'
    | 'chromium'
    | 'edge'
    | 'safari'
    | 'package'
    | 'download'
    | 'license'
    | 'chevron-down'
    | 'chevron-left'
    | 'chevron-right'
    | 'close'
    | 'copy'
    | 'expand'
    | 'external'
    | 'code'
    | 'bug'
    | 'heart'
    | 'help'
    | 'mail'
    | 'people'
    | 'translate'
    | 'blog'
    | 'cv'
    | 'feed';

/** Shared attributes of the outline icons, so the strokes stay optically equal. */
const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';

/** Marks of platforms and browsers; every part is its own `b1…bN` path, see the stylesheet. */
export const BRAND_ICONS = [
    'linux',
    'macos',
    'windows',
    'android',
    'firefox',
    'chromium',
    'edge',
    'safari',
] as const satisfies readonly IconName[];

const BRAND_PATHS: Record<(typeof BRAND_ICONS)[number], string> = {
    linux: `<path class="b1" fill-rule="evenodd" d="M8 1.8c-1.7 0-2.9 1.4-2.9 3.2 0 .9.3 1.5-.4 2.5-1 1.4-1.8 3.2-1.8 4.6 0 .9.8 1.4 1.7 1.4h6.8c.9 0 1.7-.5 1.7-1.4 0-1.4-.8-3.2-1.8-4.6-.7-1-.4-1.6-.4-2.5 0-1.8-1.2-3.2-2.9-3.2Zm-1.2 2.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Zm2.4 0a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2ZM8 7.4c-1.3 0-2.2 1.4-2.2 3.2 0 1.4.9 2.4 2.2 2.4s2.2-1 2.2-2.4c0-1.8-.9-3.2-2.2-3.2Z"/><path class="b2" d="M8 7.9c-.95 0-1.65 1.1-1.65 2.7 0 1.1.7 1.9 1.65 1.9s1.65-.8 1.65-1.9C9.65 9 8.95 7.9 8 7.9Z"/><ellipse class="b3" cx="8" cy="6.3" rx="1.3" ry="0.65"/><ellipse class="b3" cx="5.3" cy="14.3" rx="2.1" ry="1"/><ellipse class="b3" cx="10.7" cy="14.3" rx="2.1" ry="1"/>`,
    macos: `<path class="b1" d="M10.35 2.55L10.67 2.12L10.92 1.63L11.1 1.11L11.19 .56L11.18 0L10.69 .07L10.17 .25L9.68 .5L9.22 .83L8.83 1.21L8.53 1.61L8.27 2.08L8.08 2.59L7.97 3.14L7.98 3.69L8.52 3.66L9.04 3.51L9.53 3.26L9.98 2.94L10.35 2.55Z"/><path class="b2" d="M8.1 4.6L7.68 4.52L7.2 4.35L6.65 4.14L6.07 3.97L5.46 3.9L4.66 4L3.91 4.27L3.23 4.68L2.64 5.24L2.15 5.91L2.02 6.28L13.18 6.28L13.45 5.96L13.89 5.59L14.1 5.45L13.48 4.76L12.81 4.3L12.15 4.04L11.58 3.91L11.17 3.87L10.4 3.91L9.7 4.08L9.07 4.31L8.53 4.51L8.1 4.6Z"/><path class="b3" d="M1.94 6.52L1.59 7.5L1.53 8.58L12.39 8.58L12.37 8.49L12.54 7.4L12.95 6.56L12.98 6.52Z"/><path class="b4" d="M1.52 8.82L1.5 9.24L1.79 10.88L13.34 10.88L13.13 10.68L12.6 9.76L12.43 8.82Z"/><path class="b5" d="M1.86 11.12L2.4 12.61L2.66 13.08L13.95 13.08L14.13 12.74L14.34 12.23L14.47 11.88L14.52 11.73L14.29 11.62L13.76 11.29L13.59 11.12Z"/><path class="b6" d="M2.8 13.32L3.17 13.97L3.59 14.56L4.04 15.12L4.54 15.58L5.09 15.89L5.69 16L6.24 15.91L6.7 15.75L7.16 15.56L7.67 15.41L8.32 15.34L8.96 15.41L9.47 15.57L9.92 15.76L10.39 15.92L10.96 15.97L11.57 15.86L12.1 15.56L12.57 15.12L13 14.59L13.41 14.01L13.82 13.34Z"/>`,
    windows: `<path class="b1" d="M1.6 1.6h6v6h-6Z"/><path class="b2" d="M8.4 1.6h6v6h-6Z"/><path class="b3" d="M1.6 8.4h6v6h-6Z"/><path class="b4" d="M8.4 8.4h6v6h-6Z"/>`,
    android: `<path class="b1" fill-rule="evenodd" d="M2.4 12.2a5.6 5.6 0 0 1 11.2 0Zm3.5-3.5a.8.8 0 1 0 1.6 0 .8.8 0 0 0-1.6 0Zm4.2 0a.8.8 0 1 0 1.6 0 .8.8 0 0 0-1.6 0ZM5.2 5.9 3.9 3.1l.9-.4 1.3 2.8ZM10.8 5.9l1.3-2.8-.9-.4-1.3 2.8Z"/>`,
    firefox: `<path class="b1" d="M5.48 .48L4.96 .7L4.49 .96L4.08 1.24L3.74 1.53L4.07 1.35L4.47 1.17L4.93 1.01L5.44 .87L5.75 .8L5.79 .79L12.8 7.8L12.57 8.32L12.03 8.96L11.32 9.5L10.51 9.87L9.65 10.01L9.33 9.98L8.96 9.92L8.56 9.81L8.15 9.63L7.12 8.75L6.65 7.6L6.74 6.41L7.41 5.43L7.03 5.42L6.58 5.54L6.09 5.84L5.65 6.34L5.37 6.95L5.26 7.65L5.31 8.37L5.48 9.02L5.41 8.87L5.35 8.72L5.29 8.56L5.24 8.41L5.19 8.25L5.15 8.09L5.12 7.92L5.09 7.76L5.05 7.44L5.04 7.11L5.04 6.78L5.07 6.46L5.11 6.14L5.18 5.82L5.26 5.5L5.37 5.2L5.45 4.98L5.55 4.77L5.65 4.56L5.77 4.36L5.89 4.16L6.02 3.97L6.15 3.78L6.3 3.6L6.76 3.12L7.23 2.73L7.54 2.54L6.77 1.77L6.52 1.75L5.73 1.8L4.87 2L3.98 2.37L3.13 2.94L2.94 3.11L2.75 3.29L2.57 3.48L2.4 3.68L2.24 3.89L2.09 4.1L1.95 4.32L1.82 4.55L1.62 4.96L1.47 5.31L1.38 5.57L1.35 5.67L1.46 4.94L1.66 4.22L1.91 3.55L2.18 2.96L1.76 3.27L1.33 3.74L.92 4.33L.58 4.99L.25 5.98L.06 7.03L0 8.16L.09 9.33L1.04 11.96L2.8 14.07L5.17 15.47L7.99 15.98L11.11 15.35L13.65 13.63L15.37 11.09L15.49 10.49Z"/><path class="b2" d="M13.63 2.3L13.45 2.11L13.26 1.94L13.06 1.76L12.85 1.6L12.64 1.45L12.43 1.3L12.21 1.16L11.98 1.02L11.36 .72L10.55 .4L9.53 .14L8.32 .02L7.95 .02L7.59 .04L7.23 .07L6.87 .12L6.51 .18L6.16 .27L5.81 .37L5.48 .48L5.79 .79L6.06 .75L6.37 .71L6.68 .69L6.99 .69L7.3 .69L7.62 .72L7.93 .75L9.03 1.01L10.01 1.4L10.86 1.91L11.58 2.5L11.7 2.62L11.82 2.75L11.94 2.87L12.05 3.01L12.15 3.14L12.25 3.28L12.35 3.42L12.45 3.56L12.98 4.81L13.16 6.1L13.01 7.31L12.8 7.8L7.54 2.54L7.69 2.45L8.13 2.26L7.82 2.05L7.44 1.9L7 1.8L6.77 1.77L15.49 10.49L16 7.97L15.96 7.18L15.85 6.4L15.65 5.64L15.39 4.9L15.05 4.18L14.64 3.51L14.17 2.88L13.63 2.3Z"/>`,
    chromium: `<path class="b1" d="M2.01 3.16A7.7 7.7 0 0 1 13.99 3.16L11.25 4.74A4.6 4.6 0 0 0 4.75 4.74Z"/><path class="b2" d="M15.19 5.24A7.7 7.7 0 0 1 9.2 15.61L9.2 12.44A4.6 4.6 0 0 0 12.45 6.82Z"/><path class="b3" d="M6.8 15.61A7.7 7.7 0 0 1 .81 5.24L3.55 6.82A4.6 4.6 0 0 0 6.8 12.44Z"/><circle class="b4" cx="8" cy="8" r="3.4"/>`,
    edge: `<path class="b1" d="M.4 8.25A7.6 7.6 0 1 1 7.75 15.6A6 6 0 1 0 .4 8.25Z"/><path class="b2" d="M.46 12.48A7.3 7.3 0 0 1 11.03 7.55L9.99 9.5A5.1 5.1 0 0 0 2.61 12.94Z"/>`,
    safari: `<path class="b1" fill-rule="evenodd" d="M8 .3A7.7 7.7 0 1 1 8 15.7 7.7 7.7 0 0 1 8 .3Zm0 1.2A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5ZM7.7 2.2h.6v1.2h-.6ZM12.6 7.7h1.2v.6h-1.2ZM7.7 12.6h.6v1.2h-.6ZM2.2 7.7h1.2v.6H2.2Z"/><path class="b2" d="M11.25 4.75 8.96 8.74 7.26 7.05Z"/><path class="b3" d="M4.75 11.25 7.05 7.26 8.74 8.96Z"/>`,
};

const PATHS: Record<IconName, string> = {
    ...BRAND_PATHS,
    web: `<g ${STROKE}><circle cx="8" cy="8" r="6.3"/><path d="M1.7 8h12.6"/><path d="M8 1.7c1.7 1.7 2.6 3.9 2.6 6.3S9.7 12.6 8 14.3C6.3 12.6 5.4 10.4 5.4 8s.9-4.6 2.6-6.3Z"/></g>`,

    package: `<g ${STROKE}><path d="M8 1.6 14 4.5v7L8 14.4l-6-2.9v-7L8 1.6Z"/><path d="m2 4.5 6 2.9 6-2.9M8 7.4v7"/></g>`,
    download: `<g ${STROKE}><path d="M8 1.9v7.6M4.8 6.4 8 9.6l3.2-3.2M2.4 13.3h11.2"/></g>`,
    license: `<g ${STROKE}><path d="M4 1.8h5l3.2 3.2v9.2H4V1.8Z"/><path d="M8.8 1.8V5h3.2M6.2 8.2h3.6M6.2 10.8h3.6"/></g>`,

    'chevron-down': `<path ${STROKE} d="m4.2 6.2 3.8 3.8 3.8-3.8"/>`,
    'chevron-left': `<path ${STROKE} d="M9.8 3 4.8 8l5 5"/>`,
    'chevron-right': `<path ${STROKE} d="m6.2 3 5 5-5 5"/>`,
    close: `<path ${STROKE} d="m3.8 3.8 8.4 8.4M12.2 3.8 3.8 12.2"/>`,
    copy: `<g ${STROKE}><rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.6"/><path d="M10.6 5.4V4c0-.9-.7-1.6-1.6-1.6H4c-.9 0-1.6.7-1.6 1.6v5c0 .9.7 1.6 1.6 1.6h1.4"/></g>`,
    expand: `<path ${STROKE} d="M6 1.9H1.9V6M10 1.9h4.1V6M10 14.1h4.1V10M6 14.1H1.9V10"/>`,
    external: `<g ${STROKE}><path d="M9.2 2.2h4.6v4.6M13.4 2.6 7.6 8.4"/><path d="M12 9.6v2.8c0 .8-.6 1.4-1.4 1.4H4c-.8 0-1.4-.6-1.4-1.4V5.8c0-.8.6-1.4 1.4-1.4h2.8"/></g>`,
    code: `<path ${STROKE} d="M5.6 11.8 2 8l3.6-3.8M10.4 4.2 14 8l-3.6 3.8M9.4 2.6 6.6 13.4"/>`,
    bug: `<g ${STROKE}><path d="M8 5.2c1.7 0 3 1.4 3 3v1.6c0 1.7-1.3 3-3 3s-3-1.3-3-3V8.2c0-1.6 1.3-3 3-3Z"/><path d="M6.3 4.2 5.5 2.6M9.7 4.2l.8-1.6M5 7.6H2.5M11 7.6h2.5M5 10.8H2.7M11 10.8h2.3M8 5.4v7.4"/></g>`,
    heart: `<path ${STROKE} d="M8 13.6 3.1 8.5a3.2 3.2 0 1 1 4.5-4.5l.4.4.4-.4a3.2 3.2 0 1 1 4.5 4.5L8 13.6Z"/>`,
    help: `<g ${STROKE}><circle cx="8" cy="8" r="6.3"/><path d="M6.2 6.2a1.8 1.8 0 1 1 2.7 1.7c-.6.3-.9.8-.9 1.4v.3"/></g><circle cx="8" cy="12" r=".9"/>`,
    mail: `<g ${STROKE}><rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.6"/><path d="m2.4 4.6 5.6 4.2 5.6-4.2"/></g>`,
    people: `<g ${STROKE}><circle cx="6.2" cy="5.2" r="2.6"/><path d="M1.6 13.8c0-2.5 2.1-4.2 4.6-4.2s4.6 1.7 4.6 4.2"/><path d="M10.6 3.1a2.6 2.6 0 0 1 0 5.1M12.1 9.9c1.4.5 2.3 1.7 2.3 3.3"/></g>`,
    translate: `<g ${STROKE}><path d="M2 4.4c0-.9.7-1.6 1.6-1.6h5.1c.9 0 1.6.7 1.6 1.6v2.3c0 .9-.7 1.6-1.6 1.6H6L3.6 10.4V8.3h-.1c-.8 0-1.5-.7-1.5-1.6V4.4Z"/><path d="M12.3 6h.1c.9 0 1.6.7 1.6 1.6v2.3c0 .9-.7 1.6-1.6 1.6h-.1v2.1L9.9 11.5H8"/></g>`,
    blog: `<g ${STROKE}><path d="M10.6 2.4a1.5 1.5 0 0 1 2.1 2.1L6 11.2l-2.8.7.7-2.8 6.7-6.7Z"/><path d="M2.2 14.2h11.6"/></g>`,
    cv: `<g ${STROKE}><rect x="2.6" y="1.8" width="10.8" height="12.4" rx="1.6"/><circle cx="8" cy="6" r="1.8"/><path d="M5.2 10.6c.4-1.2 1.5-1.9 2.8-1.9s2.4.7 2.8 1.9"/></g>`,
    feed: `<g ${STROKE}><path d="M3 7.2a5.8 5.8 0 0 1 5.8 5.8M3 2.6A10.4 10.4 0 0 1 13.4 13"/></g><circle cx="3.9" cy="12.1" r="1.3"/>`,
};

export interface IconOptions {
    /** Added to the `<svg>`, on top of the shared `icon` class. */
    class?: string;
    /** Rendered as the accessible name; without it the icon is `aria-hidden`. */
    title?: string;
}

/** Renders one icon as an inline `<svg>`; decorative by default. */
export function icon(name: IconName, options: IconOptions = {}): string {
    const brand = (BRAND_ICONS as readonly string[]).includes(name) ? ` icon-brand icon-${name}` : '';
    const classes = `icon${brand}${options.class ? ` ${options.class}` : ''}`;
    const label = options.title
        ? ` role="img" aria-label="${options.title.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}"`
        : ' aria-hidden="true"';
    return `<svg class="${classes}" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"${label}>${PATHS[name]}</svg>`;
}
