import { test, expect } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

const HARNESS_PATH = '/tests/browser/harness/index.html';
const DONE_SELECTOR = '[data-tests-done="true"]';
const BUNDLE_TIMEOUT = 110_000;

interface GjsifyTestResults {
    passed: number;
    failed: number;
    total: number;
    errors: Array<{ suite: string; test: string; message: string }>;
}

const bundles = discoverBundles();

if (bundles.length === 0) {
    test('no browser test bundles found', () => {
        console.warn(
            'No test.browser.mjs bundles found — nothing to run.\n' +
                'Build them first: node tests/browser/scripts/build-bundles.mjs\n' +
                '(or, for one package: cd packages/<pillar>/<pkg> && gjsify run build:test:browser)',
        );
    });
}

for (const bundle of bundles) {
    test(`${bundle.pillar}/@gjsify/${bundle.packageName} — browser unit tests`, async ({ page }) => {
        const bundleUrl = encodeURIComponent(bundle.url);
        await page.goto(`${HARNESS_PATH}?bundle=${bundleUrl}`);

        await page.waitForSelector(DONE_SELECTOR, { timeout: BUNDLE_TIMEOUT });

        // oxlint-disable-next-line typescript/no-explicit-any -- __gjsify_test_results is a custom runtime global not in lib.dom.d.ts
        const results: GjsifyTestResults = await page.evaluate(() => (window as any).__gjsify_test_results);

        expect(results, 'window.__gjsify_test_results not set — @gjsify/unit may not have run').toBeDefined();

        // `failed === 0` alone is satisfied by a bundle that registered NOTHING:
        // `browserSignalDone()` sets the results and `data-tests-done` unconditionally, so
        // `run({})` reports 0/0/0 and every assertion below it holds. Measured by driving a
        // patched `run({})` through this harness — green. What this floor does NOT catch is a
        // PARTIAL shrink: 38 of adwaita-web's 39 suites can vanish and one is still > 0. The
        // static half of that lives in `scripts/check-browser-test-registration.mjs`, and the
        // rest of the residual is written down in `main.yml`'s `browser` job.
        expect(results.total, `${bundle.url} reported 0 tests — the bundle registered no suite`).toBeGreaterThan(0);

        const errorSummary = results.errors.map((e) => `  [${e.suite}] ${e.test}: ${e.message}`).join('\n');

        expect(results.failed, `${results.failed} of ${results.total} tests failed:\n${errorSummary}`).toBe(0);
    });
}
