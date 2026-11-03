// The Android launcher icon and splash logo, derived from the ONE app icon.
//
// A NativeScript app's `App_Resources/Android` ships the template's blue "N" until
// someone hand-maintains five densities of `ic_launcher.png`, an adaptive-icon
// foreground, a background colour and a splash logo. A GNOME app already declares
// its icon once (`hicolor/scalable/apps/<id>.svg`, optionally `…-symbolic.svg`, and
// the metainfo's `<branding>` colour), so this module holds the PURE half of
// translating that into Android resources: geometry, XML text, the stamp. The
// rasterizing (`rasterizeSvg`, librsvg in a child GJS — see icons.ts) is the
// command's, so none of this needs a GJS to be tested.
//
// THE RASTER IS NEVER COMPARED. librsvg versions may antialias differently, so
// `--check` reads a stamp (a hash of the INPUTS plus the files written) instead of
// diffing PNG bytes — same reason icons.ts says the stage, not the raster, is the
// reproducible thing.

import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, posix } from 'node:path';

import { isSymbolicIcon } from './icons.js';

/** Bump when the OUTPUT changes for the same inputs, so every project's `--check` goes stale once. */
export const ANDROID_ICONS_GENERATOR_VERSION = 1;

export const ANDROID_ICONS_STAMP = '.gjsify-android-icons.json';

export const DEFAULT_RESOURCES_DIR = 'App_Resources';
export const DEFAULT_BACKGROUND = '#FFFFFF';

export interface AndroidDensity {
    name: 'ldpi' | 'mdpi' | 'hdpi' | 'xhdpi' | 'xxhdpi' | 'xxxhdpi';
    /** Pixels per dp. */
    scale: number;
}

/** Launcher icons have no ldpi bucket any more; the splash set keeps the template's. */
export const LAUNCHER_DENSITIES: readonly AndroidDensity[] = [
    { name: 'mdpi', scale: 1 },
    { name: 'hdpi', scale: 1.5 },
    { name: 'xhdpi', scale: 2 },
    { name: 'xxhdpi', scale: 3 },
    { name: 'xxxhdpi', scale: 4 },
];
export const SPLASH_DENSITIES: readonly AndroidDensity[] = [{ name: 'ldpi', scale: 0.75 }, ...LAUNCHER_DENSITIES];

/** Legacy launcher icon edge in dp, and the adaptive layers' (the visible window is the inner 72dp). */
export const LEGACY_DP = 48;
export const ADAPTIVE_DP = 108;
/** The part of the adaptive canvas no launcher mask may cut. */
export const SAFE_ZONE_DP = 66;
/** The splash logo's edge in dp; the template's wordmark is 200dp wide, a square mark reads smaller. */
export const SPLASH_DP = 96;
/** How much of a round legacy icon's circle the picture fills. */
export const ROUND_INNER_RATIO = 0.72;

export type AndroidPngKind = 'legacy' | 'round' | 'foreground' | 'monochrome' | 'splash';

export interface AndroidPngSpec {
    /** Relative to the `res/` directory. */
    path: string;
    kind: AndroidPngKind;
    /** Square edge in pixels. */
    size: number;
}

export interface AndroidTextSpec {
    path: string;
    content: string;
}

export interface AndroidIconPlan {
    png: AndroidPngSpec[];
    text: AndroidTextSpec[];
}

function px(dp: number, scale: number): number {
    return Math.round(dp * scale);
}

/**
 * Every file the generator owns, from two facts: the background colour and
 * whether a monochrome layer exists. `<monochrome>` is omitted without a symbolic
 * icon — a launcher with an empty one would theme the icon to nothing.
 */
