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
}

// `needsWebgl` used to live here and in the manifest. It was declared on all
// eight showcases, parsed into `ShowcaseInfo`, and read by NOBODY — no command,
// no test, no website page. Removed rather than wired up, per the repo rule
// that a declaration without a check is a declaration that lies: the proof it
// had drifted is that `excalibur-jelly-jumper` carried `"needsWebgl": false`
// while Excalibur 0.32 is WebGL2-only. A field nobody reads is a field nobody
// maintains. If a WebGL pre-flight is wanted (the real motivation — on win32
// `@gjsify/webgl` declares no platform, so the showcase dies at `gi://Gwebgl`),
// it needs a READER and a conformance rule in the same change.
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
    // `showcases.json` lives at the CLI package root. Its position relative to
    // this module depends on how the CLI is loaded:
    //   - `lib/utils/discover-showcases.js` (Node/Bun/Deno) → `../../showcases.json`.
    //   - the committed `dist/cli.gjs.mjs` GJS bundle (`gjsify showcase` under
    //     gjs) → `import.meta.url` is `dist/cli.gjs.mjs`, so the manifest is one
    //     level up (`../showcases.json`), not two — without this the gjs CLI
    //     finds no manifest and `showcase` wrongly reports "No showcases found".
    const candidates = [join(here, '..', '..', 'showcases.json'), join(here, '..', 'showcases.json')];
    return candidates.find((c) => existsSync(c)) ?? candidates[0];
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
    }));

    showcases.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return showcases;
}

/** Find a single showcase by short name. */
export function findShowcase(name: string): ShowcaseInfo | undefined {
    return discoverShowcases().find((e) => e.name === name);
}
