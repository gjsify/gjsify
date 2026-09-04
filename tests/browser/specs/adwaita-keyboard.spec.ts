import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

// REAL key presses against adwaita-web's keyboard contracts — five reproductions, one
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

    // ---- Shape 5: a toggle group is ONE tab stop, entered on the active toggle ------
    // Measured before the roving tabindex, same page and same keys: the Tab order was
    // `toggle[0] → toggle[1] → toggle[2] → #after` — three separate stops — with the
    // group role `null`, every item role `null`, `tabIndex` `[0, 0, 0]`, the state spelled
    // `aria-pressed` and `aria-checked` absent, and ArrowRight, ArrowDown, Home and End
    // all leaving focus on `toggle[0]`.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const before = document.createElement('button');
        before.id = 'before';
        before.textContent = 'Before';
        const group = document.createElement('adw-toggle-group');
        group.id = 'toggles';
        group.setAttribute('active', '1');
        group.innerHTML = ['One', 'Two', 'Three'].map((label) => `<adw-toggle label="${label}"></adw-toggle>`).join('');
        const after = document.createElement('button');
        after.id = 'after';
        after.textContent = 'After';
        document.body.append(before, group, after);
        before.focus();
    });

    /** Which toggle has focus, plus the tabindex row and the checked row beside it. */
    const toggleState = () =>
        page.evaluate(() => {
            const items = Array.from(document.querySelectorAll<HTMLElement>('#toggles [role="radio"]'));
            const active = document.activeElement as HTMLElement | null;
            return {
                focus: items.indexOf(active as HTMLElement),
                // Named only once focus has LEFT the group, so "still inside" and "landed
                // on an unnamed element" cannot read the same.
                outside: active === null || active.closest('#toggles') !== null ? null : active.id,
                roving: items.map((item) => item.tabIndex),
                checked: items.map((item) => item.getAttribute('aria-checked')),
            };
        });

    await page.keyboard.press('Tab');
    // Tab enters on the ACTIVE toggle, never the first — `adw_toggle_group_grab_focus`
    // (adw-toggle-group.c:1066) grabs the active toggle's button.
    expect(await toggleState()).toEqual({
        focus: 1,
        outside: null,
        roving: [-1, 0, -1],
        checked: ['false', 'true', 'false'],
    });

    // Tab from the MIDDLE toggle, before any arrow key moves it: this is the press that
    // separates one tab stop from three, because at the last toggle a group with three
    // stops would leave too. `adw_toggle_group_focus` propagates TAB_FORWARD and
    // TAB_BACKWARD (adw-toggle-group.c:1059-1060) instead of walking to the next toggle.
    await page.keyboard.press('Tab');
    expect((await toggleState()).outside).toBe('after');

    // And back in. Shift+Tab is the other half of the same C branch, and it re-enters on
    // the ACTIVE toggle rather than the last one — the roving tabindex is the only thing
    // the browser can see.
    await page.keyboard.press('Shift+Tab');
    expect(await toggleState()).toEqual({
        focus: 1,
        outside: null,
        roving: [-1, 0, -1],
        checked: ['false', 'true', 'false'],
    });

    await page.keyboard.press('ArrowRight');
    expect(await toggleState()).toEqual({
        focus: 2,
        outside: null,
        roving: [-1, -1, 0],
        checked: ['false', 'false', 'true'],
    });

    // The other axis stays the page's: upstream `focus_sort_up_down`
    // (adw-widget-utils.c:339-342) drops every sibling with no horizontal overlap, which
    // in a row of toggles is all of them, so ArrowDown propagates out of the group.
    const downMoved = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('#toggles [role="radio"]'));
        const before = document.activeElement;
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        (before as HTMLElement).dispatchEvent(event);
        return { moved: document.activeElement !== before, prevented: event.defaultPrevented, count: items.length };
    });
    expect(downMoved).toEqual({ moved: false, prevented: false, count: 3 });

    expect(await page.evaluate(() => document.getElementById('toggles')?.getAttribute('role'))).toBe('radiogroup');

    // ---- Shape 6: a portable menu is traversable, page by page (ADR 0042) -----------
    // The roving tabindex on a menu row moved into `PopoverMenuView` when the two menu
    // buttons started sharing one popup. `check-adwaita-keyboard-contract.mjs` holds that
    // a keydown listener EXISTS; only a real press proves the keys move focus — and only
    // a real press exercises the `preventDefault` that keeps a focused <button> from
    // ALSO activating natively, which a dispatched event cannot reproduce at all.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const el = document.createElement('gtk-menu-button') as HTMLElement & {
            menuModel: unknown;
            actions: unknown;
        };
        el.id = 'menu';
        document.body.append(el);
        el.actions = { 'app.export': { enabled: false }, 'app.new': {} };
        el.menuModel = [
            { label: 'New', action: 'app.new' },
            { section: [{ label: 'Export', action: 'app.export' }, { label: 'Print' }] },
            { label: 'More', submenu: [{ label: 'Rename' }, { label: 'Duplicate' }] },
        ];
        (el as HTMLElement).addEventListener('menu-item-activated', (event) => {
            (window as unknown as { chosen: unknown }).chosen = (event as CustomEvent<{ path: number[] }>).detail.path;
        });
        (el.querySelector('.adw-menu-button-button') as HTMLElement).click();
        (el.querySelectorAll<HTMLElement>('.adw-popover-item')[0] as HTMLElement).focus();
    });

    /** The label of the row that has focus — what a reader would name it. */
    const focusedRow = () =>
        page.evaluate(
            () =>
                document.activeElement?.querySelector('.adw-menu-button-item-label')?.textContent ??
                document.activeElement?.localName ??
                'none',
        );

    expect(await focusedRow()).toBe('New');
    // Straight past the row the action group disabled: a disabled <button> cannot take
    // focus, so an arrow that lands on it is a press that does nothing.
    await page.keyboard.press('ArrowDown');
    expect(await focusedRow()).toBe('Print');
    await page.keyboard.press('ArrowDown');
    expect(await focusedRow()).toBe('More');
    // A menu popover WRAPS — `resolvePopoverKey` is modular, unlike the tab lists above.
    await page.keyboard.press('ArrowDown');
    expect(await focusedRow()).toBe('New');
    await page.keyboard.press('End');
    expect(await focusedRow()).toBe('More');

    // ArrowRight opens the submenu — `gtk_model_button_focus`, gtkmodelbutton.c:1189-1195.
    await page.keyboard.press('ArrowRight');
    expect(await focusedRow()).toBe('Rename');
    expect(
        await page.evaluate(() =>
            [...document.querySelectorAll('#menu .adw-popover-item')].map(
                (row) => row.querySelector('.adw-menu-button-item-label')?.textContent,
            ),
        ),
    ).toEqual(['More', 'Rename', 'Duplicate']);

    // ArrowLeft answers only on the back row (:1182-1188), so from the middle it does not.
    await page.keyboard.press('ArrowLeft');
    expect(await focusedRow()).toBe('Rename');
    await page.keyboard.press('ArrowUp');
    expect(await focusedRow()).toBe('More');
    await page.keyboard.press('ArrowLeft');
    expect(
        await page.evaluate(() =>
            [...document.querySelectorAll('#menu .adw-popover-item')].map(
                (row) => row.querySelector('.adw-menu-button-item-label')?.textContent,
            ),
        ),
    ).toEqual(['New', 'Export', 'Print', 'More']);

    // Leaving a page returns focus to the top of the one it returns TO, which is what
    // makes the next press countable.
    expect(await focusedRow()).toBe('New');

    // Enter activates the focused row ONCE — the native activation is prevented — and
    // reports a PATH, which is the only thing that names a row inside a section.
    await page.keyboard.press('ArrowDown');
    expect(await focusedRow()).toBe('Print');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as { chosen: unknown }).chosen)).toEqual([1, 1]);

    // ---- Shape 6b: a page change may not strand focus OUTSIDE an open popup ---------
    // K1, and the reason it needs a REAL press: the stranding is only visible in what
    // Tab does next. Both page changes focused a hard-coded index of every row, so a
    // submenu whose first item is disabled put focus on <body> — and Tab then walked to
    // the control BEHIND the open popover, which is the incident the keyboard gate's own
    // header records for modal surfaces.
    await page.evaluate(() => {
        document.body.replaceChildren();
        const el = document.createElement('gtk-menu-button') as HTMLElement & {
            menuModel: unknown;
            actions: unknown;
        };
        el.id = 'dimmed';
        const after = document.createElement('button');
        after.id = 'behind';
        after.textContent = 'Behind';
        document.body.append(el, after);
        el.actions = { 'app.off': { enabled: false } };
        el.menuModel = [{ label: 'More', submenu: [{ label: 'SubDim', action: 'app.off' }, { label: 'SubLive' }] }];
        (el.querySelector('.adw-menu-button-button') as HTMLElement).click();
        (el.querySelector('.adw-popover-item') as HTMLElement).focus();
    });

    await page.keyboard.press('ArrowRight');
    // Inside the popup, on the first row a key can actually reach.
    expect(
        await page.evaluate(() => ({
            inside: document.getElementById('dimmed')?.contains(document.activeElement) ?? false,
            label: document.activeElement?.querySelector('.adw-menu-button-item-label')?.textContent ?? 'none',
        })),
    ).toEqual({ inside: true, label: 'SubLive' });

    // And the arrows are still live, which is what "inside" has to mean.
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('adw-popover-back') ?? false)).toBe(
        true,
    );

    // WHAT IS NOT ASSERTED HERE, and it is a real difference from GTK rather than an
    // oversight: `<gtk-popover>` does not trap Tab, so a Tab from inside an open menu
    // does reach `#behind`. GTK's own popover menu binds it —
    // `refs/gtk/gtk/gtkpopovermenu.c:660-663` adds tab bindings that cycle focus within
    // the menu — and this port has never implemented that for ANY popover. Asserting it
    // here would claim a reach the code does not have; K1 was about focus landing
    // INSIDE after a page change, which is what the two expectations above hold. The
    // Tab gap belongs to `<gtk-popover>` and to a change that can carry every popover.
}
