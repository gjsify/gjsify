/**
 * The page needs about twenty small glyphs. They are drawn here instead of pulled from an icon
 * theme: inlining them costs no request, and a symbolic 16×16 grid is little enough geometry to
 * keep in one file. UI glyphs use `currentColor` and are sized by CSS.
 *
 * The platform and browser marks (Linux, macOS, Windows, Android, Firefox, Chromium, Edge, Safari)
 * are simplified redrawings of the trademarked logos, with `simple-icons` (CC0 1.0) as geometry
 * reference for the Apple and Linux shapes. Two come from icon sets with a licence that allows it:
 * the Firefox fox is Fontisto's `firefox` (MIT, © Kenan Gündoğan) with a globe disc added behind
 * it, and the Edge wave is Font Awesome 7 Free's `edge` brand icon (CC BY 4.0, © Fonticons, Inc.,
 * fontawesome.com/license/free), cropped to its glyph box and split into its three parts.
 * Chromium and the rest are drawn from scratch — `simple-icons` has no Chromium or Edge mark. The
 * marks belong to their owners and appear only to name the platform. Each part is a `b1…bN` path: at rest all
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
    firefox: `<circle class="b2" cx="8" cy="8.3" r="6.6"/><path class="b1" d="M7.98 15.68l-0.11 0c-1.62 0-3.13-0.5-4.37-1.35l0.02 0.02c-1.27-0.86-2.27-2.07-2.89-3.47l-0.02-0.06c-0.36-0.83-0.56-1.73-0.59-2.64l0-0.02c-0.06-1.01 0.02-2.02 0.24-3.01l-0.01 0.07c0.21-0.98 0.55-1.93 1.01-2.82l-0.03 0.06c0.39-0.8 0.93-1.53 1.58-2.14l0 0-0.1 2.48q0.1-0.12 0.6-0.13t0.62 0.13c0.33-0.54 0.82-0.96 1.4-1.21l0.02-0.01c0.64-0.32 1.35-0.5 2.07-0.52h0.01c-0.41 0.38-0.76 0.81-1.05 1.29l-0.01 0.03c-0.32 0.41-0.5 0.91-0.52 1.44v0c0.16 0.05 0.34 0.09 0.54 0.12l0.01 0q0.34 0.05 0.56 0.07t0.6 0.03 0.45 0.03q0.13 0.04 0.08 0.4c-0.03 0.24-0.12 0.47-0.27 0.67l0 0c-0.04 0.06-0.09 0.11-0.14 0.16l0 0c-0.15 0.12-0.32 0.22-0.49 0.31l-0.01 0c-0.28 0.15-0.57 0.25-0.88 0.3l-0.02 0.01 0.14 1.67-1.23-0.59c-0.1 0.23-0.13 0.48-0.06 0.73l-0.01-0.01c0.07 0.23 0.18 0.42 0.32 0.59l0 0c0.16 0.16 0.35 0.29 0.57 0.36l0.01 0c0.23 0.08 0.48 0.1 0.73 0.06l-0.01 0c0.32-0.06 0.61-0.17 0.88-0.31l-0.01 0q0.41-0.22 0.73-0.39c0.2-0.12 0.43-0.17 0.66-0.16h-0.01 0.02c0.3 0 0.57 0.11 0.78 0.3l-0.01-0.01c0.17 0.15 0.23 0.37 0.18 0.58l0 0q-0.01 0.02-0.02 0.05c-0.03 0.04-0.05 0.07-0.08 0.11l0 0c-0.04 0.05-0.1 0.1-0.16 0.13l0 0c-0.08 0.05-0.18 0.08-0.27 0.1l-0.01 0c-0.13 0.02-0.28 0.03-0.41 0.01l0 0c-0.3 0.5-0.74 0.92-1.26 1.19l-0.02 0c-0.44 0.2-0.92 0.3-1.4 0.29q-0.24 0-0.47-0.03l0.02 0.01c0.41 0.34 0.89 0.59 1.41 0.72l0.03 0c0.49 0.13 1.01 0.15 1.51 0.05l-0.02 0.01c0.48-0.1 0.95-0.26 1.39-0.48l-0.03 0.02c0.42-0.2 0.8-0.47 1.14-0.78l0 0c0.28-0.26 0.51-0.56 0.7-0.9l0.01-0.02c0.25-0.53 0.37-1.12 0.34-1.71v0.01c-0.02-0.59-0.13-1.16-0.34-1.7l0.01 0.03c-0.14-0.42-0.38-0.8-0.69-1.1l-0.01 0c0.47 0.19 0.87 0.43 1.23 0.71l-0.01-0.01c0.3 0.26 0.53 0.6 0.67 0.98l0.01 0.02c0.14-2.12-0.73-4.18-2.36-5.54l-0.01-0.01c1.46 0.39 2.74 1.25 3.64 2.46l0.01 0.01c0.92 1.35 1.39 2.96 1.33 4.59v-0.01l0 0.08c0 0.78-0.13 1.52-0.37 2.22l0.02-0.05c-0.26 0.76-0.63 1.48-1.11 2.13l0.01-0.02c-0.47 0.64-1.03 1.22-1.65 1.72l-0.02 0.01c-1.35 1.06-3.02 1.64-4.74 1.64h0z"/>`,
    chromium: `<path class="b1" d="M2.01 3.16A7.7 7.7 0 0 1 13.99 3.16L11.25 4.74A4.6 4.6 0 0 0 4.75 4.74Z"/><path class="b2" d="M15.19 5.24A7.7 7.7 0 0 1 9.2 15.61L9.2 12.44A4.6 4.6 0 0 0 12.45 6.82Z"/><path class="b3" d="M6.8 15.61A7.7 7.7 0 0 1 .81 5.24L3.55 6.82A4.6 4.6 0 0 0 6.8 12.44Z"/><circle class="b4" cx="8" cy="8" r="3.4"/>`,
    edge: `<path class="b1" d="M3.75 1.17c1.28-0.79 2.74-1.19 4.22-1.17 5.25 0 8.03 3.87 8.03 6.86 0 1.02-0.41 2-1.12 2.72-0.72 0.73-1.69 1.14-2.71 1.16-2.35 0-2.86-0.72-2.86-1 0-0.12 0.04-0.19 0.15-0.29l0.03-0.04 0.01-0.05c0.33-0.36 0.5-0.82 0.5-1.3 0-2.46-2.57-4.46-5.75-4.46-1.17-0.01-2.33 0.28-3.36 0.84 0.84-1.8 2.58-3.05 2.85-3.24 0.03-0.02 0.01-0.03 0.01-0.03z"/><path class="b2" d="M4.24 11.11c-0.04 0.94 0.14 1.87 0.51 2.72 0.43 0.83 1.03 1.6 1.77 2.17-1.86-0.36-3.49-1.37-4.67-2.79-1.19-1.45-1.85-3.26-1.85-5.15 0-1.6 1.95-2.95 4.25-2.95 1.14-0.02 2.26 0.34 3.18 1.02l-0.11 0.04c-1.61 0.55-3.08 2.83-3.08 4.94"/><path class="b3" d="M14.68 12.5l-0.02 0c-0.37 0.59-0.81 1.1-1.32 1.55-0.96 0.88-2.13 1.42-3.4 1.56-0.58 0.01-1.15-0.1-1.68-0.36-0.8-0.32-1.47-0.93-1.93-1.65-0.45-0.75-0.66-1.62-0.59-2.49-0.02-0.63 0.17-1.26 0.47-1.82 0.43 1.04 1.17 1.92 2.11 2.53s2.05 0.92 3.17 0.89c0.97 0.01 1.94-0.21 2.82-0.64l0.06-0.03c0.12-0.07 0.24-0.12 0.36 0 0.14 0.15 0.06 0.29-0.04 0.44 0 0-0.01 0.01-0.01 0.02"/>`,
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
