// Tab-view specs — driven by the shared conformance vectors, so this suite and
// the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_TAB_AUTOHIDE,
    TabViewState,
    isDescendantOfPage,
    successorAfterClose,
    tabCloseVisible,
    tabIconState,
    tabTooltip,
    tabTooltipIsMarkup,
    tabsRevealed,
} from './tab-view.js';
import type { AdwTabPageState, TabViewHandlers, TabViewSelectionChange } from './tab-view.js';
import {
    TAB_CLOSE_VISIBLE_VECTORS,
    TAB_DESCENDANT_VECTORS,
    TAB_ICON_STATE_VECTORS,
    TAB_PAGE_DESCRIPTOR_VECTORS,
    TAB_SUCCESSOR_VECTORS,
    TAB_TOOLTIP_VECTORS,
    TAB_VIEW_VECTORS,
    TABS_REVEALED_VECTORS,
    applyTabViewOp,
    seedTabViewPages,
    tabViewClosing,
    tabViewOrder,
} from './conformance/tab-view.js';
import type { TabViewVector, TabViewVectorPage, TabViewVectorPagesChange } from './conformance/tab-view.js';

/**
 * A page list built by hand, for the vectors that drive a PURE function.
 *
 * `successorAfterClose` and `isDescendantOfPage` take a page list as DATA, and one row —
 * a page whose parent is not in the list, which a detach leaves behind for exactly one
 * instant — cannot be produced through the mutating API at all. The `matches the shape a
 * real TabViewState produces` test below pins this factory to the real record.
 */
function pageStates(pages: readonly TabViewVectorPage[]): AdwTabPageState[] {
    return pages.map((page) => ({
        id: page.id,
        title: page.title ?? '',
        tooltip: '',
        icon: null,
        indicatorIcon: null,
        loading: false,
        needsAttention: false,
        pinned: page.pinned ?? false,
        parentId: page.parentId ?? null,
        closing: false,
        content: undefined,
    }));
}

/** Everything one replay of a vector produced. */
interface VectorRun {
    state: TabViewState;
    /** Ids the close handler was asked about, in order. */
    attempts: string[];
    /** Selection changes emitted while seeding. */
    setupChanges: TabViewSelectionChange[];
    /** Selection changes emitted by the ops. */
    changes: TabViewSelectionChange[];
    /** Page-list changes emitted by the ops. */
    pagesChanges: TabViewVectorPagesChange[];
    /** Return value of each op. */
    results: (boolean | number | null)[];
    /** The page order right after seeding, before any op ran. */
    seededOrder: string[];
}

/**
 * Replay one vector. `withHandler: false` installs NO close handler, so the built-in
 * default (`!page.pinned`) is under test; the recording wrapper the normal replay installs
 * reproduces that verdict, which is what makes the close-attempt ORDER observable.
 */
function runVector(vector: TabViewVector, withHandler = true): VectorRun {
    const attempts: string[] = [];
    const handlers: TabViewHandlers = withHandler
        ? {
              onClosePage: (page) => {
                  attempts.push(page.id);
                  return vector.handler === 'defer' ? 'defer' : !page.pinned;
              },
          }
        : {};

    const state = new TabViewState(handlers);
    const selections: TabViewSelectionChange[] = [];
    const pagesChanges: TabViewVectorPagesChange[] = [];
    state.subscribe((change) => selections.push({ ...change }));
    state.subscribePages((change) => pagesChanges.push({ ...change }));

    seedTabViewPages(state, vector.pages);
    const seededOrder = tabViewOrder(state);
    // Split the log at the seed/op boundary: the seed phase's page changes are all
    // `attached` and are covered by the seeded-order assertion.
    const setupChanges = selections.splice(0);
    pagesChanges.length = 0;

    const results = vector.ops.map((op) => applyTabViewOp(state, op));
    return { state, attempts, setupChanges, changes: selections, pagesChanges, results, seededOrder };
}

