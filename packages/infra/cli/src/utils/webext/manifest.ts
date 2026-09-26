// The manifest per target (ADR 0077 § 3): a module or a JSON template,
// composed WITHOUT converting keys between manifest versions, then checked
// against the folder it describes.
//
// The checks are the ones a browser would otherwise report against the
// manifest, far from the build that caused them: Chrome refuses to load a
// folder whose background script is missing ("Could not load background
// script") or that has `_locales/` without `default_locale`, and the store
// rejects the same zip for the same reasons, days later.

import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';

import type { WebextTarget } from './targets.js';

export type Manifest = Record<string, unknown>;

/** What a manifest module's default-exported function receives. */
export interface WebextManifestContext {
    target: string;
    browser: WebextTarget['browser'];
    manifestVersion: 2 | 3;
    mode: 'production' | 'development';
    /** `package.json#version`. */
    version: string;
    /** The effective `define` map (config, then `--define`). */
    define: Record<string, string>;
    /** The `{ size: path }` map for a declared icon, as this target receives it. */
    icons(name: string): Record<string, string>;
}

/** A loaded template: a function of the context, or an object with optional `$targets` overrides. */
export type ManifestTemplate = ((ctx: WebextManifestContext) => Manifest | Promise<Manifest>) | Manifest;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `over` onto `base`: objects merge, arrays and scalars replace,
 * `null` deletes. Arrays replace because "add a permission for Firefox" and
 * "drop a permission for Firefox" cannot both be spelled by concatenation.
 */
export function mergeManifest(base: Manifest, over: Manifest): Manifest {
    const out: Manifest = { ...base };
    for (const [key, value] of Object.entries(over)) {
        if (value === null) delete out[key];
        else if (isRecord(value) && isRecord(out[key])) out[key] = mergeManifest(out[key] as Manifest, value);
        else out[key] = value;
    }
    return out;
}

/** Apply a JSON template's `$targets` block for one target, and drop the block. */
export function applyTargetOverrides(template: Manifest, target: string): Manifest {
    const { $targets, ...base } = template;
    if ($targets === undefined) return base;
    if (!isRecord($targets)) throw new Error("gjsify webext: the manifest's `$targets` must be an object.");
    const over = $targets[target];
    if (over === undefined) return base;
    if (!isRecord(over)) throw new Error(`gjsify webext: \`$targets["${target}"]\` in the manifest must be an object.`);
    return mergeManifest(base, over);
}

/** Produce the manifest for one target from a loaded template. */
export async function composeManifest(template: ManifestTemplate, ctx: WebextManifestContext): Promise<Manifest> {
    const raw = typeof template === 'function' ? await template(ctx) : applyTargetOverrides(template, ctx.target);
    if (!isRecord(raw)) {
        throw new Error(`gjsify webext: the manifest for ${ctx.target} is not an object (got ${typeof raw}).`);
    }
    if (raw.version !== undefined) return raw;
    // Beside `name`, where a reader of manifest.json looks for it, rather than last.
    const out: Manifest = {};
    for (const [key, value] of Object.entries(raw)) {
        out[key] = value;
        if (key === 'name') out.version = ctx.version;
    }
    if (out.version === undefined) out.version = ctx.version;
    return out;
}

let loadCounter = 0;

/**
 * Load a manifest template. A `.json` is parsed; a module is imported and its
 * default export used.
 *
 * Every load is FRESH, because `webext dev` reloads the template on each
 * rebuild and both hosts cache modules by URL: on Node a query string makes a
 * new URL; under GJS the module is bundled (GJS cannot import `.ts`, nor a
 * module with `node:` imports) and the bundle copied to a unique file name,
 * because whether GJS's loader keeps a query string on a `file:` URL is not a
 * thing to depend on.
 */
export async function loadManifestTemplate(path: string): Promise<ManifestTemplate> {
    if (/\.json$/i.test(path)) {
        try {
            return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
        } catch (err) {
            throw new Error(`gjsify webext: ${path} is not valid JSON: ${(err as Error).message}`);
        }
    }
    let url: string;
    let cleanup: (() => void) | null = null;
    if (isGjs()) {
        const { BuildAction } = await import('../../actions/build.js');
        const bundled = await BuildAction.bundleFileForGjsCached(path, {
            cacheSubdir: 'webext',
            label: basename(path),
            cache: false,
            define: { 'import.meta.url': JSON.stringify(pathToFileURL(path).href) },
        });
        const copy = join(dirname(bundled), `manifest-${process.pid}-${++loadCounter}.mjs`);
        copyFileSync(bundled, copy);
        url = pathToFileURL(copy).href;
        cleanup = () => rmSync(copy, { force: true });
    } else {
        url = `${pathToFileURL(path).href}?t=${statSync(path).mtimeMs}-${++loadCounter}`;
    }
    try {
        const mod = (await import(url)) as { default?: unknown };
        const template = mod.default;
        if (typeof template !== 'function' && !isRecord(template)) {
            throw new Error(
                `gjsify webext: ${path} has no default export. Export the manifest object, or a function ` +
                    '`(ctx) => manifest` that receives the target.',
            );
        }
        return template as ManifestTemplate;
    } finally {
        cleanup?.();
    }
}

