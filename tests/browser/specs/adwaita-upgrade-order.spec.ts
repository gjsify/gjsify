import { expect, test } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

// DECLARED adwaita markup, parsed BEFORE the package that defines it — the one order a
// spec inside the bundle cannot reach, because by the time it runs every name is already
// registered.
//
// WHAT IT MEASURED. `customElements.define` upgrades every matching element already in
// the document, immediately, so the two calls at the foot of
// `packages/web/adwaita-web/src/elements/adw-tab-view.ts` are a sequence, not a pair.
// With the page defined first, each declared `<adw-tab-page>` ran its
// `attributeChangedCallback` while its `<adw-tab-view>` parent was still an ordinary
// HTMLElement — and the callback reaches for that parent. On the built documentation
// site `/getting-started/` (five `CommandTabs` windows, 19 pages) that was 19 uncaught
// `this.closest(...)?.syncDeclaredPage is not a function`, against 0 on
// `/adwaita/theming/`, which declares none. The fixture below is the same shape at
// three pages and reported three.
//
// `page.setContent` is the instrument, not a fixture file: it writes the markup into a
// document that already has the harness's origin, and a `type="module"` script is
// deferred until parsing is done — which is exactly how the site loads the package, and
// why no smaller construction reproduces this. Anything built with `document.createElement`
// after the module has run gets two upgraded elements and passes either way.
//
// It reuses `dist/test.browser.mjs` for the same reason `adwaita-keyboard.spec.ts` does:
// importing the package root is what registers the elements, and that entry already does
// it. The cost is one more run of the package suite; the benefit is that the assertion
// below covers every uncaught error the whole entry produces, not just this one's.

const HARNESS_PATH = '/tests/browser/harness/index.html';
const DONE_SELECTOR = '[data-tests-done="true"]';
const BUNDLE_TIMEOUT = 110_000;

/** The `CommandTabs` shape: a view with declared pages, each carrying a live `title`. */
const DECLARED_MARKUP = `<div id="declared">
    <adw-tab-view no-close expand-tabs>
        <adw-tab-page title="One"><p>first</p></adw-tab-page>
        <adw-tab-page title="Two"><p>second</p></adw-tab-page>
        <adw-tab-page title="Three"><p>third</p></adw-tab-page>
    </adw-tab-view>
</div>`;

const adwaita = discoverBundles().find((bundle) => bundle.packageName === 'adwaita-web');

// BOUND TO THE STAGED SET, as `unit.spec.ts` and `adwaita-keyboard.spec.ts` are: a
// selective CI run stages only the affected closure, so an unconditional test would fail
// a PR over a package it never touched.
if (adwaita === undefined) {
    test('adwaita-web declared-markup upgrade order — bundle not staged', () => {
        console.warn(
            'No packages/web/adwaita-web/dist/test.browser.mjs — the upgrade-order spec did not run.\n' +
                'Build it: node tests/browser/scripts/build-bundles.mjs --include @gjsify/adwaita-web',
        );
    });
} else {
    const bundleUrl = adwaita.url;

    test('declared adwaita markup upgrades with no uncaught error', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // The harness first, for its origin: `setContent` keeps the document URL, and the
        // bundle is referenced by an absolute path served from the repo root.
        await page.goto(HARNESS_PATH);
        await page.setContent(`${DECLARED_MARKUP}<script type="module" src="${bundleUrl}"></script>`, {
            waitUntil: 'commit',
        });
        // Done is the cheapest signal that the import — and with it the registration — ran.
        await page.waitForSelector(DONE_SELECTOR, { timeout: BUNDLE_TIMEOUT });

        expect(errors, `uncaught errors on a page of declared adwaita markup:\n  ${errors.join('\n  ')}`).toEqual([]);

        // Not merely quiet — the markup became the widget. Asserted after the fact
        // because a guard that only swallowed the notification would satisfy the count
        // above while leaving the tabs untitled.
        const rendered = await page.evaluate(() => {
            const view = document.querySelector('#declared adw-tab-view');
            return {
                chips: Array.from(view?.querySelectorAll('.adw-tab-title') ?? []).map((n) => n.textContent),
                shown: Array.from(view?.querySelectorAll('.adw-tab-page') ?? []).map((n) => !(n as HTMLElement).hidden),
            };
        });
        expect(rendered.chips).toEqual(['One', 'Two', 'Three']);
        expect(rendered.shown).toEqual([true, false, false]);
    });
}
