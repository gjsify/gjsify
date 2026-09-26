// `package.json#gjsify.webext` — read, validated and resolved to absolute paths
// in one place, so every subcommand (build, zip, dev) works from the same answer.
//
// Every problem is collected before throwing: a config with three mistakes
// should cost one run to fix, not three.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { DEFAULT_WEBEXT_TARGETS, parseWebextTarget, type WebextTarget } from './targets.js';

/** A source SVG per icon name: one file, or one per size ceiling (`{ "default": …, "32": … }`). */
export type WebextIconSource = string | Record<string, string>;

export interface WebextIconsConfig {
    sizes?: number[];
    sources: Record<string, WebextIconSource>;
    /** Targets that receive the SVG files themselves instead of rendered PNGs. */
    svg?: string[];
}

/** The block as a project writes it. */
export interface WebextConfig {
    name?: string;
    targets?: string[];
    manifest?: string;
    scripts?: Record<string, string>;
    pages?: Record<string, string>;
    icons?: WebextIconsConfig;
    public?: string;
    locales?: string;
    outDir?: string;
    define?: Record<string, string>;
    watch?: string[];
    minify?: boolean;
}

export interface ResolvedWebextIcons {
    sizes: number[];
    /** name → absolute SVG path per size. */
    sources: Map<string, Map<number, string>>;
    svgTargets: Set<string>;
}

/** The block after validation, with every path absolute. */
export interface ResolvedWebext {
    root: string;
    name: string;
    version: string;
    targets: WebextTarget[];
    manifest: string;
    scripts: Map<string, string>;
    pages: Map<string, string>;
    icons: ResolvedWebextIcons | null;
    publicDir: string | null;
    localesDir: string | null;
    outDir: string;
    define: Record<string, string>;
    watch: string[];
    minify: boolean;
}

export const DEFAULT_ICON_SIZES = [16, 32, 48, 128];

const MANIFEST_CANDIDATES = ['manifest.ts', 'manifest.mts', 'manifest.js', 'manifest.mjs', 'manifest.json'];

