// Discovers test.browser.mjs bundles from packages/web/* and packages/dom/*
import { readdirSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PORT = 8087;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Returns all discovered test bundles as { packageName, repoRelativePath, url }.
 * Only packages that have already built dist/test.browser.mjs are included.
 */
export function discoverBundles() {
    const results = [];
    for (const dir of ['packages/web', 'packages/dom']) {
        const fullDir = join(REPO_ROOT, dir);
        if (!existsSync(fullDir)) continue;
        for (const pkg of readdirSync(fullDir, { withFileTypes: true })) {
            if (!pkg.isDirectory()) continue;
            const bundle = join(fullDir, pkg.name, 'dist', 'test.browser.mjs');
            if (!existsSync(bundle)) continue;
            const rel = relative(REPO_ROOT, bundle).replace(/\\/g, '/');
            results.push({
                packageName: pkg.name,
                repoRelativePath: rel,
                url: `${BASE_URL}/${rel}`,
            });
        }
    }
    return results;
}
