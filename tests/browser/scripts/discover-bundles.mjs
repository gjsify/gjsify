import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

// Directories to scan for test.browser.mjs bundles, in discovery order.
const PACKAGE_DIRS = [
    { dir: join(REPO_ROOT, 'packages', 'web'), urlBase: '/packages/web' },
    { dir: join(REPO_ROOT, 'packages', 'dom'), urlBase: '/packages/dom' },
];

// Discovers all test.browser.mjs bundles under packages/{web,dom}/<pkg>/dist/
export function discoverBundles() {
    const bundles = [];

    for (const { dir, urlBase } of PACKAGE_DIRS) {
        if (!existsSync(dir)) continue;

        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const bundlePath = join(dir, entry.name, 'dist', 'test.browser.mjs');
            if (existsSync(bundlePath)) {
                bundles.push({
                    packageName: entry.name,
                    // URL path served by http-server from repo root
                    url: `${urlBase}/${entry.name}/dist/test.browser.mjs`,
                });
            }
        }
    }

    return bundles;
}
