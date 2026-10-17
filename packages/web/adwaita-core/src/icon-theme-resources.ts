// The icon lookup over a `Gtk.IconTheme`'s resource paths, renderer-free — ADR 0116 § 4. A port
// draws what this answers; which file answers a name is decided here once, as gtkicontheme.c
// decides it:
//
//   NAMES. `GtkImage` builds a `GThemedIcon` without default fallbacks, so `X` asks for
//   [X, X-symbolic] and `X-symbolic` for [X-symbolic, X] (gio/gthemedicon.c); `choose_icon` then
//   puts each name's direction variant in front of it ([X-ltr, X, …]).
//
//   THEMES. The current theme first, hicolor last, and only hicolor sees the resource paths, as
//   `<path>/<hicolor subdir>/`. A port's current theme is its compiled Adwaita subset, which only
//   holds symbolic glyphs; the caller answers for it. `real_choose_icon` first tries the LEADING
//   symbolic names in every theme, then every name in every theme (theme outer, name inner), then
//   the unthemed files placed directly under a resource path. So `X` draws the current theme's
//   `X-symbolic` before hicolor's `X`.
//
//   SIZES. One hicolor directory per `Directories` entry of GTK's hicolor.index.theme; entries
//   with the same size fields share one size bucket in which the first directory holding a name
//   wins, and the buckets compete through `theme_dir_size_difference` /
//   `compare_dir_size_matches`, ported with their quirks (Scalable compares the UNSCALED size
//   against `max * scale`; equal candidates go to the later bucket). Inside a directory a
//   `.symbolic.png` beats `.png` beats `.svg` beats `.xpm` (`best_suffix`).
//
//   SYMBOLIC is a property of the FILE, as in gtkiconpaintable.c `icon_uri_is_symbolic`:
//   `-symbolic.svg`, `-symbolic-ltr.svg`, `-symbolic-rtl.svg` and `.symbolic.png` are recoloured,
//   everything else is drawn as it is.
//
//   CACHE. The scan is built on the first lookup and kept until the theme's resource path changes,
//   as GTK keeps it; registering a resource later is not noticed until then, in GTK as here.
//
// Reference: gtk gtk/gtkicontheme.c (real_choose_icon, choose_icon, theme_lookup_icon,
//   theme_subdir_load, scan_resource_directory, add_unthemed_icon), gtk gtk/gtkiconpaintable.c,
//   the hicolor.index.theme GTK embeds as /org/gtk/libgtk/icons/, glib gio/gthemedicon.c
// Copyright (c) GNOME contributors (GTK, GLib). LGPLv2.1+.

import { resources_enumerate_children } from './gio-resource.js';
import { IconTheme } from './gtk-platform.js';

/** gtkiconcacheprivate.h `IconCacheFlag`: the bit order IS the preference order. */
const Suffix = { NONE: 0, XPM: 1 << 0, SVG: 1 << 1, PNG: 1 << 2, SYMBOLIC_PNG: 1 << 4 } as const;
type Suffix = (typeof Suffix)[keyof typeof Suffix];

const SUFFIX_TEXT: Record<number, string> = {
    [Suffix.XPM]: '.xpm',
    [Suffix.SVG]: '.svg',
    [Suffix.PNG]: '.png',
    [Suffix.SYMBOLIC_PNG]: '.symbolic.png',
};

function suffixOf(name: string): Suffix {
    if (name.endsWith('.symbolic.png')) return Suffix.SYMBOLIC_PNG;
    if (name.endsWith('.png')) return Suffix.PNG;
    if (name.endsWith('.svg')) return Suffix.SVG;
    if (name.endsWith('.xpm')) return Suffix.XPM;
    return Suffix.NONE;
}

function bestSuffix(suffixes: number): Suffix {
    if (suffixes & Suffix.SYMBOLIC_PNG) return Suffix.SYMBOLIC_PNG;
    if (suffixes & Suffix.PNG) return Suffix.PNG;
    if (suffixes & Suffix.SVG) return Suffix.SVG;
    if (suffixes & Suffix.XPM) return Suffix.XPM;
    return Suffix.NONE;
}

function stripSuffix(name: string, suffix: Suffix): string {
    return name.slice(0, name.length - (SUFFIX_TEXT[suffix] ?? '').length);
}

