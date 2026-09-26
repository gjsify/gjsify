// `gjsify webext build|zip|dev` — assemble one folder per target (ADR 0077 § 4).
//
// Every bundle is built ONCE into a staging directory and copied into each
// target; only the manifest and the icon files differ between targets. That is
// beifahrer's measured arrangement, and it is also what makes a target cheap:
// adding `edge-mv3` to a project costs a copy, not a rebuild.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { buildZip, type ZipEntry } from '../ship/zip.js';
import type { RasterizeInput } from '../ship/icons.js';
import type { ResolvedWebext } from './config.js';
import { renderWebextIcons, webextIconPaths, writeWebextIcons } from './icons.js';
import { checkManifest, composeManifest, loadManifestTemplate, type WebextManifestContext } from './manifest.js';
import { planPage } from './pages.js';
import type { WebextTarget } from './targets.js';

export interface BundleRequest {
    entry: string;
    outfile: string;
    format: 'esm' | 'iife';
    define: Record<string, string>;
    minify: boolean;
}

export interface WebextBuildOptions {
    config: ResolvedWebext;
    targets: readonly WebextTarget[];
    /** Absolute; the target folders are `<outDir>/<target>`. */
    outDir: string;
    mode: 'production' | 'development';
    /** Effective defines: the config's, then the command line's. */
    define: Record<string, string>;
    /**
     * Overwrite files instead of starting from an empty folder. `dev` needs it:
     * deleting the folder `web-ext run` watches makes Firefox unload the
     * extension mid-rebuild (measured in beifahrer).
     */
    inPlace: boolean;
    zip: boolean;
    /** Bundle one entry. Injectable so the assembly is testable without a bundler. */
    bundle: (request: BundleRequest) => Promise<void>;
    rasterize?: (input: RasterizeInput) => Promise<Map<number, Uint8Array>>;
    log?: (line: string) => void;
}

export interface WebextBuildResult {
    /** target id → absolute folder. */
    folders: Map<string, string>;
    /** target id → absolute zip path (only with `zip`). */
    zips: Map<string, string>;
}

/** The fixed ZIP timestamp when SOURCE_DATE_EPOCH is unset: 1980-01-01, the format's floor. */
const ZIP_EPOCH_FLOOR = 315532800;

/** One `SOURCE_DATE_EPOCH`-aware timestamp for every entry, so a rebuild zips to the same bytes. */
export function zipTimestamp(env: NodeJS.ProcessEnv = process.env): number {
    const epoch = Number(env.SOURCE_DATE_EPOCH);
    return Number.isFinite(epoch) && epoch >= ZIP_EPOCH_FLOOR ? epoch : ZIP_EPOCH_FLOOR;
}

/** Every file under `dir`, as archive entries relative to it. */
export function zipEntriesOf(dir: string): ZipEntry[] {
    const out: ZipEntry[] = [];
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else
                out.push({ path: relative(dir, full).split(/[\\/]/).join('/'), mode: 0o644, data: readFileSync(full) });
        }
    };
    walk(dir);
    return out;
}

export async function buildWebext(opts: WebextBuildOptions): Promise<WebextBuildResult> {
    const { config, targets, outDir, define } = opts;
    const log = opts.log ?? ((line: string) => console.log(line));
    const minify = opts.mode === 'production' && config.minify;
    const stage = join(outDir, '.stage');

    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    try {
        for (const [name, entry] of config.scripts) {
            await opts.bundle({ entry, outfile: join(stage, `${name}.js`), format: 'iife', define, minify });
        }
        const written = new Map<string, string>();
        for (const [name, htmlPath] of config.pages) {
            const plan = planPage(name, htmlPath, readFileSync(htmlPath, 'utf8'));
            for (const script of plan.scripts) {
                await opts.bundle({
                    entry: script.entry,
                    outfile: join(stage, script.output),
                    format: script.format,
                    define,
                    minify,
                });
            }
            for (const sheet of plan.stylesheets) {
                const previous = written.get(sheet.output);
                if (previous !== undefined && previous !== sheet.source) {
                    throw new Error(
                        `gjsify webext: pages link ${previous} and ${sheet.source}, which would both be written as ` +
                            `${sheet.output}. Rename one.`,
                    );
                }
                written.set(sheet.output, sheet.source);
                cpSync(sheet.source, join(stage, sheet.output));
            }
            writeFileSync(join(stage, `${name}.html`), plan.html);
        }

        const icons = config.icons;
        const rendered = icons ? await renderWebextIcons(icons, targets, opts.rasterize) : null;
        const template = await loadManifestTemplate(config.manifest);
        const result: WebextBuildResult = { folders: new Map(), zips: new Map() };

        for (const target of targets) {
            const dir = join(outDir, target.id);
            if (!opts.inPlace) rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
            // Public files first, so a built file of the same name wins.
            if (config.publicDir) cpSync(config.publicDir, dir, { recursive: true });
            if (config.localesDir) cpSync(config.localesDir, join(dir, '_locales'), { recursive: true });
            cpSync(stage, dir, { recursive: true });
            if (icons && rendered) writeWebextIcons(rendered, icons, target, dir);

            const ctx: WebextManifestContext = {
                target: target.id,
                browser: target.browser,
                manifestVersion: target.manifestVersion,
                mode: opts.mode,
                version: config.version,
                define,
                icons: (name) => {
                    if (!icons) {
                        throw new Error(
                            `gjsify webext: the manifest asks for icon "${name}" and \`gjsify.webext.icons\` is not declared.`,
                        );
                    }
                    return webextIconPaths(icons, name, target);
                },
            };
            const manifest = await composeManifest(template, ctx);
            writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
            const problems = checkManifest(manifest, target, dir);
            if (problems.length > 0) {
                throw new Error(`gjsify webext: ${target.id} would not load:\n  - ${problems.join('\n  - ')}`);
            }
            result.folders.set(target.id, dir);
            log(`built ${relative(process.cwd(), dir) || dir}`);

            if (opts.zip) {
                const file = join(outDir, `${config.name}-${config.version}-${target.id}.zip`);
                writeFileSync(file, buildZip(zipEntriesOf(dir), zipTimestamp()));
                result.zips.set(target.id, file);
                log(`zipped ${relative(process.cwd(), file) || file} (${Math.round(statSync(file).size / 1024)} KiB)`);
            }
        }
        return result;
    } finally {
        rmSync(stage, { recursive: true, force: true });
    }
}
