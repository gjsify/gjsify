// DOM-level conformance tests for <adw-tab-view>, driven by the SAME vectors the
// core suite and the NativeScript renderer assert against
// (`@gjsify/adwaita-core/conformance`).
//
// The element is a thin adapter over `TabViewState`, not a second implementation: it is
// handed STRAIGHT to the shared vector driver, so a method it re-implements fails here.
// Neither renderer had the model at all — `close-page` meant three different things,
// out-of-range selection was clamped in one and ignored in the other, and the pinned
// partition, the parent-aware close successor, the reorder clamps and the keyboard model
// existed in neither.
import { describe, expect, it } from '@gjsify/unit';

import {
    TAB_CLOSE_VISIBLE_VECTORS,
    TAB_VIEW_VECTORS,
    TABS_REVEALED_VECTORS,
    applyTabViewOp,
    replayTabPagesAsSplices,
    seedTabViewPages,
    tabViewClosing,
    tabViewOrder,
} from '@gjsify/adwaita-core/conformance';
import type { TabViewVectorPagesChange, TabViewVectorSelection } from '@gjsify/adwaita-core/conformance';
import { tabCloseVisible, tabsRevealed } from '@gjsify/adwaita-core';

import type { AdwTabView } from './elements/adw-tab-view.js';

/** A mounted view plus every event it emitted. */
interface MountedTabView {
    view: AdwTabView;
    host: HTMLElement;
    selections: TabViewVectorSelection[];
    pagesChanges: TabViewVectorPagesChange[];
    closeAttempts: string[];
}

/**
 * Mount an EMPTY view and record its events. Empty rather than markup-seeded: the
 * vectors seed through the same `seedTabViewPages` the other two suites use, which is
 * what makes "the element is the vector target" literal. The declarative path has its own
 * describe block below.
 */
function mountTabView(handler: 'default' | 'defer'): MountedTabView {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const view = document.createElement('adw-tab-view') as AdwTabView;
    const selections: TabViewVectorSelection[] = [];
    const pagesChanges: TabViewVectorPagesChange[] = [];
    const closeAttempts: string[] = [];

    view.addEventListener('notify::selected-page', (event) => {
        const detail = (event as CustomEvent).detail;
        selections.push({
            selectedId: detail.selectedId,
            selectedIndex: detail.selected,
            previousId: detail.previousId,
            interactive: detail.interactive,
        });
    });
    for (const kind of ['attached', 'detached', 'reordered', 'pinned', 'updated'] as const) {
        view.addEventListener(`page-${kind}`, (event) => {
            const detail = (event as CustomEvent).detail;
            pagesChanges.push({
                kind,
                id: detail.id,
                position: detail.position,
                previousPosition: detail.previousPosition,
            });
        });
    }
    // Every close ATTEMPT dispatches this event, so the log IS the attempt log —
    // and `preventDefault()` is the DOM spelling of the handler's 'defer'.
    view.addEventListener('close-page', (event) => {
        closeAttempts.push((event as CustomEvent).detail.id);
        if (handler === 'defer') event.preventDefault();
    });

    host.appendChild(view);
    return { view, host, selections, pagesChanges, closeAttempts };
}

/** Which page panels are actually SHOWN — what the user sees, not what the model says. */
function shownPanels(view: AdwTabView): boolean[] {
    const panels = Array.from(view.querySelectorAll('.adw-tab-view-pages > .adw-tab-page')) as HTMLElement[];
    return panels.map((panel) => !panel.hidden);
}

/** The tab chips, in bar order. */
function tabChips(view: AdwTabView): HTMLButtonElement[] {
    return Array.from(view.querySelectorAll('.adw-tab-box > .adw-tab')) as HTMLButtonElement[];
}

