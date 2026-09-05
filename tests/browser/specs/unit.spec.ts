import { test, expect } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

const HARNESS_PATH = '/tests/browser/harness/index.html';
const DONE_SELECTOR = '[data-tests-done="true"]';
const BUNDLE_TIMEOUT = 110_000;

interface GjsifyTestResults {
    passed: number;
    failed: number;
    /** Tests that ran. Was ASSERTIONS until #1557 renamed the two apart. */
    total: number;
    /** Assertions executed — the floor below is over this one, deliberately. */
    assertions: number;
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

        // `failed === 0` is satisfied by a bundle that registered NOTHING: `browserSignalDone()`
        // sets the results and `data-tests-done` unconditionally, so `run({})` reports 0/0/0 and
        // passes — measured through this harness. The floor is over ASSERTIONS and stays there:
        // a suite that runs tests which assert nothing is the third way to reach zero, and a
        // test count cannot see it. `results.total` is TESTS since #1557 renamed the two apart,
        // so the floor now reads `results.assertions`, which is the number it always meant.
        // Every browser entry clears it today (fewest ungated assertions reachable:
        // web/gamepad, 5). A floor cannot see a PARTIAL shrink — that is
        // `scripts/check-browser-test-registration.mjs`; the rest of the residual is in main.yml.
        expect(
            results.assertions,
            `${bundle.url} ran 0 assertions — the bundle registered no suite, its suites assert ` +
                'nothing, or every test stood down on an `on(…)` gate',
        ).toBeGreaterThan(0);

        const errorSummary = results.errors.map((e) => `  [${e.suite}] ${e.test}: ${e.message}`).join('\n');

        expect(results.failed, `${results.failed} of ${results.total} tests failed:\n${errorSummary}`).toBe(0);
    });
}
