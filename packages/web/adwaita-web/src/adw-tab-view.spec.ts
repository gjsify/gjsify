// The DOM/CSS surface of <adw-tab-view>, in a real browser via the @gjsify/adwaita-web
// test axis — the entry self-applies the compiled stylesheet, so computed-style
// assertions are valid.
//
// Keep the split: the MODEL is asserted in `tab-view.spec.ts` against the shared
// libadwaita conformance vectors, this file is markup and computed style only.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwTabView } from './elements/adw-tab-view.js';

function chips(view: AdwTabView): HTMLButtonElement[] {
    return Array.from(view.querySelectorAll('.adw-tab')) as HTMLButtonElement[];
}

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
            expect(view.selectedIndex).toBe(0);
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
            expect(view.selectedIndex).toBe(2);
            expect(notified).toBe(2);
            expect((view.querySelectorAll('.adw-tab-page')[2] as HTMLElement).hidden).toBe(false);
            view.parentElement?.remove();
        });

        await it('setting the selected-page attribute switches pages', async () => {
            const view = makeTabView();
            // ADR 0048: the markup door names the PAGE. `makeTabView` declares no
            // `page-id`, so the ids are the generated ones the element reflects back.
            const second = view.pages[1]!.id;
            view.setAttribute('selected-page', second);
            expect((view.querySelectorAll('.adw-tab-page')[1] as HTMLElement).hidden).toBe(false);
            expect((view.querySelectorAll('.adw-tab-page')[0] as HTMLElement).hidden).toBe(true);
            view.parentElement?.remove();
        });

        await it('emits close-page from the close affordance AND removes the page', async () => {
            const view = makeTabView();
            let closed = -1;
            view.addEventListener('close-page', (event) => {
                closed = (event as CustomEvent).detail.index;
            });
            (view.querySelectorAll('.adw-tab-close')[1] as HTMLButtonElement).click();
            expect(closed).toBe(1);
            // The element used to emit and remove NOTHING, so every close was
            // permanently denied; the default handler now confirms a non-pinned
            // page (close_page_cb).
            expect(view.querySelectorAll('.adw-tab').length).toBe(2);
            // Closing a page BEFORE the selection must not also select the tab,
            // and must leave the selected PAGE selected.
            expect(view.selectedIndex).toBe(0);
            view.parentElement?.remove();
        });
    });

    // ONE HALF of the upgrade-order defect; the other half is the define order at the
    // foot of `elements/adw-tab-view.ts`, which no test in this realm can observe —
    // both names are already registered by the time a spec runs, and `define` is what
    // upgrades. What IS reproducible here is the STATE that order produced: a real
    // `<adw-tab-page>` next to an `<adw-tab-view>` that is still an ordinary
    // HTMLElement. `document.implementation.createHTMLDocument()` has no browsing
    // context, so nothing it creates is ever upgraded; adopting the element carries it
    // into this document without upgrading it, which INSERTING it would do.
    //
    // Constructing both with `document.createElement` instead would pass either way —
    // both are defined, so both come back upgraded and the ancestor always has the
    // method. The parse-then-define order the site hits is covered in
    // `tests/browser/specs/adwaita-upgrade-order.spec.ts`.
    await describe('adw-tab-page beside an un-upgraded view', async () => {
        await it('reports nothing when the view has none of its methods yet', async () => {
            const view = document.adoptNode(
                document.implementation.createHTMLDocument('').createElement('adw-tab-view'),
            );
            expect('syncDeclaredPage' in view).toBe(false);
            const page = document.createElement('adw-tab-page');
            view.appendChild(page);

            // A custom-element reaction never throws INTO its caller: the exception is
            // REPORTED, so `setAttribute` returns normally whether or not the callback
            // blew up and only a listener sees the difference. `preventDefault` keeps a
            // red run from also logging it at the console.
            const reported: string[] = [];
            const onError = (event: ErrorEvent) => {
                reported.push(event.message);
                event.preventDefault();
            };
            window.addEventListener('error', onError);
            page.setAttribute('title', 'One');
            window.removeEventListener('error', onError);

            expect(reported).toStrictEqual([]);
            expect(page.getAttribute('title')).toBe('One');
        });

        await it('leaves a page appended after connect unadopted rather than throwing', async () => {
            // The imperative surface is `appendPage`; a bare DOM append is out of
            // contract, and the point here is only that it fails QUIETLY — the page
            // carries no `data-page-id`, so `syncDeclaredPage` has no record to touch.
            //
            // "rather than throwing" is ASSERTED and not assumed. Without the listener
            // this test measured only the two counts, and both hold whether or not the
            // callback blew up: a custom-element reaction is REPORTED, never rethrown
            // into `setAttribute`, so the model is untouched either way. Measured — with
            // `syncDeclaredPage` mutated to throw on exactly this path, the whole
            // in-bundle suite of 4631 stayed green and only an unrelated spec's global
            // error sweep noticed.
            const view = makeTabView();
            const late = document.createElement('adw-tab-page');
            view.appendChild(late);

            const reported: string[] = [];
            const onError = (event: ErrorEvent) => {
                reported.push(event.message);
                event.preventDefault();
            };
            window.addEventListener('error', onError);
            late.setAttribute('title', 'Late');
            window.removeEventListener('error', onError);

            expect(reported).toStrictEqual([]);
            expect(view.nPages).toBe(3);
            expect(chips(view).length).toBe(3);
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

    // Switching a tab scrolls the TAB STRIP and nothing else. In C that is not a rule
    // anyone has to keep, it is the shape of the API: `scroll_to_tab_full` writes
    // `self->adjustment`, the strip's own adjustment
    // (refs/libadwaita/src/adw-tab-box.c:928-961), and `select_page` is its only caller
    // on a selection (:1728). The DOM has no equally narrow move, because `focus()` and
    // `scrollIntoView()` both walk every scrollable ancestor up to the window, so the
    // port handed the document a 6567px jump on a single ArrowRight, measured in a
    // documentation page long enough to have somewhere to jump to.
    await describe('adw-tab-view keyboard selection scrolls the STRIP, not the page', async () => {
        const BAR_WIDTH = 220;
        const CHIP_WIDTH = 90;

        /** A view parked far below the fold, so a window scroll is the only way to reveal it. */
        function makeFarBelowTheFold(count = 6): { view: AdwTabView; host: HTMLElement } {
            const host = document.createElement('div');
            const spacer = document.createElement('div');
            spacer.style.height = '4000px';
            host.appendChild(spacer);
            const inner = document.createElement('div');
            inner.style.width = `${BAR_WIDTH}px`;
            host.appendChild(inner);
            document.body.appendChild(host);

            const view = document.createElement('adw-tab-view') as AdwTabView;
            inner.appendChild(view);
            for (const id of 'abcdefgh'.slice(0, count)) view.appendPage({ id, title: `Page ${id}` });
            return { view, host };
        }

        await it('ArrowRight moves focus without moving the window', async () => {
            const { view, host } = makeFarBelowTheFold();
            window.scrollTo(0, 0);
            // The precondition IS the test: with the widget already on screen the
            // browser would not scroll either way, and this would pass on the bug.
            expect(view.getBoundingClientRect().top > window.innerHeight).toBe(true);

            const before = window.scrollY;
            chips(view)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

            expect(view.selectedId).toBe('b');
            // Focus still travels with the roving tabindex; what changed is where the
            // browser may scroll, not whether the chip is focused.
            expect(document.activeElement).toBe(chips(view)[1]);
            expect(window.scrollY).toBe(before);

            host.remove();
            window.scrollTo(0, 0);
        });

        await it('End brings the last chip into the bar by scrolling the BAR', async () => {
            const { view, host } = makeFarBelowTheFold();
            window.scrollTo(0, 0);
            const bar = view.querySelector('.adw-tab-bar') as HTMLElement;
            // Pin the chip widths: a chip is a flex item that shrinks to whatever the
            // strip has, so without this the six of them fit and `scroll_to_tab_full`
            // has nothing to do, and the assertions below would hold vacuously.
            for (const chip of chips(view)) chip.style.flex = '0 0 90px';
            expect(bar.scrollWidth > bar.clientWidth).toBe(true);
            expect(bar.scrollLeft).toBe(0);

            const before = window.scrollY;
            chips(view)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

            expect(view.selectedId).toBe('f');
            expect(bar.scrollLeft > 0).toBe(true);
            const last = chips(view)[5].getBoundingClientRect();
            const box = bar.getBoundingClientRect();
            expect(Math.round(last.right) <= Math.round(box.right)).toBe(true);
            expect(window.scrollY).toBe(before);

            host.remove();
            window.scrollTo(0, 0);
        });

        // The two above both press a key, so both would still pass if the strip scroll
        // lived in the key handler and the padding term were dropped. Neither is what C
        // does: `notify::selected-page` reaches `select_page` through the bar
        // (adw-tab-bar.c:934 -> adw-tab-box.c:1728), so EVERY selection scrolls the
        // strip, and `scroll_to_tab_full` parks the chip `padding` short of the edge
        // rather than flush against it (adw-tab-box.c:952-959).
        await it('a programmatic selection parks the chip a padding short of the edge', async () => {
            const { view, host } = makeFarBelowTheFold(8);
            window.scrollTo(0, 0);
            const bar = view.querySelector('.adw-tab-bar') as HTMLElement;
            for (const chip of chips(view)) {
                // `min-width: 0` as well as the basis: a flex item's automatic minimum
                // size is its MIN-CONTENT size, and the selected chip carries a close
                // affordance the others hide, so without this the six-point-something
                // pixels it adds land in the middle of the arithmetic under test.
                chip.style.flex = `0 0 ${CHIP_WIDTH}px`;
                chip.style.minWidth = '0';
            }
            expect(bar.scrollLeft).toBe(0);

            const before = window.scrollY;
            // No keypress and no click: the model is driven directly.
            expect(view.setSelectedPage('d')).toBe(true);

            const pageSize = bar.clientWidth;
            // `padding = MIN (tab_width, page_size - tab_width) / 2` (adw-tab-box.c:952).
            const padding = Math.min(CHIP_WIDTH, pageSize - CHIP_WIDTH) / 2;
            // Chip 4 of 8 is mid-strip, so the computed offset is inside the adjustment's
            // range: an assertion the clamp could satisfy on its own proves nothing.
            expect(bar.scrollLeft > 0 && bar.scrollLeft < bar.scrollWidth - pageSize).toBe(true);
            const chip = chips(view)[3].getBoundingClientRect();
            expect(Math.round(bar.getBoundingClientRect().right - chip.right)).toBe(padding);
            expect(window.scrollY).toBe(before);

            host.remove();
            window.scrollTo(0, 0);
        });
    });

    // The same coordinate space, one call site over, and it was wrong there too.
    // `update_visible` (adw-tab-box.c:769-797) decides `fully_visible` from `pos` against
    // the adjustment, exactly as `scroll_to_tab_full` does, and the close affordance
    // hangs off it: `show_close = (hovering && fully_visible) || selected || dragging`
    // (adw-tab.c:124). Measured with `offsetLeft` instead, the comparison ran against
    // whichever positioned ancestor the HOST page happened to have, so a tab view that
    // merely sat indented reported every chip clipped and swallowed the close button on
    // hover.
    await describe('adw-tab-view close affordance is measured against the BAR', async () => {
        await it('hovering an indented but fully visible chip shows its close button', async () => {
            const host = document.createElement('div');
            // The whole defect: an offset between the chip's offsetParent and the bar.
            // Nothing in the widget is positioned, so this lands in `offsetLeft`.
            host.style.marginLeft = '300px';
            host.style.width = '400px';
            document.body.appendChild(host);
            const view = document.createElement('adw-tab-view') as AdwTabView;
            host.appendChild(view);
            for (const id of ['a', 'b', 'c']) view.appendPage({ id, title: `Page ${id}` });

            const bar = view.querySelector('.adw-tab-bar') as HTMLElement;
            expect(bar.scrollWidth <= bar.clientWidth).toBe(true);

            // Chip 1, not chip 0: `selected` shows the close button on its own, which
            // would mask the `hovering && fullyVisible` term under test.
            const chip = chips(view)[1];
            expect(chip.classList.contains('active')).toBe(false);
            chip.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
            expect((chip.querySelector('.adw-tab-close') as HTMLElement).hidden).toBe(false);

            host.remove();
        });
    });
};
