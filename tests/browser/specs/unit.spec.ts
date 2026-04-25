import { test, expect } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

const HARNESS_PATH = '/tests/browser/harness/index.html';
const DONE_SELECTOR = '[data-tests-done="true"]';
const BUNDLE_TIMEOUT = 30_000;

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
            'No test.browser.mjs bundles found. Run build:test:browser in web/dom packages first.\n' +
            'From repo root: yarn test:browser:build'
        );
    });
}

for (const bundle of bundles) {
    test(`@gjsify/${bundle.packageName} — browser unit tests`, async ({ page }) => {
        const bundleUrl = encodeURIComponent(bundle.url);
        await page.goto(`${HARNESS_PATH}?bundle=${bundleUrl}`);

        await page.waitForSelector(DONE_SELECTOR, { timeout: BUNDLE_TIMEOUT });

        const results: GjsifyTestResults = await page.evaluate(
            () => (window as any).__gjsify_test_results
        );

        expect(results, 'window.__gjsify_test_results not set — @gjsify/unit may not have run').toBeDefined();

        const errorSummary = results.errors
            .map(e => `  [${e.suite}] ${e.test}: ${e.message}`)
            .join('\n');

        expect(
            results.failed,
            `${results.failed} of ${results.total} tests failed:\n${errorSummary}`
        ).toBe(0);
    });
}