/** Keys that name a page, script, stylesheet or image inside the extension. */
function addPath(out: Set<string>, value: unknown): void {
    if (typeof value !== 'string' || value === '') return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes('*')) return;
    out.add(value.replace(/^\//, '').replace(/[?#].*$/, ''));
}

function addIconValue(out: Set<string>, value: unknown): void {
    if (typeof value === 'string') addPath(out, value);
    else if (isRecord(value)) for (const v of Object.values(value)) addPath(out, v);
}

/**
 * Every file inside the extension the manifest refers to by path.
 *
 * Deliberately a list of the keys browsers LOAD from, not a walk over every
 * string: `description` or a `commands` label that happens to look like a path
 * is not a reference.
 */
export function manifestFileReferences(manifest: Manifest): string[] {
    const out = new Set<string>();
    const background = manifest.background;
    if (isRecord(background)) {
        addPath(out, background.service_worker);
        addPath(out, background.page);
        if (Array.isArray(background.scripts)) for (const s of background.scripts) addPath(out, s);
    }
    if (Array.isArray(manifest.content_scripts)) {
        for (const cs of manifest.content_scripts) {
            if (!isRecord(cs)) continue;
            for (const key of ['js', 'css'])
                if (Array.isArray(cs[key])) for (const f of cs[key] as unknown[]) addPath(out, f);
        }
    }
    for (const key of ['action', 'browser_action', 'page_action', 'sidebar_action']) {
        const action = manifest[key];
        if (!isRecord(action)) continue;
        addPath(out, action.default_popup);
        addPath(out, action.default_panel);
        addIconValue(out, action.default_icon);
    }
    if (isRecord(manifest.options_ui)) addPath(out, manifest.options_ui.page);
    addPath(out, manifest.options_page);
    addPath(out, manifest.devtools_page);
    if (isRecord(manifest.side_panel)) addPath(out, manifest.side_panel.default_path);
    addIconValue(out, manifest.icons);
    if (isRecord(manifest.chrome_url_overrides))
        for (const v of Object.values(manifest.chrome_url_overrides)) addPath(out, v);
    if (Array.isArray(manifest.web_accessible_resources)) {
        for (const entry of manifest.web_accessible_resources) {
            if (typeof entry === 'string') addPath(out, entry);
            else if (isRecord(entry) && Array.isArray(entry.resources))
                for (const r of entry.resources) addPath(out, r);
        }
    }
    return [...out].sort();
}

/**
 * What is wrong with a composed manifest for the folder it will sit in.
 * Returns problem sentences; empty means the browser has nothing to refuse
 * that this build could have known about.
 */
export function checkManifest(manifest: Manifest, target: WebextTarget, dir: string): string[] {
    const problems: string[] = [];
    if (manifest.manifest_version !== target.manifestVersion) {
        problems.push(
            `manifest_version is ${JSON.stringify(manifest.manifest_version)}, and target ${target.id} is Manifest V${target.manifestVersion}. ` +
                'gjsify does not convert keys between versions — branch on `ctx.manifestVersion` in the manifest.',
        );
    }
    for (const ref of manifestFileReferences(manifest)) {
        if (!existsSync(join(dir, ref))) {
            problems.push(`the manifest names "${ref}", which the build did not write into ${target.id}/.`);
        }
    }
    const hasLocales = existsSync(join(dir, '_locales'));
    const defaultLocale = manifest.default_locale;
    if (hasLocales && typeof defaultLocale !== 'string') {
        problems.push('_locales/ exists but the manifest sets no default_locale; the browser refuses to load it.');
    } else if (!hasLocales && defaultLocale !== undefined) {
        problems.push(
            `the manifest sets default_locale "${String(defaultLocale)}" but there is no _locales/ directory.`,
        );
    } else if (
        typeof defaultLocale === 'string' &&
        !existsSync(join(dir, '_locales', defaultLocale, 'messages.json'))
    ) {
        problems.push(
            `default_locale is "${defaultLocale}" but _locales/${defaultLocale}/messages.json does not exist.`,
        );
    }
    return problems;
}
