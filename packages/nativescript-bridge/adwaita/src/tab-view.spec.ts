// AdwTabView conformance tests, driven by the SAME vectors the core suite and
// the `<adw-tab-view>` browser suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this imports `./widgets/tab-view-state.js`, NOT the widget — a widget module
// `extends GridLayout`, which evaluates the bare `@nativescript/core` specifier at
// module-eval. `adw-tab-view.ts` is a thin wrapper over exactly the surface below: every
// accessor forwards to the state this file creates, the page-list subscription
// inserts/removes/moves one chip, and the selection subscription runs
// {@link applyTabViewVisibility} + {@link tabCloseVisibilities} and notifies
// {@link tabViewNotifyPayload}. Nothing here is a mock of the widget.
import { describe, expect, it } from '@gjsify/unit';

import type { TabViewVector, TabViewVectorPagesChange, TabViewVectorSelection } from '@gjsify/adwaita-core/conformance';
import {
    TAB_CLOSE_VISIBLE_VECTORS,
    TAB_ICON_STATE_VECTORS,
    TAB_VIEW_VECTORS,
    TABS_REVEALED_VECTORS,
    applyTabViewOp,
    replayTabPagesAsSplices,
    seedTabViewPages,
    tabViewClosing,
    tabViewOrder,
} from '@gjsify/adwaita-core/conformance';
import type { TabViewHandlers, TabViewState } from '@gjsify/adwaita-core';
import { tabIconState } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

import {
    applyTabViewVisibility,
    createTabViewState,
    tabBarVisibility,
    tabCloseVisibilities,
    tabLabelText,
    tabPageVisibilities,
    tabTooltipText,
    tabViewNotifyPayload,
    type NsVisibility,
} from './widgets/tab-view-state.js';

/**
 * A stand-in for a page's content view. Only `visibility` is ever touched by the
 * tab view, so this is the whole contract — not a re-implementation of anything.
 */
function fakeView(): View {
    return { visibility: 'visible' } as unknown as View;
}

/** Everything one replay of a vector produced. */
interface VectorRun {
    state: TabViewState<View>;
    attempts: string[];
    setupChanges: TabViewVectorSelection[];
    changes: TabViewVectorSelection[];
    pagesChanges: TabViewVectorPagesChange[];
    results: (boolean | number | null)[];
    seededOrder: string[];
}

/** Replay one vector against the state the real widget delegates to. */
function runVector(vector: TabViewVector): VectorRun {
    const attempts: string[] = [];
    const handlers: TabViewHandlers<View> = {
        onClosePage: (page) => {
            attempts.push(page.id);
            return vector.handler === 'defer' ? 'defer' : !page.pinned;
        },
    };

    const state = createTabViewState(handlers);
    const selections: TabViewVectorSelection[] = [];
    const pagesChanges: TabViewVectorPagesChange[] = [];
    // The widget's own subscriptions, verbatim: it projects the change through
    // `tabViewNotifyPayload` before it reaches a consumer.
    state.subscribe((change) => selections.push(tabViewNotifyPayload(change)));
    state.subscribePages((change) => pagesChanges.push({ ...change }));

    seedTabViewPages(state, vector.pages);
    const seededOrder = tabViewOrder(state);
    const setupChanges = selections.splice(0);
    pagesChanges.length = 0;

    const results = vector.ops.map((op) => applyTabViewOp(state, op));
    return { state, attempts, setupChanges, changes: selections, pagesChanges, results, seededOrder };
}

