// Static discovery of showcase packages from `showcases.json`.
//
// A manifest read at runtime, not CLI `dependencies`: a showcase must not have to
// be a direct CLI dependency, or every new one grows the CLI tarball and needs a
// CLI rebuild to publish. `gjsify showcase <name>` delegates to `gjsify dlx`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ShowcaseInfo {
    /** Short name, the `gjsify showcase <name>` argument. */
    name: string;
    /** Full npm package name, e.g. "@gjsify/example-dom-three-postprocessing-pixel". */
    packageName: string;
    /** `"dom"` or `"node"`. */
    category: string;
    description: string;
}

// `needsWebgl` post-mortem (the field is gone from here and from the manifest):
// it was declared on all eight showcases and read by NOBODY, and a field nobody
// reads is a field nobody maintains — `excalibur-jelly-jumper` shipped
// `"needsWebgl": false` while Excalibur 0.32 is WebGL2-only. A WebGL pre-flight is
// still wanted (on win32 `@gjsify/webgl` declares no platform, so the showcase dies
// at `gi://Gwebgl`), but it needs a READER and a conformance rule in one change.
interface ManifestEntry {
    name: string;
    package: string;
    category: string;
    description?: string;
}

interface Manifest {
    showcases: ManifestEntry[];
}

function manifestPath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    // `showcases.json` sits at the CLI package root, but its depth below this
    // module depends on how the CLI was loaded: two levels from
    // `lib/utils/discover-showcases.js` (Node/Bun/Deno), one from the committed
    // `dist/cli.gjs.mjs` bundle. Try both, or the gjs CLI finds no manifest and
    // `showcase` wrongly reports that there are none.
    const candidates = [join(here, '..', '..', 'showcases.json'), join(here, '..', 'showcases.json')];
    return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

/**
 * Read the curated showcase list from `showcases.json`, sorted by category then
 * name. A missing or unparseable manifest yields `[]`, letting `gjsify showcase`
 * print its empty-state message instead of failing.
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
    }));

    showcases.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return showcases;
}

/** Find a single showcase by short name. */
export function findShowcase(name: string): ShowcaseInfo | undefined {
    return discoverShowcases().find((e) => e.name === name);
}
