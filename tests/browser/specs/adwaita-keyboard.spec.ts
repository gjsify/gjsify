import { test, expect } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

// REAL key presses against adwaita-web's keyboard contracts — three reproductions, one
// per shape measured broken.
//
// It exists beside `packages/web/adwaita-web/src/keyboard-operable.spec.ts` (which holds
// the same contracts far more thoroughly) for one reason that file's header spells out:
// a DISPATCHED event has no default action, so the escape itself — press Tab inside
// `<adw-alert-dialog>`, land on a view-switcher button behind the scrim — is only
// reproducible by a key press the browser routes. Hence `page.keyboard.press`.
//
// It reuses `dist/test.browser.mjs` rather than a second bundle: importing the package
// root is what registers the custom elements, and that entry already does it. The cost
// is one extra run of the package suite (~12 s) against a second build artifact, a
// second `build:test:browser`-shaped script and a second case for
// `scripts/check-browser-test-registration.mjs`.

const HARNESS_PATH = '/tests/browser/harness/index.html';
const DONE_SELECTOR = '[data-tests-done="true"]';
const BUNDLE_TIMEOUT = 110_000;

const adwaita = discoverBundles().find((bundle) => bundle.packageName === 'adwaita-web');

// A MISSING bundle fails rather than skips. Skipping would take the only real-key
// coverage in the repo out of the run with nothing saying so, which is the shape this
// whole area keeps being bitten by; `main.yml` stages every bundle before this job.
test('adwaita-web keyboard operability (real key presses)', async ({ page }) => {
    expect(
        adwaita,
        'no packages/web/adwaita-web/dist/test.browser.mjs — build it first: node tests/browser/scripts/build-bundles.mjs',
    ).toBeDefined();

    await page.goto(`${HARNESS_PATH}?bundle=${encodeURIComponent(adwaita!.url)}`);
    // Done is the cheapest signal that the import — and with it the registration — ran.
    await page.waitForSelector(DONE_SELECTOR, { timeout: BUNDLE_TIMEOUT });

    // ---- Shape 1: a real Tab must not leave a modal --------------------------------
    // `#outside` is the reproduction: focus landed on the element after the dialog.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const opener = document.createElement('button');
        opener.id = 'opener';
        opener.textContent = 'Open';
        const dialog = document.createElement('adw-alert-dialog');
        dialog.id = 'alert';
        dialog.setAttribute('heading', 'Heading');
        dialog.innerHTML =
            '<adw-alert-response id="cancel">Cancel</adw-alert-response>' +
            '<adw-alert-response id="ok" appearance="suggested">OK</adw-alert-response>';
        const outside = document.createElement('button');
        outside.id = 'outside';
        outside.textContent = 'Outside';
        document.body.append(opener, dialog, outside);
        opener.focus();
        dialog.setAttribute('open', '');
        // Stand on the LAST control inside: the next Tab is the one that used to leave.
        const buttons = dialog.querySelectorAll<HTMLElement>('.adw-alert-dialog-response');
        buttons[buttons.length - 1].focus();
    });

    const focusedId = () =>
        page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            if (!active) return 'none';
            const dialog = document.getElementById('alert');
            const where = dialog?.contains(active) ? 'inside' : 'outside';
            return `${where}:${active.id || active.className}`;
        });

    expect(await focusedId()).toContain('inside:');
    await page.keyboard.press('Tab');
    expect(await focusedId()).toContain('inside:');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // Three presses is past the two controls the dialog has: an untrapped dialog is out
    // of it by now, and was measured landing on the element after the dialog.
    expect(await focusedId()).toContain('inside:');

    // Closing hands focus back to the opener rather than leaving it wherever it escaped.
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('opener');

    // ---- Shape 2: a real arrow press must move a roving tabindex --------------------
    await page.evaluate(() => {
        document.body.replaceChildren();
        const sidebar = document.createElement('adw-sidebar');
        sidebar.id = 'sidebar';
        sidebar.innerHTML =
            '<adw-sidebar-section title="Section">' +
            ['One', 'Two', 'Three'].map((title) => `<adw-sidebar-item title="${title}"></adw-sidebar-item>`).join('') +
            '</adw-sidebar-section>';
        document.body.append(sidebar);
        sidebar.querySelector<HTMLElement>('[role="option"]')?.focus();
    });

    const rowState = () =>
        page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll<HTMLElement>('#sidebar [role="option"]'));
            return { focus: rows.indexOf(document.activeElement as HTMLElement), roving: rows.map((r) => r.tabIndex) };
        });

    // The precondition IS the defect: two of the three rows are out of the tab order, so
    // an arrow key is the only way left to reach them.
    expect(await rowState()).toEqual({ focus: 0, roving: [0, -1, -1] });
    await page.keyboard.press('ArrowDown');
    expect(await rowState()).toEqual({ focus: 1, roving: [-1, 0, -1] });
    await page.keyboard.press('End');
    expect(await rowState()).toEqual({ focus: 2, roving: [-1, -1, 0] });
    await page.keyboard.press('Home');
    expect(await rowState()).toEqual({ focus: 0, roving: [0, -1, -1] });

    // ---- Shape 3: the rows are NOT reachable, and that is on the record -------------
    // Ledgered in status/open-todos.md, not fixed here: making the row family focusable
    // moves tab order on every consumer page. Asserted so the day it changes, this says so.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const before = document.createElement('button');
        before.id = 'before';
        before.textContent = 'Before';
        const group = document.createElement('adw-preferences-group');
        group.setAttribute('title', 'Group');
        group.innerHTML =
            '<adw-action-row title="Action" activatable></adw-action-row>' +
            '<adw-button-row title="Button"></adw-button-row>' +
            '<adw-expander-row title="Expander"></adw-expander-row>';
        const after = document.createElement('button');
        after.id = 'after';
        after.textContent = 'After';
        document.body.append(before, group, after);
        before.focus();
    });

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('after');
});
