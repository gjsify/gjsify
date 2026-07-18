// DOM-level behaviour tests for <adw-tab-view>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis (the entry self-applies the compiled
// stylesheet, so computed-style assertions are valid). Asserts page building,
// selected↔click sync, notify/close events, and the expand-tabs / no-close
// attributes.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwTabView } from './elements/adw-tab-view.js';

function makeTabView(attrs = ''): AdwTabView {
    const host = document.createElement('div');
    host.innerHTML = `<adw-tab-view ${attrs}>
        <adw-tab-page title="One"><p>first</p></adw-tab-page>
        <adw-tab-page title="Two"><p>second</p></adw-tab-page>
        <adw-tab-page title="Three"><p>third</p></adw-tab-page>
    </adw-tab-view>`;
    document.body.appendChild(host);
    return host.querySelector('adw-tab-view') as AdwTabView;
}

export const AdwTabViewTest = async () => {
    await describe('adw-tab-view pages', async () => {
        await it('builds one tab per page and shows the first page', async () => {
            const view = makeTabView();
            expect(view.querySelectorAll('.adw-tab').length).toBe(3);
            expect(view.selected).toBe(0);
            const pages = view.querySelectorAll('.adw-tab-page');
            expect((pages[0] as HTMLElement).hidden).toBe(false);
            expect((pages[1] as HTMLElement).hidden).toBe(true);
            view.parentElement?.remove();
        });

        await it('clicking a tab selects its page and notifies', async () => {
            const view = makeTabView();
            let notified = -1;
            view.addEventListener('notify::selected-page', (event) => {
                notified = (event as CustomEvent).detail.selected;
            });
            (view.querySelectorAll('.adw-tab')[2] as HTMLButtonElement).click();
            expect(view.selected).toBe(2);
            expect(notified).toBe(2);
            expect((view.querySelectorAll('.adw-tab-page')[2] as HTMLElement).hidden).toBe(false);
            view.parentElement?.remove();
        });

        await it('setting the selected attribute switches pages', async () => {
            const view = makeTabView();
            view.setAttribute('selected', '1');
            expect((view.querySelectorAll('.adw-tab-page')[1] as HTMLElement).hidden).toBe(false);
            expect((view.querySelectorAll('.adw-tab-page')[0] as HTMLElement).hidden).toBe(true);
            view.parentElement?.remove();
        });

        await it('emits close-page from the close affordance', async () => {
            const view = makeTabView();
            let closed = -1;
            view.addEventListener('close-page', (event) => {
                closed = (event as CustomEvent).detail.index;
            });
            (view.querySelectorAll('.adw-tab-close')[1] as HTMLButtonElement).click();
            expect(closed).toBe(1);
            // Closing must not also select the tab.
            expect(view.selected).toBe(0);
            view.parentElement?.remove();
        });
    });

    await describe('adw-tab-view expand-tabs / no-close', async () => {
        await it('no-close hides every close affordance', async () => {
            const view = makeTabView('no-close');
            expect(view.noClose).toBe(true);
            for (const close of view.querySelectorAll('.adw-tab-close')) {
                expect(getComputedStyle(close).display).toBe('none');
            }
            view.parentElement?.remove();
        });

        await it('expand-tabs stretches tabs evenly across the bar', async () => {
            const view = makeTabView('expand-tabs');
            expect(view.expandTabs).toBe(true);
            for (const tab of view.querySelectorAll('.adw-tab')) {
                expect(getComputedStyle(tab).flexGrow).toBe('1');
            }
            view.parentElement?.remove();
        });

        await it('expand-tabs draws separators, hidden next to the active tab', async () => {
            const view = makeTabView('expand-tabs');
            const tabs = view.querySelectorAll('.adw-tab');
            // Tab 0 is active: the separator before tab 1 is hidden, the one
            // before tab 2 (between two inactive tabs) is visible.
            expect(getComputedStyle(tabs[1], '::before').opacity).toBe('0');
            expect(getComputedStyle(tabs[2], '::before').opacity).toBe('0.2');
            view.parentElement?.remove();
        });

        await it('properties reflect to attributes', async () => {
            const view = makeTabView();
            view.noClose = true;
            view.expandTabs = true;
            expect(view.hasAttribute('no-close')).toBe(true);
            expect(view.hasAttribute('expand-tabs')).toBe(true);
            view.noClose = false;
            expect(view.hasAttribute('no-close')).toBe(false);
            view.parentElement?.remove();
        });
    });
};
