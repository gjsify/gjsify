// That the derived reveal state actually shows and hides the bar. The bar's base scss
// sets `display: block`, an AUTHOR rule that defeats the UA `[hidden]{display:none}` the
// component relies on (cascade origin beats specificity), so
// `scss/_view_switcher_bar.scss` has to re-assert `&[hidden] { display: none }`.
//
// Staged against a real two-page <adw-view-stack>, because the request alone is not
// enough: `update_bar_revealed` (refs/libadwaita/src/adw-view-switcher-bar.c) reveals
// the bar only when `reveal` is set AND MORE THAN ONE page is visible. The one-page case
// is asserted here too. The full derivation is driven from the shared conformance
// vectors in `view-switcher.spec.ts`.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwViewStack } from './elements/adw-view-stack.js';
import type { AdwViewSwitcherBar } from './elements/adw-view-switcher-bar.js';

/** A bar bound to a stack of `count` visible pages, both mounted. */
function mountBar(count: number): { bar: AdwViewSwitcherBar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const stack = document.createElement('adw-view-stack') as AdwViewStack;
    for (let index = 0; index < count; index++) {
        const page = document.createElement('adw-view-stack-page');
        page.setAttribute('name', `p${index}`);
        page.setAttribute('title', `P${index}`);
        stack.appendChild(page);
    }
    host.appendChild(stack);

    const bar = document.createElement('adw-view-switcher-bar') as AdwViewSwitcherBar;
    host.appendChild(bar);
    bar.setStack(stack);
    return { bar, host };
}

export const AdwViewSwitcherBarTest = async () => {
    await describe('adw-view-switcher-bar reveal → visibility', async () => {
        await it('is display:none by default and block once revealed', () => {
            const { bar, host } = mountBar(2);

            // Default: `reveal` off → the component sets `hidden`, and the scss
            // `[hidden]` author rule must win over the base `display: block`.
            expect(bar.reveal).toBe(false);
            expect(getComputedStyle(bar).display).toBe('none');

            bar.setAttribute('reveal', '');
            expect(getComputedStyle(bar).display).toBe('block');

            // Hide it again → back to none (the round-trip, not a one-way latch).
            bar.removeAttribute('reveal');
            expect(getComputedStyle(bar).display).toBe('none');

            host.remove();
        });

        await it('still accepts the legacy `revealed` attribute as the request', () => {
            const { bar, host } = mountBar(2);
            bar.setAttribute('revealed', '');
            expect(bar.reveal).toBe(true);
            expect(getComputedStyle(bar).display).toBe('block');
            host.remove();
        });

        await it('stays collapsed for a ONE-page stack, however loudly the layout asks', () => {
            // `count > 1`. The old bar showed an
            // empty strip here because it never consulted the page count.
            const { bar, host } = mountBar(1);
            bar.reveal = true;
            expect(bar.reveal).toBe(true);
            expect(bar.revealed).toBe(false);
            expect(getComputedStyle(bar).display).toBe('none');
            host.remove();
        });
    });
};
