// Static discovery of showcase packages from `showcases.json`.
//
// Earlier versions read showcases from the CLI's own `package.json#dependencies`
// — every showcase had to be a direct CLI dependency. That made the CLI tarball
// blow up with each new showcase and required a CLI rebuild to publish a new
// one. Static manifest decouples both: the CLI reads the manifest at runtime,
// `gjsify showcase <name>` delegates to `gjsify dlx <package>`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ShowcaseInfo {
    /** Short name, e.g. "three-postprocessing-pixel" */
    name: string;
    /** Full npm package name, e.g. "@gjsify/example-dom-three-postprocessing-pixel" */
    packageName: string;
    /** Category: "dom" or "node" */
    category: string;
    /** Description for the list view */
    description: string;
    /** Whether the showcase needs the gwebgl native prebuild. */
    needsWebgl: boolean;
}

interface ManifestEntry {
    name: string;
    package: string;
    category: string;
    description?: string;
    needsWebgl?: boolean;
}

interface Manifest {
    showcases: ManifestEntry[];
}

function manifestPath(): string {
    // `showcases.json` lives at the package root: ../../showcases.json from lib/utils/.
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'showcases.json');
}

/**
 * Read the curated showcase list from `showcases.json`. Returns showcases
 * sorted by category then name. An empty list (or missing manifest) yields
 * an empty array — `gjsify showcase` then prints the empty-state message.
 */
export function discoverShowcases(): ShowcaseInfo[] {
    const path = manifestPath();
    if (!existsSync(path)) return [];

    let manifest: Manifest;
    try {
        manifest = JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
    } catch {
        return [];
    }
    if (!Array.isArray(manifest.showcases)) return [];

    const showcases: ShowcaseInfo[] = manifest.showcases.map((e) => ({
        name: e.name,
        packageName: e.package,
        category: e.category,
        description: e.description ?? '',
        needsWebgl: Boolean(e.needsWebgl),
    }));

    showcases.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return showcases;
}

/** Find a single showcase by short name. */
export function findShowcase(name: string): ShowcaseInfo | undefined {
    return discoverShowcases().find((e) => e.name === name);
}