/** gtkicontheme.c `icon_name_is_symbolic`. */
function isSymbolicName(name: string): boolean {
    return name.endsWith('-symbolic') || name.endsWith('-symbolic-ltr') || name.endsWith('-symbolic-rtl');
}

/** gtkiconpaintable.c `icon_uri_is_symbolic`. */
function isSymbolicFile(path: string): boolean {
    return (
        path.endsWith('-symbolic.svg') ||
        path.endsWith('.symbolic.png') ||
        path.endsWith('-symbolic-ltr.svg') ||
        path.endsWith('-symbolic-rtl.svg')
    );
}

// --- hicolor.index.theme, as data --------------------------------------------------------------

type DirType = 'Fixed' | 'Scalable' | 'Threshold';

interface DirSize {
    readonly type: DirType;
    readonly size: number;
    readonly minSize: number;
    readonly maxSize: number;
    readonly threshold: number;
    readonly scale: number;
}

const CONTEXTS = [
    'actions',
    'animations',
    'apps',
    'categories',
    'devices',
    'emblems',
    'emotes',
    'filesystems',
    'intl',
    'mimetypes',
    'places',
    'status',
    'stock/chart',
    'stock/code',
    'stock/data',
    'stock/form',
    'stock/image',
    'stock/io',
    'stock/media',
    'stock/navigation',
    'stock/net',
    'stock/object',
    'stock/table',
    'stock/text',
];

const THRESHOLD_SIZES = [16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192];

/** The `scalable/<context>` directories whose MaxSize is 512; the others stop at 256. */
const SCALABLE_TO_512 = new Set([
    'devices',
    'emotes',
    'intl',
    'places',
    'stock/chart',
    'stock/data',
    'stock/image',
    'stock/media',
    'stock/net',
    'stock/table',
]);

function dirSize(type: DirType, size: number, minSize: number, maxSize: number, scale: number): DirSize {
    return { type, size, minSize, maxSize, threshold: 2, scale };
}

/** hicolor's `Directories`, in its order, with the fields `theme_subdir_load` reads. */
function hicolorDirectories(): { subdir: string; size: DirSize }[] {
    const dirs: { subdir: string; size: DirSize }[] = [];
    for (const size of THRESHOLD_SIZES) {
        for (const context of CONTEXTS) {
            dirs.push({ subdir: `${size}x${size}/${context}`, size: dirSize('Threshold', size, size, size, 1) });
            dirs.push({ subdir: `${size}x${size}@2/${context}`, size: dirSize('Threshold', size, size, size, 2) });
        }
    }
    for (const size of [256, 512]) {
        for (const context of CONTEXTS) {
            dirs.push({ subdir: `${size}x${size}/${context}`, size: dirSize('Scalable', size, 64, size, 1) });
            dirs.push({ subdir: `${size}x${size}@2/${context}`, size: dirSize('Scalable', size, 64, size, 2) });
        }
    }
    for (const context of CONTEXTS) {
        const max = SCALABLE_TO_512.has(context) ? 512 : 256;
        dirs.push({ subdir: `scalable/${context}`, size: dirSize('Scalable', 128, 1, max, 1) });
    }
    dirs.push({ subdir: 'symbolic/apps', size: dirSize('Scalable', 16, 8, 512, 1) });
    return dirs;
}

function sameSize(a: DirSize, b: DirSize): boolean {
    return (
        a.type === b.type &&
        a.size === b.size &&
        a.minSize === b.minSize &&
        a.maxSize === b.maxSize &&
        a.threshold === b.threshold &&
        a.scale === b.scale
    );
}

/** gtkicontheme.c `theme_dir_size_difference`. */
function sizeDifference(dir: DirSize, size: number, scale: number): number {
    const scaledSize = size * scale;
    const scaledDirSize = dir.size * dir.scale;
    switch (dir.type) {
        case 'Fixed':
            return Math.abs(scaledSize - scaledDirSize);
        case 'Scalable':
            if (scaledSize < dir.minSize * dir.scale) return dir.minSize * dir.scale - scaledSize;
            if (size > dir.maxSize * dir.scale) return scaledSize - dir.maxSize * dir.scale;
            return 0;
        case 'Threshold': {
            const min = (dir.size - dir.threshold) * dir.scale;
            const max = (dir.size + dir.threshold) * dir.scale;
            if (scaledSize < min) return min - scaledSize;
            if (scaledSize > max) return scaledSize - max;
            return 0;
        }
    }
}