export const AdwTabViewConformanceTest = async () => {
    await describe('adw-tab-view model (libadwaita conformance vectors)', async () => {
        for (const vector of TAB_VIEW_VECTORS) {
            await it(vector.rule, () => {
                const mounted = mountTabView(vector.handler ?? 'default');
                const { view } = mounted;

                // The element IS the vector target: no adapter, no glue. A method
                // it re-implements instead of delegating fails right here.
                seedTabViewPages(view, vector.pages);
                expect(tabViewOrder(view)).toStrictEqual(vector.pages.map((page) => page.id));
                expect(mounted.selections).toStrictEqual([...vector.setupChanges]);

                mounted.selections.length = 0;
                mounted.pagesChanges.length = 0;
                mounted.closeAttempts.length = 0;
                const results = vector.ops.map((op) => applyTabViewOp(view, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(mounted.selections).toStrictEqual([...vector.changes]);
                if (vector.pagesChanges) expect(mounted.pagesChanges).toStrictEqual([...vector.pagesChanges]);
                if (vector.closeAttempts) expect(mounted.closeAttempts).toStrictEqual([...vector.closeAttempts]);

                // ADR 0046: the page signal, replayed as portable `items-changed` splices,
                // must reproduce the order this widget actually ended on. That is the whole
                // claim — `TabViewPagesChange` IS the positional list signal — measured
                // against a real change stream rather than asserted in an ADR.
                if (vector.pagesChanges) {
                    expect(
                        replayTabPagesAsSplices(
                            vector.pages.map((page) => page.id),
                            mounted.pagesChanges,
                        ),
                    ).toStrictEqual([...vector.order]);
                }

                expect(tabViewOrder(view)).toStrictEqual([...vector.order]);
                expect(view.nPinnedPages).toBe(vector.nPinnedPages);
                expect(view.selectedId).toBe(vector.selectedId);
                expect(view.selectedIndex).toBe(vector.selectedIndex);
                if (vector.closing) expect(tabViewClosing(view)).toStrictEqual([...vector.closing]);
                if (vector.diagnostics) expect(view.diagnostics).toStrictEqual([...vector.diagnostics]);

                // The DOM must agree with the model: one chip per page in model order,
                // exactly the selected panel shown, and nothing when the view empties. A
                // bar built once at connect keeps a closed page's chip forever.
                expect(tabChips(view).map((tab) => tab.dataset.pageId)).toStrictEqual([...vector.order]);
                const expectedShown = vector.order.map(() => false);
                if (vector.selectedIndex >= 0) expectedShown[vector.selectedIndex] = true;
                expect(shownPanels(view)).toStrictEqual(expectedShown);
                expect(tabChips(view).map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual(
                    expectedShown.map((shown) => String(shown)),
                );

                mounted.host.remove();
            });
        }
    });

    await describe('adw-tab-view declared markup', async () => {
        await it('adopts <adw-tab-page> children as the page panels and shows the first', () => {
            const host = document.createElement('div');
            host.innerHTML = `<adw-tab-view>
                <adw-tab-page page-id="one" title="One"><p>first</p></adw-tab-page>
                <adw-tab-page page-id="two" title="Two"><p>second</p></adw-tab-page>
            </adw-tab-view>`;
            document.body.appendChild(host);
            const view = host.querySelector('adw-tab-view') as AdwTabView;

            expect(tabViewOrder(view)).toStrictEqual(['one', 'two']);
            expect(view.pages.map((page) => page.title)).toStrictEqual(['One', 'Two']);
            expect(shownPanels(view)).toStrictEqual([true, false]);
            // The declared element itself is the panel, so its markup survives.
            expect(view.pages[0]!.content!.querySelector('p')!.textContent).toBe('first');
            host.remove();
        });

        await it('keeps a title LIVE — the observedAttributes declaration used to have nothing behind it', () => {
            const host = document.createElement('div');
            host.innerHTML = `<adw-tab-view>
                <adw-tab-page page-id="one" title="One"></adw-tab-page>
            </adw-tab-view>`;
            document.body.appendChild(host);
            const view = host.querySelector('adw-tab-view') as AdwTabView;
            const page = view.querySelector('adw-tab-page') as HTMLElement;

            page.setAttribute('title', 'Renamed');
            expect(view.pages[0]!.title).toBe('Renamed');
            expect(tabChips(view)[0]!.querySelector('.adw-tab-title')!.textContent).toBe('Renamed');

            // `null` coerces to '', not to 'null'.
            page.removeAttribute('title');
            expect(view.pages[0]!.title).toBe('');
            host.remove();
        });

        await it('generates a distinct page id per declared page, and an explicit page-id wins', () => {
            // An id stands in for the AdwTabPage POINTER, so two pages must never share
            // one — a declared page without `page-id` still needs its own.
            const host = document.createElement('div');
            host.innerHTML = `<adw-tab-view>
                <adw-tab-page title="One"></adw-tab-page>
                <adw-tab-page title="Two"></adw-tab-page>
                <adw-tab-page page-id="named" title="Three"></adw-tab-page>
            </adw-tab-view>`;
            document.body.appendChild(host);
            const view = host.querySelector('adw-tab-view') as AdwTabView;

            const ids = tabViewOrder(view);
            expect(new Set(ids).size).toBe(3);
            expect(ids[2]).toBe('named');
            expect(view.setSelectedPage('named')).toBe(true);
            host.remove();
        });
    });

    await describe('adw-tab-view selected attribute', async () => {
        function mountThree(attrs = ''): { view: AdwTabView; host: HTMLElement } {
            const host = document.createElement('div');
            host.innerHTML = `<adw-tab-view ${attrs}>
                <adw-tab-page page-id="a" title="One"></adw-tab-page>
                <adw-tab-page page-id="b" title="Two"></adw-tab-page>
                <adw-tab-page page-id="c" title="Three"></adw-tab-page>
            </adw-tab-view>`;
            document.body.appendChild(host);
            return { view: host.querySelector('adw-tab-view') as AdwTabView, host };
        }

        await it('selects the declared index instead of the auto-pick', () => {
            const { view, host } = mountThree('selected="2"');
            expect(view.selectedIndex).toBe(2);
            expect(shownPanels(view)).toStrictEqual([false, false, true]);
            host.remove();
        });

        await it('IGNORES an out-of-range or unparseable index instead of clamping it', () => {
            // A clamping `Number.isNaN(raw) ? 0 : Math.min(Math.max(raw, 0), max)` selects
            // the last page for `99` and the first for `-1`/`oops`; libadwaita refuses all
            // three.
            const { view, host } = mountThree();
            for (const value of ['99', '-1', 'oops']) {
                view.setAttribute('selected', value);
                expect(view.selectedIndex).toBe(0);
            }
            //...and the attribute is put back in sync rather than left lying.
            view.setAttribute('selected', '1');
            expect(view.selectedIndex).toBe(1);
            expect(view.getAttribute('selected-page')).toBe(view.pages[1]!.id);
            host.remove();
        });

        await it('notifies on a PROGRAMMATIC selection, not only on a click', () => {
            // C notifies on EVERY path: a programmatic `view.selectedPage = …` must notify
            // as a tab click does.
            const { view, host } = mountThree();
            const seen: number[] = [];
            view.addEventListener('notify::selected-page', (event) =>
                seen.push((event as CustomEvent).detail.selected),
            );
            view.selectedPage = view.pages[2]!;
            expect(seen).toStrictEqual([2]);
            host.remove();
        });

        await it('reflects the selection back and drops the attribute when the view empties', () => {
            const { view, host } = mountThree();
            const chips = tabChips(view);
            chips[1]!.click();
            expect(view.getAttribute('selected-page')).toBe(view.pages[1]!.id);

            for (const id of ['a', 'b', 'c']) view.closePage(id);
            expect(view.nPages).toBe(0);
            expect(view.hasAttribute('selected')).toBe(false);
            expect(view.selectedIndex).toBe(-1);
            host.remove();
        });
    });

    await describe('adw-tab-view close protocol', async () => {
        await it('CLOSES a non-pinned page by default — the element used to remove nothing, ever', () => {
            const mounted = mountTabView('default');
            seedTabViewPages(mounted.view, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
            mounted.view.closePage('b');
            expect(tabViewOrder(mounted.view)).toStrictEqual(['a', 'c']);
            expect(tabChips(mounted.view)).toHaveLength(2);
            mounted.host.remove();
        });

        await it('denies a PINNED page by default and leaves it in place', () => {
            const mounted = mountTabView('default');
            mounted.view.appendPinnedPage({ id: 'p' });
            mounted.view.appendPage({ id: 'a' });
            expect(mounted.view.closePage('p')).toBe(true);
            expect(tabViewOrder(mounted.view)).toStrictEqual(['p', 'a']);
            expect(mounted.view.isClosing('p')).toBe(false);
            mounted.host.remove();
        });

        await it('preventDefault() defers the close until closePageFinish — the "save before closing?" seam', () => {
            const mounted = mountTabView('defer');
            seedTabViewPages(mounted.view, [{ id: 'a' }, { id: 'b' }]);

            expect(mounted.view.closePage('b')).toBe(true);
            expect(mounted.view.isClosing('b')).toBe(true);
            expect(tabViewOrder(mounted.view)).toStrictEqual(['a', 'b']);

            // A second request while one is pending is ignored, handler and all.
            expect(mounted.view.closePage('b')).toBe(false);
            expect(mounted.closeAttempts).toStrictEqual(['b']);

            expect(mounted.view.closePageFinish('b', true)).toBe(true);
            expect(tabViewOrder(mounted.view)).toStrictEqual(['a']);
            mounted.host.remove();
        });

        await it('keeps `detail.index` pointing at the page while it is still there', () => {
            const mounted = mountTabView('default');
            seedTabViewPages(mounted.view, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
            let index = -1;
            mounted.view.addEventListener('close-page', (event) => {
                index = (event as CustomEvent).detail.index;
            });
            (mounted.view.querySelectorAll('.adw-tab-close')[2] as HTMLButtonElement).click();
            expect(index).toBe(2);
            mounted.host.remove();
        });
    });

    await describe('adw-tab-view tab bar chrome', async () => {
        await it('reveals the bar per tabsRevealed, including for a single PINNED tab', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const view = document.createElement('adw-tab-view') as AdwTabView;
            view.autohide = true;
            host.appendChild(view);
            const bar = view.querySelector('.adw-tab-bar') as HTMLElement;

            view.appendPage({ id: 'a' });
            expect(bar.hidden).toBe(
                !tabsRevealed({ autohide: true, nPages: 1, nPinnedPages: 0, isTransferringPage: false }),
            );
            expect(bar.hidden).toBe(true);

            // The clause the old `pages.length <= 1` check could not express.
            view.setPagePinned('a', true);
            expect(bar.hidden).toBe(false);
            host.remove();
        });

        await it('gates the close button on tabCloseVisible rather than showing it always', () => {
            const mounted = mountTabView('default');
            seedTabViewPages(mounted.view, [{ id: 'a' }, { id: 'b' }]);
            mounted.view.appendPinnedPage({ id: 'p' });
            const closes = Array.from(mounted.view.querySelectorAll('.adw-tab-close')) as HTMLElement[];
            const ids = tabViewOrder(mounted.view);

            // p, a, b — 'a' is selected (it was the first page added).
            expect(ids).toStrictEqual(['p', 'a', 'b']);
            expect(closes.map((close) => !close.hidden)).toStrictEqual(
                ids.map((id) =>
                    tabCloseVisible({
                        hovering: false,
                        fullyVisible: true,
                        selected: mounted.view.selectedId === id,
                        dragging: false,
                        pinned: mounted.view.pages.find((page) => page.id === id)!.pinned,
                    }),
                ),
            );
            mounted.host.remove();
        });

        for (const vector of TAB_CLOSE_VISIBLE_VECTORS) {
            await it(`close visibility: ${vector.rule}`, () => {
                // The renderer's gate IS the core predicate; the table here keeps a future
                // "simplify to `selected`" from passing.
                expect(
                    tabCloseVisible({
                        hovering: vector.hovering,
                        fullyVisible: vector.fullyVisible,
                        selected: vector.selected,
                        dragging: vector.dragging,
                        pinned: vector.pinned,
                    }),
                ).toBe(vector.visible);
            });
        }

        for (const vector of TABS_REVEALED_VECTORS) {
            await it(`bar visibility: ${vector.rule}`, () => {
                expect(
                    tabsRevealed({
                        autohide: vector.autohide,
                        nPages: vector.nPages,
                        nPinnedPages: vector.nPinnedPages,
                        isTransferringPage: vector.isTransferringPage,
                    }),
                ).toBe(vector.revealed);
            });
        }
    });

    await describe('adw-tab-view keyboard model', async () => {
        function mountFour(): { view: AdwTabView; host: HTMLElement } {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const view = document.createElement('adw-tab-view') as AdwTabView;
            host.appendChild(view);
            for (const id of ['a', 'b', 'c', 'd']) view.appendPage({ id, title: id });
            return { view, host };
        }

        function press(view: AdwTabView, init: KeyboardEventInit & { key: string }): void {
            const chips = tabChips(view);
            const target = chips.find((chip) => chip.classList.contains('active')) ?? view;
            target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        }

        await it('Ctrl+Tab WRAPS where ArrowRight stops', () => {
            const { view, host } = mountFour();
            view.setSelectedPage('d');
            press(view, { key: 'ArrowRight' });
            expect(view.selectedId).toBe('d');
            press(view, { key: 'Tab', ctrlKey: true });
            expect(view.selectedId).toBe('a');
            press(view, { key: 'Tab', ctrlKey: true, shiftKey: true });
            expect(view.selectedId).toBe('d');
            host.remove();
        });

        await it('moves the roving tabindex with the selection, so inactive tabs stay reachable', () => {
            // `tab.tabIndex = isActive ? 0 : -1` under role=tablist needs a key handler,
            // or every inactive tab is keyboard-unreachable.
            const { view, host } = mountFour();
            press(view, { key: 'ArrowRight' });
            expect(view.selectedId).toBe('b');
            expect(tabChips(view).map((chip) => chip.tabIndex)).toStrictEqual([-1, 0, -1, -1]);
            host.remove();
        });

        await it('Alt+digit selects by index, with Alt+0 meaning page 9', () => {
            const { view, host } = mountFour();
            press(view, { key: '3', altKey: true });
            expect(view.selectedId).toBe('c');
            press(view, { key: '0', altKey: true });
            expect(view.selectedId).toBe('c'); // index 9 does not exist
            host.remove();
        });

        await it('Ctrl+Shift+Page-Up/Down REORDERS the selected page inside its partition', () => {
            const { view, host } = mountFour();
            view.setPagePinned('a', true);
            view.setSelectedPage('b');
            press(view, { key: 'PageDown', ctrlKey: true, shiftKey: true });
            expect(tabViewOrder(view)).toStrictEqual(['a', 'c', 'b', 'd']);
            // 'b' is now back at the partition's first slot; it cannot cross it.
            press(view, { key: 'PageUp', ctrlKey: true, shiftKey: true });
            press(view, { key: 'PageUp', ctrlKey: true, shiftKey: true });
            expect(tabViewOrder(view)).toStrictEqual(['a', 'b', 'c', 'd']);
            host.remove();
        });
    });
};
