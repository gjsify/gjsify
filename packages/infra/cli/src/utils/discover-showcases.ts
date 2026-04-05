// Dynamic discovery of installed showcase packages (@gjsify/example-*).
// Scans the CLI's own package.json dependencies at runtime.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface ShowcaseInfo {
    /** Short name, e.g. "three-postprocessing-pixel" */
    name: string;
    /** Full npm package name, e.g. "@gjsify/example-dom-three-postprocessing-pixel" */
    packageName: string;
    /** Category: "dom" or "node" */
    category: string;
    /** Description from showcase's package.json */
    description: string;
    /** Absolute path to the GJS bundle (resolved from "main" field) */
    bundlePath: string;
}

const EXAMPLE_PREFIX = '@gjsify/example-';

/** Extract short name and category from package name. */
function parseShowcaseName(packageName: string): { name: string; category: string } | null {
    // @gjsify/example-dom-three-postprocessing-pixel → category=dom, name=three-postprocessing-pixel
    const suffix = packageName.slice(EXAMPLE_PREFIX.length);
    const dashIdx = suffix.indexOf('-');
    if (dashIdx === -1) return null;
    return {
        category: suffix.slice(0, dashIdx),
        name: suffix.slice(dashIdx + 1),
    };
}

/**
 * Discover all installed showcase packages by scanning the CLI's own dependencies.
 * Returns showcases sorted by category then name.
 */
export function discoverShowcases(): ShowcaseInfo[] {
    const require = createRequire(import.meta.url);
    const cliPkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    let cliPkg: Record<string, unknown>;
    try {
        cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf-8')) as Record<string, unknown>;
    } catch {
        return [];
    }

    const deps = cliPkg['dependencies'] as Record<string, string> | undefined;
    if (!deps) return [];

    const showcases: ShowcaseInfo[] = [];

    for (const packageName of Object.keys(deps)) {
        if (!packageName.startsWith(EXAMPLE_PREFIX)) continue;

        const parsed = parseShowcaseName(packageName);
        if (!parsed) continue;

        try {
            const pkgJsonPath = require.resolve(`${packageName}/package.json`);
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
            const main = pkg['main'] as string | undefined;
            if (!main) continue;

            showcases.push({
                name: parsed.name,
                packageName,
                category: parsed.category,
                description: (pkg['description'] as string) ?? '',
                bundlePath: join(dirname(pkgJsonPath), main),
            });
        } catch {
            // Package listed as dep but not resolvable — skip silently
        }
    }

    showcases.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return showcases;
}

/** Find a single showcase by short name. */
export function findShowcase(name: string): ShowcaseInfo | undefined {
    return discoverShowcases().find(e => e.name === name);
}