/** gtkicontheme.c `compare_dir_size_matches`: whether `a` is the better match. */
function betterMatch(a: DirSize, differenceA: number, b: DirSize, differenceB: number, size: number, scale: number) {
    if (differenceA === 0) {
        if (differenceB !== 0) return true;
    } else {
        if (a.size >= size && b.size < size) return true;
        if (a.size < size && b.size >= size) return false;
        if (differenceA < differenceB) return true;
        if (differenceA > differenceB) return false;
    }
    if (a.scale === scale && b.scale !== scale) return true;
    if (a.scale !== scale && b.scale === scale) return false;
    if (a.type !== 'Scalable' && b.type === 'Scalable') return true;
    if (a.type === 'Scalable' && b.type !== 'Scalable') return false;
    return Math.abs(size * scale - a.size * a.scale) <= Math.abs(size * scale - b.size * b.scale);
}

// --- The scan ----------------------------------------------------------------------------------

interface Bucket {
    readonly size: DirSize;
    /** Icon name → the directory (with trailing `/`) and the best suffix found there. */
    readonly icons: Map<string, { dir: string; suffix: Suffix }>;
}

interface Unthemed {
    svg?: string;
    noSvg?: string;
}

interface Scan {
    readonly serial: number;
    readonly buckets: readonly Bucket[];
    readonly unthemed: ReadonlyMap<string, Unthemed>;
}

function children(path: string): string[] {
    try {
        return resources_enumerate_children(path, 0);
    } catch {
        return [];
    }
}

function withSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}

function buildScan(paths: readonly string[], serial: number): Scan {
    const buckets: Bucket[] = [];
    for (const { subdir, size } of hicolorDirectories()) {
        let bucket = buckets.find((candidate) => sameSize(candidate.size, size));
        if (!bucket) {
            bucket = { size, icons: new Map() };
            buckets.push(bucket);
        }
        for (const path of paths) {
            const dir = withSlash(`${withSlash(path)}${subdir}`);
            const found = new Map<string, number>();
            for (const child of children(dir)) {
                const suffix = suffixOf(child);
                if (suffix === Suffix.NONE) continue;
                const name = stripSuffix(child, suffix);
                found.set(name, (found.get(name) ?? 0) | suffix);
            }
            for (const [name, suffixes] of found) {
                if (!bucket.icons.has(name)) bucket.icons.set(name, { dir, suffix: bestSuffix(suffixes) });
            }
        }
    }

    const unthemed = new Map<string, Unthemed>();
    for (const path of paths) {
        for (const child of children(path)) {
            const suffix = suffixOf(child);
            if (suffix === Suffix.NONE) continue;
            const file = `${withSlash(path)}${child}`;
            const name = stripSuffix(child, suffix);
            const entry = unthemed.get(name);
            if (!entry) {
                unthemed.set(name, suffix === Suffix.SVG ? { svg: file } : { noSvg: file });
            } else if (suffix === Suffix.SVG) {
                entry.svg ??= file;
            } else if (entry.noSvg === undefined || suffix > suffixOf(entry.noSvg)) {
                entry.noSvg = file;
            }
        }
    }
    return { serial, buckets, unthemed };
}

const scans = new WeakMap<IconTheme, Scan>();

function scanOf(theme: IconTheme): Scan {
    const serial = IconTheme.scan(theme);
    let scan = scans.get(theme);
    if (scan?.serial !== serial) {
        scan = buildScan(theme.get_resource_path() ?? [], serial);
        scans.set(theme, scan);
    }
    return scan;
}

/** gtkicontheme.c `theme_lookup_icon` over the hicolor buckets: the file path, or null. */
function hicolorFile(scan: Scan, name: string, size: number, scale: number): string | null {
    let best: { bucket: Bucket; difference: number; dir: string; suffix: Suffix } | null = null;
    for (const bucket of scan.buckets) {
        const file = bucket.icons.get(name);
        if (!file || file.suffix === Suffix.NONE) continue;
        const difference = sizeDifference(bucket.size, size, scale);
        if (best === null || betterMatch(bucket.size, difference, best.bucket.size, best.difference, size, scale)) {
            best = { bucket, difference, dir: file.dir, suffix: file.suffix };
        }
    }
    return best === null ? null : `${best.dir}${name}${SUFFIX_TEXT[best.suffix]}`;
}