export function planAndroidIcons(opts: { background: string; monochrome: boolean }): AndroidIconPlan {
    const png: AndroidPngSpec[] = [];
    for (const { name, scale } of LAUNCHER_DENSITIES) {
        const dir = `mipmap-${name}`;
        png.push({ path: `${dir}/ic_launcher.png`, kind: 'legacy', size: px(LEGACY_DP, scale) });
        png.push({ path: `${dir}/ic_launcher_round.png`, kind: 'round', size: px(LEGACY_DP, scale) });
        png.push({ path: `${dir}/ic_launcher_foreground.png`, kind: 'foreground', size: px(ADAPTIVE_DP, scale) });
        if (opts.monochrome) {
            png.push({ path: `${dir}/ic_launcher_monochrome.png`, kind: 'monochrome', size: px(ADAPTIVE_DP, scale) });
        }
    }
    for (const { name, scale } of SPLASH_DENSITIES) {
        png.push({ path: `drawable-${name}/logo.png`, kind: 'splash', size: px(SPLASH_DP, scale) });
    }
    const adaptive = adaptiveIconXml(opts.monochrome);
    return {
        png,
        text: [
            { path: 'values/ic_launcher_background.xml', content: backgroundXml(opts.background) },
            { path: 'mipmap-anydpi-v26/ic_launcher.xml', content: adaptive },
            { path: 'mipmap-anydpi-v26/ic_launcher_round.xml', content: adaptive },
        ],
    };
}

export function backgroundXml(color: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${color}</color>
</resources>
`;
}

export function adaptiveIconXml(monochrome: boolean): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
${monochrome ? '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n' : ''}</adaptive-icon>
`;
}

/** A `#rgb` or `#rrggbb` colour as `#RRGGBB`, or null. */
export function normalizeColor(value: string): string | null {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (match === null) return null;
    const hex = match[1] as string;
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return `#${full.toUpperCase()}`;
}

/**
 * The metainfo's primary brand colour for the LIGHT scheme: launchers draw the
 * adaptive background in both themes, and the light one is the one that reads as
 * "the" app colour. Falls back to an untagged primary colour, else null.
 */
export function parseMetainfoBranding(xml: string): string | null {
    let untagged: string | null = null;
    for (const match of xml.matchAll(/<color\b([^>]*)>\s*([^<\s]+)\s*<\/color>/g)) {
        const attrs = match[1] ?? '';
        if (!/type\s*=\s*["']primary["']/.test(attrs)) continue;
        const color = normalizeColor(match[2] ?? '');
        if (color === null) continue;
        const scheme = /scheme_preference\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1];
        if (scheme === 'light') return color;
        if (scheme === undefined && untagged === null) untagged = color;
    }
    return untagged;
}

/** `appResourcesPath` out of a `nativescript.config.ts`, read as text: evaluating it would need its imports. */
export function parseAppResourcesPath(configText: string): string | null {
    return /\bappResourcesPath\s*:\s*["'`]([^"'`]+)["'`]/.exec(configText)?.[1] ?? null;
}

export function resolveResourcesName(input: {
    flag?: string;
    configured?: string;
    nativescriptConfig: string | null;
}): string {
    return (
        input.flag ??
        input.configured ??
        (input.nativescriptConfig === null ? null : parseAppResourcesPath(input.nativescriptConfig)) ??
        DEFAULT_RESOURCES_DIR
    );
}

export function resolveBackground(input: { flag?: string; configured?: string; fromMetainfo: string | null }): string {
    const explicit = input.flag ?? input.configured;
    if (explicit !== undefined) {
        const color = normalizeColor(explicit);
        if (color === null) {
            throw new Error(`gjsify android-icons: \`${explicit}\` is not a colour — write it as #rrggbb.`);
        }
        return color;
    }
    return input.fromMetainfo ?? DEFAULT_BACKGROUND;
}

/**
 * Which of the discovered icon files is the app icon and which the symbolic one.
 * The `scalable/` SVG wins like in `resolveAppIcon`; a symbolic icon named for it
 * (`<id>-symbolic.svg`) wins over a stranger.
 */
export function pickIconSources(files: readonly string[]): { icon: string | null; symbolic: string | null } {
    const svgs = files.filter((file) => extname(file).toLowerCase() === '.svg');
    const scalable = svgs.filter((file) => !isSymbolicIcon(file));
    const icon = scalable.find((file) => /(?:^|[\\/])scalable[\\/]/.test(file)) ?? scalable[0] ?? null;
    const symbolics = svgs.filter(isSymbolicIcon);
    const stem = icon === null ? null : `${basename(icon, '.svg')}-symbolic`;
    const symbolic = symbolics.find((file) => basename(file, '.svg') === stem) ?? symbolics[0] ?? null;
    return { icon, symbolic };
}

