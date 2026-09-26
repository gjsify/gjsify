// Extension icons from SVG (ADR 0077 § 2): PNGs at every size for the targets
// that need rasters (Chromium draws no SVG in `icons`/`action.default_icon`),
// the SVG files themselves for the targets that draw them (Firefox).
//
// The rendering is `ship`'s: librsvg in a `gjs -c` child, IHDR-checked, the same
// on a GJS-hosted and a Node-hosted CLI. Only the naming lives here, and it
// lives in ONE function (`webextIconPaths`) that both the file writer and the
// manifest's `ctx.icons(name)` read, so a manifest cannot name an icon path the
// build did not write.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { rasterizeSvg, type RasterizeInput } from '../ship/icons.js';
import type { ResolvedWebextIcons } from './config.js';
import type { WebextTarget } from './targets.js';

/** Where an icon lives inside a target folder, per size (`{ "16": "icons/idle-16.png" }`). */
export function webextIconPaths(
    icons: ResolvedWebextIcons,
    name: string,
    target: WebextTarget,
): Record<string, string> {
    const bySize = icons.sources.get(name);
    if (bySize === undefined) {
        throw new Error(
            `gjsify webext: the manifest asks for icon "${name}", and \`gjsify.webext.icons.sources\` declares ` +
                `${[...icons.sources.keys()].map((n) => `"${n}"`).join(', ') || 'none'}.`,
        );
    }
    const svg = icons.svgTargets.has(target.id);
    const out: Record<string, string> = {};
    for (const size of icons.sizes) {
        out[String(size)] = svg ? `icons/${basename(bySize.get(size) as string)}` : `icons/${name}-${size}.png`;
    }
    return out;
}

/**
 * Every file an SVG target receives, keyed by its path in the target. Two
 * different sources with one base name would overwrite each other there, so
 * that is refused rather than decided by iteration order.
 */
export function svgIconFiles(icons: ResolvedWebextIcons): Map<string, string> {
    const files = new Map<string, string>();
    for (const [name, bySize] of icons.sources) {
        for (const source of bySize.values()) {
            const path = `icons/${basename(source)}`;
            const previous = files.get(path);
            if (previous !== undefined && previous !== source) {
                throw new Error(
                    `gjsify webext: icon "${name}" uses ${source}, and ${previous} has the same file name; ` +
                        'an SVG target would receive only one of them as ' +
                        path +
                        '. Rename one.',
                );
            }
            files.set(path, source);
        }
    }
    return files;
}

export interface RenderedIcons {
    /** `icons/<name>-<size>.png` → bytes. Empty when no target needs rasters. */
    png: Map<string, Uint8Array>;
    /** `icons/<file>.svg` → source path. Empty when no target draws SVG. */
    svg: Map<string, string>;
}

/**
 * Render what the configured targets need, once for all of them: one child
 * process per distinct SVG, each rendering every size that SVG is used for.
 */
export async function renderWebextIcons(
    icons: ResolvedWebextIcons,
    targets: readonly WebextTarget[],
    rasterize: (input: RasterizeInput) => Promise<Map<number, Uint8Array>> = rasterizeSvg,
): Promise<RenderedIcons> {
    const needsPng = targets.some((t) => !icons.svgTargets.has(t.id));
    const needsSvg = targets.some((t) => icons.svgTargets.has(t.id));
    const png = new Map<string, Uint8Array>();
    if (needsPng) {
        const jobs = new Map<string, { size: number; name: string }[]>();
        for (const [name, bySize] of icons.sources) {
            for (const [size, svg] of bySize) jobs.set(svg, [...(jobs.get(svg) ?? []), { size, name }]);
        }
        for (const [svg, uses] of jobs) {
            const sizes = [...new Set(uses.map((u) => u.size))];
            const rendered = await rasterize({ svg, sizes, command: 'gjsify webext' });
            for (const { size, name } of uses) png.set(`icons/${name}-${size}.png`, rendered.get(size) as Uint8Array);
        }
    }
    return { png, svg: needsSvg ? svgIconFiles(icons) : new Map() };
}

/** Write the icons one target receives into its folder. */
export function writeWebextIcons(
    rendered: RenderedIcons,
    icons: ResolvedWebextIcons,
    target: WebextTarget,
    dir: string,
): void {
    mkdirSync(join(dir, 'icons'), { recursive: true });
    if (icons.svgTargets.has(target.id)) {
        for (const [path, source] of rendered.svg) copyFileSync(source, join(dir, path));
    } else {
        for (const [path, bytes] of rendered.png) writeFileSync(join(dir, path), bytes);
    }
}