/** `real_choose_icon`'s unthemed step: an SVG beats an XPM but not a PNG. */
function unthemedFile(scan: Scan, name: string): string | null {
    const entry = scan.unthemed.get(name);
    if (!entry) return null;
    if (entry.svg !== undefined && (entry.noSvg === undefined || suffixOf(entry.noSvg) < Suffix.PNG)) return entry.svg;
    return entry.noSvg ?? null;
}

// --- The lookup --------------------------------------------------------------------------------

/** The text direction of the widget drawing the icon; `null` is GTK_TEXT_DIR_NONE. */
export type IconDirection = 'ltr' | 'rtl' | null;

/**
 * The names `gtk_icon_theme_lookup_by_gicon` tries for a `GtkImage`'s `icon-name`, in order:
 * the `GThemedIcon` names, each preceded by its direction variant.
 */
export function iconLookupNames(iconName: string, direction: IconDirection): string[] {
    const other = iconName.endsWith('-symbolic') ? iconName.slice(0, -'-symbolic'.length) : `${iconName}-symbolic`;
    const names: string[] = [];
    for (const name of [iconName, other]) {
        if (direction !== null) names.push(`${name}-${direction}`);
        names.push(name);
    }
    return names;
}

/** What answered a lookup that a resource path took part in. */
export type ResourceIconMatch =
    /** The port's own theme has the symbolic glyph `name`, and GTK would draw it first. */
    | { readonly kind: 'theme'; readonly name: string }
    /** A file in a registered resource; `symbolic` files are recoloured, the rest drawn as-is. */
    | { readonly kind: 'resource'; readonly name: string; readonly path: string; readonly symbolic: boolean };

/** What one lookup asks for, in GTK's terms. */
export interface ResourceIconRequest {
    /** The `GThemedIcon` names, as {@link iconLookupNames} builds them. */
    readonly names: readonly string[];
    /** In application pixels. */
    readonly size: number;
    readonly scale: number;
    /** Whether the port's current theme holds the symbolic glyph `name`; only asked for symbolic names. */
    readonly themeHas: (name: string) => boolean;
}

/**
 * Resolve `request` over `theme`'s resource paths in GTK's order. `null` when NO resource
 * answers any of the names: the lookup is then the port's own theme alone, and `themeHas` was
 * not asked.
 */
export function lookupResourceIcon(theme: IconTheme, request: ResourceIconRequest): ResourceIconMatch | null {
    const scan = scanOf(theme);
    const { names, themeHas } = request;
    // `size` is read only once a resource holds one of the names: a port may measure it, and on
    // the web measuring flushes style, which starts CSS transitions mid-render.
    const held = (name: string) =>
        scan.unthemed.has(name) ||
        scan.buckets.some((bucket) => (bucket.icons.get(name)?.suffix ?? Suffix.NONE) !== Suffix.NONE);
    if (!names.some(held)) return null;
    const { size, scale } = request;
    const hicolor = names.map((name) => hicolorFile(scan, name, size, scale));
    const unthemed = names.map((name) => unthemedFile(scan, name));
    if (hicolor.every((path) => path === null) && unthemed.every((path) => path === null)) return null;

    const inTheme = (name: string) => isSymbolicName(name) && themeHas(name);
    /** `theme_lookup_icon` in hicolor: the resource file. */
    const inHicolor = (i: number): ResourceIconMatch | null => {
        const path = hicolor[i];
        return path === null ? null : { kind: 'resource', name: names[i], path, symbolic: isSymbolicFile(path) };
    };

    const leading: number[] = [];
    for (let i = 0; i < names.length && isSymbolicName(names[i]); i++) leading.push(i);
    for (const i of leading) if (inTheme(names[i])) return { kind: 'theme', name: names[i] };
    for (const i of leading) {
        const match = inHicolor(i);
        if (match !== null) return match;
    }
    for (let i = 0; i < names.length; i++) if (inTheme(names[i])) return { kind: 'theme', name: names[i] };
    for (let i = 0; i < names.length; i++) {
        const match = inHicolor(i);
        if (match !== null) return match;
    }
    for (let i = 0; i < names.length; i++) {
        const path = unthemed[i];
        if (path !== null) return { kind: 'resource', name: names[i], path, symbolic: isSymbolicFile(path) };
    }
    return null;
}