export default async () => {
    await describe('AdwTabView model (libadwaita conformance vectors)', async () => {
        for (const vector of TAB_VIEW_VECTORS) {
            await it(vector.rule, () => {
                const run = runVector(vector);

                // The fixtures double as a test of adw_tab_view_add_page's
                // position derivation: a parented page is seeded through addPage,
                // which DERIVES its slot, and the declared order is where it lands.
                expect(run.seededOrder).toStrictEqual(vector.pages.map((page) => page.id));
                expect(run.setupChanges).toStrictEqual([...vector.setupChanges]);
                expect(run.results).toStrictEqual([...vector.opResults]);
                expect(run.changes).toStrictEqual([...vector.changes]);
                if (vector.pagesChanges) expect(run.pagesChanges).toStrictEqual([...vector.pagesChanges]);
                if (vector.closeAttempts) expect(run.attempts).toStrictEqual([...vector.closeAttempts]);

                // ADR 0046: the page signal, replayed as portable `items-changed` splices,
                // must reproduce the order this widget actually ended on. That is the whole
                // claim — `TabViewPagesChange` IS the positional list signal — measured
                // against a real change stream rather than asserted in an ADR.
                if (vector.pagesChanges) {
                    expect(
                        replayTabPagesAsSplices(
                            vector.pages.map((page) => page.id),
                            run.pagesChanges,
                        ),
                    ).toStrictEqual([...vector.order]);
                }

                expect(tabViewOrder(run.state)).toStrictEqual([...vector.order]);
                expect(run.state.nPinnedPages).toBe(vector.nPinnedPages);
                expect(run.state.selectedId).toBe(vector.selectedId);
                expect(run.state.selectedIndex).toBe(vector.selectedIndex);
                if (vector.closing) expect(tabViewClosing(run.state)).toStrictEqual([...vector.closing]);
                if (vector.diagnostics) expect(run.state.diagnostics).toStrictEqual([...vector.diagnostics]);

                // The native projection must agree with the model: exactly the
                // selected page is `visible`, and NOTHING is when the view emptied.
                // The old port reported index 0 for a page-less view and refused
                // to close the last tab at all.
                const expected: NsVisibility[] = run.state.pages.map(() => 'collapse');
                if (vector.selectedIndex >= 0) expected[vector.selectedIndex] = 'visible';
                expect(tabPageVisibilities(run.state)).toStrictEqual(expected);
            });
        }
    });

    await describe('AdwTabView native projection', async () => {
        await it('swaps `visibility` rather than reordering — NS has no page stack', () => {
            const state = createTabViewState();
            const first = fakeView();
            const second = fakeView();
            state.appendPage({ id: 'a', content: first });
            state.appendPage({ id: 'b', content: second });
            applyTabViewVisibility(state);
            expect([first.visibility, second.visibility]).toStrictEqual(['visible', 'collapse']);

            state.setSelectedPage('b');
            // `applyTabViewVisibility` PUSHES the current state onto the views; it
            // does not subscribe. The widget re-applies from its own change
            // listener, so the spec has to do the same.
            applyTabViewVisibility(state);
            expect([first.visibility, second.visibility]).toStrictEqual(['collapse', 'visible']);
        });

        await it('EMPTIES the view when the last tab is closed', () => {
            // The old `_closeTab` bailed out here (`if (this._pages.length <= 1)
            // return;`) where libadwaita detaches the page and sets the selection
            // to NULL (adw-tab-view.c:1912-1913).
            const state = createTabViewState();
            state.appendPage({ id: 'a', content: fakeView() });
            expect(state.closePage('a')).toBe(true);
            expect(state.nPages).toBe(0);
            expect(state.selectedId).toBe(null);
            expect(state.selectedIndex).toBe(-1);
            expect(tabPageVisibilities(state)).toStrictEqual([]);
        });

        await it('leaves a page without content alone instead of throwing', () => {
            const state = createTabViewState();
            state.appendPage({ id: 'headless' });
            applyTabViewVisibility(state);
            expect(state.selectedId).toBe('headless');
            expect(tabPageVisibilities(state)).toStrictEqual(['visible']);
        });

        await it('emits a payload that carries no live model object', () => {
            // The event escapes into consumer code; handing out the record would
            // let a listener mutate the view's own page.
            const state = createTabViewState();
            const payloads: TabViewVectorSelection[] = [];
            state.subscribe((change) => payloads.push(tabViewNotifyPayload(change)));
            state.appendPage({ id: 'a', title: 'Alpha', content: fakeView() });

            expect(payloads).toStrictEqual([
                { selectedId: 'a', selectedIndex: 0, previousId: null, interactive: false },
            ]);
            expect(Object.keys(payloads[0]!).sort()).toStrictEqual([
                'interactive',
                'previousId',
                'selectedId',
                'selectedIndex',
            ]);
        });
    });

    await describe('AdwTabView close-button gate (AdwTab update_state)', async () => {
        await it('reduces the three-term predicate to "selected and not pinned" on touch', () => {
            // Touch has no hover and this port has no tab drag, so `hovering` and
            // `dragging` are constantly false — which is the old port's rule PLUS
            // the pinned gate it was missing (adw-tab.c:124, :645-650).
            const state = createTabViewState();
            state.appendPinnedPage({ id: 'p', content: fakeView() });
            state.appendPage({ id: 'a', content: fakeView() });
            state.appendPage({ id: 'b', content: fakeView() });

            expect(state.selectedId).toBe('p');
            // The selected tab is PINNED, so nothing shows a close button.
            expect(tabCloseVisibilities(state)).toStrictEqual(['collapse', 'collapse', 'collapse']);

            state.setSelectedPage('a');
            expect(tabCloseVisibilities(state)).toStrictEqual(['collapse', 'visible', 'collapse']);
        });

        for (const vector of TAB_CLOSE_VISIBLE_VECTORS) {
            // Only the rows this renderer can reach are asserted through it; the
            // full predicate is specced in the core suite.
            if (vector.hovering || vector.dragging || !vector.fullyVisible) continue;
            await it(`close visibility: ${vector.rule}`, () => {
                const state = createTabViewState();
                state.appendPage({ id: 'other', content: fakeView() });
                if (vector.pinned) state.appendPinnedPage({ id: 'x', content: fakeView() });
                else state.appendPage({ id: 'x', content: fakeView() });
                if (vector.selected) state.setSelectedPage('x');
                else state.setSelectedPage('other');

                const index = state.getPagePosition('x');
                expect(tabCloseVisibilities(state)[index]).toBe(vector.visible ? 'visible' : 'collapse');
            });
        }
    });

    await describe('AdwTabView bar visibility (AdwTabBar autohide)', async () => {
        for (const vector of TABS_REVEALED_VECTORS) {
            // Only rows without a transferring page are reachable: NS has no tab
            // drag-and-drop, so `isTransferringPage` is constantly false here.
            if (vector.isTransferringPage) continue;
            await it(vector.rule, () => {
                const state = createTabViewState();
                for (let index = 0; index < vector.nPinnedPages; index++) {
                    state.appendPinnedPage({ id: `p${index}`, content: fakeView() });
                }
                for (let index = vector.nPinnedPages; index < vector.nPages; index++) {
                    state.appendPage({ id: `a${index}`, content: fakeView() });
                }
                expect(state.nPages).toBe(vector.nPages);
                expect(state.nPinnedPages).toBe(vector.nPinnedPages);
                expect(tabBarVisibility(state, vector.autohide)).toBe(vector.revealed ? 'visible' : 'collapse');
            });
        }

        await it('keeps the bar for a single PINNED tab — the clause NS never had', () => {
            const state = createTabViewState();
            state.appendPinnedPage({ id: 'p', content: fakeView() });
            expect(tabBarVisibility(state, true)).toBe('visible');
            expect(state.setPagePinned('p', false)).toBe(0);
            expect(tabBarVisibility(state, true)).toBe('collapse');
        });
    });

    await describe('AdwTabView chip content', async () => {
        await it('never renders the string "undefined" for a page with no title', () => {
            // `label.text = page.title` with no coercion is what did that; the
            // model coerces an absent title to '' (adw-tab-view.c:3021).
            const state = createTabViewState();
            state.appendPage({ id: 'a', content: fakeView() });
            expect(tabLabelText(state.getPage('a')!)).toBe('');
            expect(state.setPageTitle('a', 'Alpha')).toBe(true);
            expect(tabLabelText(state.getPage('a')!)).toBe('Alpha');
        });

        await it('renders no label on a PINNED tab — it is a single-glyph chip', () => {
            const state = createTabViewState();
            state.appendPinnedPage({ id: 'p', title: 'Pinned', content: fakeView() });
            expect(tabLabelText(state.getPage('p')!)).toBe('');
            expect(state.setPagePinned('p', false)).toBe(0);
            expect(tabLabelText(state.getPage('p')!)).toBe('Pinned');
        });

        await it('falls back to the title for a tooltip, and takes the tooltip when set', () => {
            const state = createTabViewState();
            state.appendPage({ id: 'a', title: 'main.c', content: fakeView() });
            expect(tabTooltipText(state.getPage('a')!)).toBe('main.c');
            state.setPageTooltip('a', 'build failed');
            expect(tabTooltipText(state.getPage('a')!)).toBe('build failed');
        });

        for (const vector of TAB_ICON_STATE_VECTORS) {
            await it(`icon slots: ${vector.rule}`, () => {
                // The chip drives both AdwIcon slots straight off this derivation
                // — NS carries the symbolic SVG string in the `icon` field, which
                // the model treats as opaque.
                const state = createTabViewState();
                const spec = {
                    id: 'x',
                    icon: vector.icon,
                    indicatorIcon: vector.indicatorIcon,
                    loading: vector.loading,
                    content: fakeView(),
                };
                if (vector.pinned) state.appendPinnedPage(spec);
                else state.appendPage(spec);

                expect(tabIconState(state.getPage('x')!, vector.defaultIcon)).toStrictEqual({
                    icon: vector.resolvedIcon,
                    spinner: vector.spinner,
                    iconVisible: vector.iconVisible,
                    indicatorVisible: vector.indicatorVisible,
                });
            });
        }
    });
};