/** Where the hicolor theme keeps the symbolic twin of `…/scalable/apps/<id>.svg`. */
export function symbolicSibling(iconPath: string): string {
    return join(dirname(dirname(dirname(iconPath))), 'symbolic', 'apps', `${basename(iconPath, '.svg')}-symbolic.svg`);
}

function dataUri(svg: Uint8Array): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * The SVG to rasterize for one kind. `legacy` and `splash` render the icon
 * itself (a GNOME icon carries its own silhouette, so a legacy launcher entry
 * needs no plate behind it); the others are a wrapper that embeds the icon as a
 * data URI, because the rasterizer renders a whole document at a size and cannot
 * place a picture inside a larger transparent canvas.
 */
export function wrapperSvg(kind: 'round' | 'foreground' | 'monochrome', icon: Uint8Array, background: string): string {
    const xmlns = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
    if (kind === 'round') {
        const inner = 100 * ROUND_INNER_RATIO;
        const offset = (100 - inner) / 2;
        return (
            `<svg ${xmlns} width="100" height="100" viewBox="0 0 100 100">` +
            `<circle cx="50" cy="50" r="50" fill="${background}"/>` +
            `<image x="${offset}" y="${offset}" width="${inner}" height="${inner}" xlink:href="${dataUri(icon)}"/></svg>`
        );
    }
    const offset = (ADAPTIVE_DP - SAFE_ZONE_DP) / 2;
    return (
        `<svg ${xmlns} width="${ADAPTIVE_DP}" height="${ADAPTIVE_DP}" viewBox="0 0 ${ADAPTIVE_DP} ${ADAPTIVE_DP}">` +
        `<image x="${offset}" y="${offset}" width="${SAFE_ZONE_DP}" height="${SAFE_ZONE_DP}" xlink:href="${dataUri(icon)}"/></svg>`
    );
}

export interface AndroidIconsStamp {
    generator: number;
    /** sha256 over the inputs. */
    inputs: string;
    /** Relative to the resources directory, posix. */
    files: string[];
}

function sha256(bytes: Uint8Array | string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export function hashInputs(input: { icon: Uint8Array; symbolic: Uint8Array | null; background: string }): string {
    return sha256(
        JSON.stringify({
            generator: ANDROID_ICONS_GENERATOR_VERSION,
            icon: sha256(input.icon),
            symbolic: input.symbolic === null ? null : sha256(input.symbolic),
            background: input.background,
        }),
    );
}

/** The stamp's paths are relative to the resources directory, so it survives a move of the project. */
export function buildStamp(inputs: string, plan: AndroidIconPlan, resPrefix: string): AndroidIconsStamp {
    const files = [...plan.png.map((p) => p.path), ...plan.text.map((t) => t.path)].map((p) => posix.join(resPrefix, p));
    return { generator: ANDROID_ICONS_GENERATOR_VERSION, inputs, files: files.sort() };
}

export type StampVerdict = { current: true } | { current: false; reason: string };

export function checkStamp(
    existing: string | null,
    expectedInputs: string,
    fileExists: (relativePath: string) => boolean,
): StampVerdict {
    if (existing === null) return { current: false, reason: 'was never generated' };
    let stamp: AndroidIconsStamp;
    try {
        stamp = JSON.parse(existing) as AndroidIconsStamp;
    } catch {
        return { current: false, reason: 'has an unreadable stamp' };
    }
    if (stamp.generator !== ANDROID_ICONS_GENERATOR_VERSION || stamp.inputs !== expectedInputs) {
        return { current: false, reason: 'is out of date with the icon, colour or generator' };
    }
    const missing = (stamp.files ?? []).find((file) => !fileExists(file));
    if (missing !== undefined) return { current: false, reason: `lacks ${missing}` };
    return { current: true };
}