/** Output names become file names in every target (`<name>.js`, `<name>.html`). */
const OUTPUT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface PackageShape {
    name?: string;
    version?: string;
    gjsify?: { webext?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The zip base name a package gets when it declares none: its npm name without the scope. */
export function defaultArtifactName(packageName: string | undefined): string {
    const bare = (packageName ?? 'extension').replace(/^@[^/]+\//, '');
    return bare === '' ? 'extension' : bare;
}

/**
 * Pick the SVG an icon uses at `size`: the smallest numeric ceiling that is
 * `>= size`, else `default`. Returns undefined when neither covers the size.
 */
export function iconSourceForSize(source: WebextIconSource, size: number): string | undefined {
    if (typeof source === 'string') return source;
    const ceilings = Object.keys(source)
        .filter((key) => /^\d+$/.test(key))
        .map(Number)
        .sort((a, b) => a - b);
    const ceiling = ceilings.find((value) => size <= value);
    return ceiling === undefined ? source.default : source[String(ceiling)];
}

/**
 * Validate `gjsify.webext` and resolve it against the package root.
 *
 * `exists` is injectable so the specs can describe a project without writing
 * one to disk.
 */
export function resolveWebextConfig(
    pkg: PackageShape,
    root: string,
    exists: (path: string, kind: 'file' | 'dir') => boolean = defaultExists,
): ResolvedWebext {
    const problems: string[] = [];
    const raw = pkg.gjsify?.webext;
    if (raw === undefined) {
        throw new Error(
            'gjsify webext: this package declares no `gjsify.webext` block in package.json. ' +
                'Add one naming at least the manifest and one script or page — see `gjsify webext build --help`.',
        );
    }
    if (!isRecord(raw)) throw new Error('gjsify webext: `gjsify.webext` must be an object.');
    const block = raw as WebextConfig;
    const abs = (path: string): string => (isAbsolute(path) ? path : resolve(root, path));

    const need = (label: string, path: string, kind: 'file' | 'dir'): string => {
        const full = abs(path);
        if (!exists(full, kind)) problems.push(`${label} "${path}" is not a ${kind === 'dir' ? 'directory' : 'file'}.`);
        return full;
    };

    const targets: WebextTarget[] = [];
    const targetIds = block.targets ?? [...DEFAULT_WEBEXT_TARGETS];
    if (!Array.isArray(targetIds) || targetIds.length === 0) {
        problems.push('`targets` must be a non-empty array of target names.');
    } else {
        for (const id of targetIds) {
            try {
                if (targets.some((t) => t.id === id)) problems.push(`target "${id}" is listed twice.`);
                else targets.push(parseWebextTarget(String(id)));
            } catch (err) {
                problems.push((err as Error).message.replace(/^gjsify webext: /, ''));
            }
        }
    }

    let manifest = '';
    if (block.manifest !== undefined) {
        manifest = need('`manifest`', block.manifest, 'file');
    } else {
        const found = MANIFEST_CANDIDATES.find((candidate) => exists(join(root, candidate), 'file'));
        if (found === undefined) {
            problems.push(`no \`manifest\` declared and none of ${MANIFEST_CANDIDATES.join(', ')} exists.`);
        } else {
            manifest = join(root, found);
        }
    }

    const outputs = new Map<string, string>();
    const claim = (output: string, by: string): void => {
        const previous = outputs.get(output);
        if (previous !== undefined) problems.push(`${by} and ${previous} both write ${output}.`);
        else outputs.set(output, by);
    };

    const readEntries = (key: 'scripts' | 'pages'): Map<string, string> => {
        const out = new Map<string, string>();
        const value = block[key];
        if (value === undefined) return out;
        if (!isRecord(value)) {
            problems.push(`\`${key}\` must map an output name to a source file.`);
            return out;
        }
        for (const [name, source] of Object.entries(value)) {
            if (!OUTPUT_NAME_RE.test(name)) {
                problems.push(`\`${key}.${name}\`: an output name is a plain file name (letters, digits, . _ -).`);
                continue;
            }
            if (typeof source !== 'string') {
                problems.push(`\`${key}.${name}\` must be a path.`);
                continue;
            }
            out.set(name, need(`\`${key}.${name}\``, source, 'file'));
            if (key === 'scripts') claim(`${name}.js`, `\`scripts.${name}\``);
            else claim(`${name}.html`, `\`pages.${name}\``);
        }
        return out;
    };
    const scripts = readEntries('scripts');
    const pages = readEntries('pages');
    if (scripts.size === 0 && pages.size === 0) {
        problems.push('declare at least one entry under `scripts` or `pages`; there is nothing to build.');
    }
    // A page's first script is written as `<page>.js`, so it competes with `scripts` for the name.
    for (const name of pages.keys()) {
        if (scripts.has(name))
            problems.push(`\`scripts.${name}\` and the script of \`pages.${name}\` both write ${name}.js.`);
    }

    let icons: ResolvedWebextIcons | null = null;
    if (block.icons !== undefined) {
        if (!isRecord(block.icons) || !isRecord(block.icons.sources)) {
            problems.push('`icons` must be an object with a `sources` map (icon name → SVG).');
        } else {
            const sizes = block.icons.sizes ?? DEFAULT_ICON_SIZES;
            if (!Array.isArray(sizes) || sizes.length === 0 || sizes.some((s) => !Number.isInteger(s) || s <= 0)) {
                problems.push('`icons.sizes` must be a non-empty list of positive integers.');
            }
            const svgTargets = new Set(block.icons.svg ?? []);
            for (const id of svgTargets) {
                if (!targets.some((t) => t.id === id)) {
                    problems.push(`\`icons.svg\` names "${id}", which is not one of this package's targets.`);
                }
            }
            const sources = new Map<string, Map<number, string>>();
            for (const [name, source] of Object.entries(block.icons.sources)) {
                if (!OUTPUT_NAME_RE.test(name)) {
                    problems.push(`\`icons.sources.${name}\`: an icon name is a plain file name.`);
                    continue;
                }
                if (typeof source !== 'string' && !isRecord(source)) {
                    problems.push(`\`icons.sources.${name}\` must be an SVG path or a map of size ceilings to SVGs.`);
                    continue;
                }
                const bySize = new Map<number, string>();
                for (const size of sizes) {
                    const svg = iconSourceForSize(source as WebextIconSource, size);
                    if (svg === undefined) {
                        problems.push(`\`icons.sources.${name}\` has no SVG for ${size} px — add a "default".`);
                        continue;
                    }
                    if (!/\.svg$/i.test(svg)) problems.push(`\`icons.sources.${name}\`: "${svg}" is not an .svg file.`);
                    bySize.set(size, abs(svg));
                }
                for (const svg of new Set(bySize.values())) {
                    if (!exists(svg, 'file')) problems.push(`\`icons.sources.${name}\`: "${svg}" does not exist.`);
                }
                sources.set(name, bySize);
            }
            icons = { sizes, sources, svgTargets };
        }
    }

    const optionalDir = (key: 'public' | 'locales', fallback: string): string | null => {
        const declared = block[key];
        if (declared !== undefined) return need(`\`${key}\``, declared, 'dir');
        const implicit = join(root, fallback);
        return exists(implicit, 'dir') ? implicit : null;
    };
    const publicDir = optionalDir('public', 'public');
    const localesDir = optionalDir('locales', '_locales');

    const define = block.define ?? {};
    if (!isRecord(define) || Object.values(define).some((v) => typeof v !== 'string')) {
        problems.push('`define` must map identifiers to JS expressions given as strings.');
    }
    const watch = block.watch ?? [];
    if (!Array.isArray(watch) || watch.some((w) => typeof w !== 'string')) {
        problems.push('`watch` must be a list of directories.');
    }

    if (problems.length > 0) {
        throw new Error(
            `gjsify webext: \`gjsify.webext\` in ${join(root, 'package.json')}:\n  - ${problems.join('\n  - ')}`,
        );
    }

    return {
        root,
        name: block.name ?? defaultArtifactName(pkg.name),
        version: pkg.version ?? '0.0.0',
        targets,
        manifest,
        scripts,
        pages,
        icons,
        publicDir,
        localesDir,
        outDir: abs(block.outDir ?? '.output'),
        define: define as Record<string, string>,
        watch: (watch as string[]).map(abs),
        minify: block.minify ?? true,
    };
}

function defaultExists(path: string, kind: 'file' | 'dir'): boolean {
    if (!existsSync(path)) return false;
    const stat = statSync(path);
    return kind === 'dir' ? stat.isDirectory() : stat.isFile();
}

/** Narrow the configured targets to the ones a command was asked for. */
export function selectTargets(config: ResolvedWebext, requested: readonly string[] | undefined): WebextTarget[] {
    if (requested === undefined || requested.length === 0) return config.targets;
    return requested.map((id) => {
        const found = config.targets.find((t) => t.id === id);
        if (found) return found;
        // Parse first: an unknown spelling deserves the vocabulary message, not "not configured".
        parseWebextTarget(id);
        throw new Error(
            `gjsify webext: target "${id}" is not in \`gjsify.webext.targets\` (${config.targets.map((t) => t.id).join(', ')}).`,
        );
    });
}