export default async () => {
    await describe('TabViewState (libadwaita conformance vectors)', async () => {
        for (const vector of TAB_VIEW_VECTORS) {
            await it(vector.rule, () => {
                const run = runVector(vector);

                // The fixtures also test `adw_tab_view_add_page`'s position derivation: a
                // parented page is seeded through addPage, which DERIVES its slot, and the
                // declared order is where it must land.
                expect(run.seededOrder).toStrictEqual(vector.pages.map((page) => page.id));
                expect(run.setupChanges).toStrictEqual([...vector.setupChanges]);
                expect(run.results).toStrictEqual([...vector.opResults]);
                expect(run.changes).toStrictEqual([...vector.changes]);
                if (vector.pagesChanges) expect(run.pagesChanges).toStrictEqual([...vector.pagesChanges]);
                if (vector.closeAttempts) expect(run.attempts).toStrictEqual([...vector.closeAttempts]);

                expect(tabViewOrder(run.state)).toStrictEqual([...vector.order]);
                expect(run.state.nPinnedPages).toBe(vector.nPinnedPages);
                expect(run.state.selectedId).toBe(vector.selectedId);
                expect(run.state.selectedIndex).toBe(vector.selectedIndex);
                if (vector.closing) expect(tabViewClosing(run.state)).toStrictEqual([...vector.closing]);
                if (vector.diagnostics) expect(run.state.diagnostics).toStrictEqual([...vector.diagnostics]);

                // The invariant every insert, reorder and first/last hop depends on: the
                // pinned pages are exactly the prefix [0, nPinnedPages).
                const pinnedCount = run.state.nPinnedPages;
                const partition = run.state.pages.map((page, index) => page.pinned === index < pinnedCount);
                expect(partition).toStrictEqual(run.state.pages.map(() => true));
            });
        }

        for (const vector of TAB_VIEW_VECTORS) {
            // A 'defer' row needs a handler by definition; every other row must
            // behave identically with none installed, which is what proves the
            // recording wrapper reproduces close_page_cb rather than replacing it.
            if (vector.handler === 'defer') continue;
            await it(`${vector.rule} — identical with NO handler installed (close_page_cb default)`, () => {
                const run = runVector(vector, false);
                expect(run.results).toStrictEqual([...vector.opResults]);
                expect(run.changes).toStrictEqual([...vector.changes]);
                expect(tabViewOrder(run.state)).toStrictEqual([...vector.order]);
                expect(run.state.selectedId).toBe(vector.selectedId);
            });
        }
    });

    await describe('successorAfterClose (select_previous_page)', async () => {
        for (const vector of TAB_SUCCESSOR_VECTORS) {
            await it(vector.rule, () => {
                const pages = pageStates(vector.pages);
                expect(successorAfterClose(pages, vector.closingId, vector.selectedId)).toBe(vector.successorId);
                // Pure: it must not touch the list it was handed.
                expect(pages.map((page) => page.id)).toStrictEqual(vector.pages.map((page) => page.id));
            });
        }

        await it('matches the shape a real TabViewState produces', () => {
            // Pins the hand-built fixtures above to the shipping record, so the
            // pure-function rows cannot drift away from the state machine's own.
            const state = new TabViewState();
            state.appendPinnedPage({ id: 'P0' });
            state.appendPage({ id: 'A', title: 'Alpha' });
            state.addPage({ id: 'C' }, 'A');
            expect(state.pages).toStrictEqual(
                pageStates([
                    { id: 'P0', pinned: true },
                    { id: 'A', title: 'Alpha' },
                    { id: 'C', parentId: 'A' },
                ]),
            );
        });
    });

    await describe('isDescendantOfPage (is_descendant_of)', async () => {
        for (const vector of TAB_DESCENDANT_VECTORS) {
            await it(vector.rule, () => {
                expect(isDescendantOfPage(pageStates(vector.pages), vector.pageId, vector.parentId)).toBe(
                    vector.descendant,
                );
            });
        }
    });

    await describe('tabsRevealed (AdwTabBar autohide)', async () => {
        for (const vector of TABS_REVEALED_VECTORS) {
            await it(vector.rule, () => {
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

        await it('defaults autohide to TRUE, as the GObject property does', () => {
            expect(DEFAULT_TAB_AUTOHIDE).toBe(true);
        });

        await it('reads its counts straight off a live TabViewState', () => {
            // The pinned clause is the one the web port lacks, and it is only
            // reachable when the counts come from the model rather than from a
            // page-count check the renderer does itself.
            const state = new TabViewState();
            state.appendPinnedPage({ id: 'P0' });
            const counts = { autohide: true, isTransferringPage: false };
            expect(tabsRevealed({ ...counts, nPages: state.nPages, nPinnedPages: state.nPinnedPages })).toBe(true);
            expect(state.setPagePinned('P0', false)).toBe(0);
            expect(tabsRevealed({ ...counts, nPages: state.nPages, nPinnedPages: state.nPinnedPages })).toBe(false);
        });
    });

    await describe('tabCloseVisible (AdwTab update_state + the pinned gate)', async () => {
        for (const vector of TAB_CLOSE_VISIBLE_VECTORS) {
            await it(vector.rule, () => {
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
    });

    await describe('tabTooltip (AdwTab update_tooltip)', async () => {
        for (const vector of TAB_TOOLTIP_VECTORS) {
            await it(vector.rule, () => {
                expect(tabTooltip({ tooltip: vector.tooltip, title: vector.title })).toBe(vector.text);
                expect(tabTooltipIsMarkup({ tooltip: vector.tooltip })).toBe(vector.markup);
            });
        }
    });

    await describe('tabIconState (AdwTab update_icons)', async () => {
        for (const vector of TAB_ICON_STATE_VECTORS) {
            await it(vector.rule, () => {
                expect(
                    tabIconState(
                        {
                            icon: vector.icon,
                            indicatorIcon: vector.indicatorIcon,
                            loading: vector.loading,
                            pinned: vector.pinned,
                        },
                        vector.defaultIcon,
                    ),
                ).toStrictEqual({
                    icon: vector.resolvedIcon,
                    spinner: vector.spinner,
                    iconVisible: vector.iconVisible,
                    indicatorVisible: vector.indicatorVisible,
                });
            });
        }
    });

    await describe('page descriptors (AdwTabPage property coercions)', async () => {
        for (const vector of TAB_PAGE_DESCRIPTOR_VECTORS) {
            await it(vector.rule, () => {
                const state = new TabViewState();
                state.appendPage(vector.spec);
                const page = state.getPage(vector.spec.id)!;
                expect(page.title).toBe(vector.title);
                expect(page.tooltip).toBe(vector.tooltip);
                expect(page.icon).toBe(vector.icon);
                expect(page.indicatorIcon).toBe(vector.indicatorIcon);
                expect(page.loading).toBe(vector.loading);
                expect(page.needsAttention).toBe(vector.needsAttention);
                expect(page.pinned).toBe(false);
                expect(page.parentId).toBe(null);
                expect(page.closing).toBe(false);
            });
        }

        await it('coerces a null tooltip and keeps the icons nullable through the setters too', () => {
            const state = new TabViewState();
            state.appendPage({ id: 'a', tooltip: 'was set', icon: 'text-x-generic' });
            expect(state.setPageTooltip('a', null)).toBe(true);
            expect(state.getPage('a')!.tooltip).toBe('');
            expect(state.setPageIcon('a', null)).toBe(true);
            expect(state.getPage('a')!.icon).toBe(null);
            expect(state.setPageIcon('a', null)).toBe(false);
        });
    });

    await describe('TabViewState observables', async () => {
        await it('hands out an unsubscribe that survives being called mid-fan-out', () => {
            const state = new TabViewState();
            const seen: string[] = [];
            const unsubscribe = state.subscribe(() => {
                seen.push('first');
                unsubscribe();
            });
            state.subscribe(() => seen.push('second'));

            state.appendPage({ id: 'a' });
            expect(seen).toStrictEqual(['first', 'second']);

            state.appendPage({ id: 'b' });
            state.setSelectedPage('b');
            expect(seen).toStrictEqual(['first', 'second', 'second']);
        });

        await it('emits the attach BEFORE the auto-select, so a renderer has built the tab', () => {
            // C's freeze/thaw around insert_page:
            // page-attached is a signal and fires immediately, the selection
            // notify only lands at thaw.
            const state = new TabViewState();
            const log: string[] = [];
            state.subscribePages((change) => log.push(`pages:${change.kind}`));
            state.subscribe((change) => log.push(`selected:${change.selectedId}`));
            state.appendPage({ id: 'a' });
            expect(log).toStrictEqual(['pages:attached', 'selected:a']);
        });

        await it('exposes pages as a frozen projection a renderer cannot reorder', () => {
            const state = new TabViewState();
            state.appendPage({ id: 'a' });
            state.appendPage({ id: 'b' });
            expect(Object.isFrozen(state.pages)).toBe(true);
            // Same identity while nothing structural changed, a new one after.
            const before = state.pages;
            expect(state.pages).toBe(before);
            state.appendPage({ id: 'c' });
            expect(state.pages).not.toBe(before);
        });
    });

    await describe('TabViewState close protocol edge cases', async () => {
        await it('refuses a closePageFinish for a page that is not closing', () => {
            const state = new TabViewState({ onClosePage: () => 'defer' });
            state.appendPage({ id: 'a' });
            state.appendPage({ id: 'b' });
            expect(state.closePageFinish('a', true)).toBe(false);
            expect(state.nPages).toBe(2);
            expect(state.diagnostics).toStrictEqual([
                "adw_tab_view_close_page_finish: assertion 'page->closing' failed",
            ]);
        });

        await it('lets a denied close be requested again', () => {
            const denied: string[] = [];
            const state = new TabViewState({
                onClosePage: (page) => {
                    denied.push(page.id);
                    return denied.length === 1 ? false : true;
                },
            });
            state.appendPage({ id: 'a' });
            state.appendPage({ id: 'b' });

            expect(state.closePage('b')).toBe(true);
            expect(state.nPages).toBe(2);
            expect(state.isClosing('b')).toBe(false);

            expect(state.closePage('b')).toBe(true);
            expect(state.nPages).toBe(1);
            expect(denied).toStrictEqual(['b', 'b']);
        });

        await it('ignores a close request for an unknown page', () => {
            const state = new TabViewState();
            state.appendPage({ id: 'a' });
            expect(state.closePage('nope')).toBe(false);
            expect(state.nPages).toBe(1);
        });

        await it('empties the view when the last page is closed one page at a time', () => {
            const state = new TabViewState();
            state.appendPage({ id: 'a' });
            state.appendPage({ id: 'b' });
            state.closePage('a');
            state.closePage('b');
            expect(state.nPages).toBe(0);
            expect(state.selectedId).toBe(null);
            expect(state.selectedIndex).toBe(-1);
            // The empty view accepts a null selection and nothing else.
            expect(state.setSelectedPage(null)).toBe(false);
            expect(state.diagnostics).toStrictEqual([]);
        });

        await it('refuses a page belonging to ANOTHER view, which its id cannot say', () => {
            // `_nextId` counts per view, so two views both hold `page-0` — reading only the
            // id would select THIS view's page of that id. Measured before the core took
            // the page: `a.setSelectedPage(b.pages[1])` moved `a` to index 1.
            const a = new TabViewState();
            const b = new TabViewState();
            for (const state of [a, b]) {
                state.appendPage({ id: 'one' });
                state.appendPage({ id: 'two' });
            }
            a.setSelectedPage('one');
            expect(a.diagnostics).toStrictEqual([]);

            expect(a.setSelectedPage(b.pages[1]!)).toBe(false);
            expect(a.selectedId).toBe('one');
            // EXACTLY one, and the text C raises. The page overload refuses and returns
            // before it recurses, so the id arm never runs for a foreign page — a `toBe(2)`
            // here is the double-push that a substring check on the LAST entry cannot see.
            expect(a.diagnostics).toStrictEqual([
                "adw_tab_view_set_selected_page: assertion 'page_belongs_to_this_view (self, selected_page)' failed",
            ]);

            // ...and its OWN page of the same id is accepted, so the refusal is identity
            // and not the id — and the accepted path records nothing.
            expect(a.setSelectedPage(a.pages[1]!)).toBe(true);
            expect(a.selectedId).toBe('two');
            expect(a.diagnostics).toHaveLength(1);
        });

        await it('carries `interactive` through the page overload', () => {
            // The overload RECURSES with `page.id`. A recursion that dropped the flag would
            // notify `interactive: true` for a model-driven selection and every listener
            // that distinguishes a user's click from the model's own move would be wrong —
            // and `setSelectedPage(page)` reads identically at the call site either way.
            const state = new TabViewState();
            state.appendPage({ id: 'one' });
            state.appendPage({ id: 'two' });
            const seen: boolean[] = [];
            state.subscribe((change) => seen.push(change.interactive));

            state.setSelectedPage(state.pages[1]!, false);
            state.setSelectedPage(state.pages[0]!);
            expect(seen).toStrictEqual([false, true]);
        });
    });
};
