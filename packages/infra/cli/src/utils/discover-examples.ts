// Dynamic discovery of installed @gjsify/example-* packages.
// Scans the CLI's own package.json dependencies at runtime.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export interface ExampleInfo {
    /** Short name, e.g. "three-geometry-shapes" */
    name: string;
    /** Full npm package name, e.g. "@gjsify/example-dom-three-geometry-shapes" */
    packageName: string;
    /** Category: "dom" or "node" */
    category: string;
    /** Description from example's package.json */
    description: string;
    /** Absolute path to the GJS bundle (resolved from "main" field) */
    bundlePath: string;
}

const EXAMPLE_PREFIX = '@gjsify/example-';

/** Extract short name and category from package name. */
function parseExampleName(packageName: string): { name: string; category: string } | null {
    // @gjsify/example-dom-three-geometry-shapes → category=dom, name=three-geometry-shapes
    // @gjsify/example-node-cli-node-path → category=node, name=cli-node-path
    const suffix = packageName.slice(EXAMPLE_PREFIX.length);
    const dashIdx = suffix.indexOf('-');
    if (dashIdx === -1) return null;
    return {
        category: suffix.slice(0, dashIdx),
        name: suffix.slice(dashIdx + 1),
    };
}

/**
 * Discover all installed example packages by scanning the CLI's own dependencies.
 * Returns examples sorted by category then name.
 */
export function discoverExamples(): ExampleInfo[] {
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

    const examples: ExampleInfo[] = [];

    for (const packageName of Object.keys(deps)) {
        if (!packageName.startsWith(EXAMPLE_PREFIX)) continue;

        const parsed = parseExampleName(packageName);
        if (!parsed) continue;

        try {
            const pkgJsonPath = require.resolve(`${packageName}/package.json`);
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
            const main = pkg['main'] as string | undefined;
            if (!main) continue;

            examples.push({
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

    examples.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return examples;
}

/** Find a single example by short name. */
export function findExample(name: string): ExampleInfo | undefined {
    return discoverExamples().find(e => e.name === name);
}
