import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const WEB_PACKAGES_DIR = join(REPO_ROOT, 'packages', 'web');

// Discovers all test.browser.mjs bundles under packages/web/<pkg>/dist/
export function discoverBundles() {
    if (!existsSync(WEB_PACKAGES_DIR)) return [];

    const bundles = [];

    for (const entry of readdirSync(WEB_PACKAGES_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const bundlePath = join(WEB_PACKAGES_DIR, entry.name, 'dist', 'test.browser.mjs');
        if (existsSync(bundlePath)) {
            bundles.push({
                packageName: entry.name,
                // URL path served by http-server from repo root
                url: `/packages/web/${entry.name}/dist/test.browser.mjs`,
            });
        }
    }

    return bundles;
}
