import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

// Directories to scan for test.browser.mjs bundles, in discovery order.
// `node` pillar joins `web` + `dom`: 20+ Node-API packages declare
// `browser:"polyfill"` and need browser-side validation. `framework` is here
// because `@gjsify/stories` + `@gjsify/storybook-core` are pure-TS all-runtime
// packages that ship a `src/test.browser.mts` — while this list omitted the
// pillar, their bundles were built by `build:test:browser` and then silently
// never executed. Until a package has a `dist/test.browser.mjs`, an entry here
// is a no-op. Keep in sync with `build-bundles.mjs`' PACKAGE_DIRS.
const PACKAGE_DIRS = [
    { dir: join(REPO_ROOT, 'packages', 'web'), urlBase: '/packages/web' },
    { dir: join(REPO_ROOT, 'packages', 'dom'), urlBase: '/packages/dom' },
    { dir: join(REPO_ROOT, 'packages', 'node'), urlBase: '/packages/node' },
    { dir: join(REPO_ROOT, 'packages', 'framework'), urlBase: '/packages/framework' },
];

// Discovers all test.browser.mjs bundles under packages/{web,dom,node,framework}/<pkg>/dist/
export function discoverBundles() {
    const bundles = [];

    for (const { dir, urlBase } of PACKAGE_DIRS) {
        if (!existsSync(dir)) continue;

        // Derive the pillar label from the urlBase (`/packages/<pillar>`) so
        // a single source of truth drives both the discovery and the
        // Playwright spec-title. Falls back to 'unknown' if the urlBase
        // shape ever changes.
        const pillar = urlBase.split('/').pop() ?? 'unknown';

        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const bundlePath = join(dir, entry.name, 'dist', 'test.browser.mjs');
            if (existsSync(bundlePath)) {
                bundles.push({
                    packageName: entry.name,
                    pillar,
                    // URL path served by http-server from repo root
                    url: `${urlBase}/${entry.name}/dist/test.browser.mjs`,
                });
            }
        }
    }

    return bundles;
}
