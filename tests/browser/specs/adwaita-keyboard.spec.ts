import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

// REAL key presses against adwaita-web's keyboard contracts — four reproductions, one
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

// BOUND TO THE STAGED SET, the way `unit.spec.ts` is, and that is not caution. A
// selective CI run stages only the affected closure (`build-bundles.mjs $INCLUDE_ARGS`),
// so a PR touching a browser-capable package that is not this one stages a NON-EMPTY
// bundle set with no adwaita-web in it — and an unconditional test would then fail that
// PR over a package it never touched. The other half, that this file must not vanish
// unnoticed, is held statically by `scripts/check-adwaita-keyboard-contract.mjs`, which
// fails when it is gone: a claim about the tree belongs in a reader of the tree, and that
// one runs on every PR instead of only the ones that stage this bundle.
if (adwaita === undefined) {
    test('adwaita-web keyboard operability — bundle not staged', () => {
        console.warn(
            'No packages/web/adwaita-web/dist/test.browser.mjs — the real-key keyboard spec did not run.\n' +
                'Build it: node tests/browser/scripts/build-bundles.mjs --include @gjsify/adwaita-web',
        );
    });
} else {
    const bundleUrl = adwaita.url;
    test('adwaita-web keyboard operability (real key presses)', ({ page }) => driveKeys(page, bundleUrl));
}

async function driveKeys(page: Page, bundleUrl: string) {
    await page.goto(`${HARNESS_PATH}?bundle=${encodeURIComponent(bundleUrl)}`);
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

    // ---- Shape 1b: a modal whose requested initial focus cannot take focus ----------
    // The trap's listener sits on the dialog HOST, so a `present()` that leaves focus
    // outside is not a cosmetic miss: no key ever reaches the trap. Measured before the
    // surface filtered its `initialFocus` result, with the default response DISABLED —
    // `focus()` on a disabled button is a no-op — the dialog opened with focus still on
    // `#behind`, and a real Escape did nothing at all: `open` stayed true. Only a routed
    // key press shows that second half.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const behind = document.createElement('button');
        behind.id = 'behind';
        behind.textContent = 'Behind';
        // oxlint-disable-next-line typescript/no-explicit-any -- the element's own response API, unavailable to a Playwright spec
        const dialog = document.createElement('adw-alert-dialog') as any;
        dialog.id = 'alert';
        dialog.setAttribute('heading', 'Heading');
        dialog.innerHTML =
            '<adw-alert-response id="ok">OK</adw-alert-response>' +
            '<adw-alert-response id="cancel">Cancel</adw-alert-response>';
        document.body.append(behind, dialog);
        dialog.setDefaultResponse('ok');
        dialog.setResponseEnabled('ok', false);
        behind.focus();
        dialog.setAttribute('open', '');
    });

    expect(await focusedId()).toContain('inside:');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.getElementById('alert')?.hasAttribute('open'))).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('behind');

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

    // ---- Shape 3: every activatable row is a tab stop, in order ---------------------
    // This block used to assert the opposite — Tab from `#before` landed on `#after` and
    // the whole group was invisible to a keyboard. The rows now carry the tab stop
    // libadwaita gives them for free by extending GtkListBoxRow.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const before = document.createElement('button');
        before.id = 'before';
        before.textContent = 'Before';
        const group = document.createElement('adw-preferences-group');
        group.setAttribute('title', 'Group');
        group.innerHTML =
            '<adw-action-row title="Action" activatable></adw-action-row>' +
            '<adw-action-row title="Label only"></adw-action-row>' +
            '<adw-button-row title="Button"></adw-button-row>' +
            '<adw-expander-row title="Expander"></adw-expander-row>' +
            '<adw-switch-row title="Switch"></adw-switch-row>';
        const after = document.createElement('button');
        after.id = 'after';
        after.textContent = 'After';
        document.body.append(before, group, after);
        before.focus();
    });

    /** What has focus, named the way a reader can act on. */
    const focused = () =>
        page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return 'body';
            if (el.id) return `#${el.id}`;
            if (el.classList.contains('adw-expander-row-header')) return 'expander-header';
            return el.localName;
        });

    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        const where = await focused();
        order.push(where);
        if (where === '#after') break;
    }
    // The plain action row is absent ON PURPOSE — a label that takes Tab makes every
    // static row in a group a stop. So is the group itself: it is a container.
    expect(order).toEqual(['adw-action-row', 'adw-button-row', 'expander-header', 'adw-switch-row', '#after']);

    // `<adw-preferences-group>` is a GROUP upstream (adw-preferences-group.c:319), which is
    // why the rows inside carry no `listitem` role — outside a list that is worse than none.
    expect(await page.evaluate(() => document.querySelector('adw-preferences-group')?.getAttribute('role'))).toBe(
        'group',
    );

    // The keys GtkListBoxRow activates on, and the state the C keeps in step with them.
    const effects = await page.evaluate(() => {
        const row = document.querySelector('adw-action-row[activatable]') as HTMLElement;
        let activated = 0;
        row.addEventListener('activated', () => activated++);
        row.focus();
        for (const key of ['Enter', ' ']) {
            row.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        }
        const header = document.querySelector('.adw-expander-row-header') as HTMLElement;
        const expandedBefore = header.getAttribute('aria-expanded');
        header.focus();
        header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        return { activated, expandedBefore, expandedAfter: header.getAttribute('aria-expanded') };
    });
    // adw-expander-row.c:657 keeps GTK_ACCESSIBLE_STATE_EXPANDED on the header in step.
    expect(effects).toEqual({ activated: 2, expandedBefore: 'false', expandedAfter: 'true' });
}
