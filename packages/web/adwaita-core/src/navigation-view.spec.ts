// Navigation-view specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME table.
//
// What is core-only here: the `NavigationStackChange` payload (`animate`, `pop`,
// `tagNotify`, `removeAfterTransition`) and `removeOnPop`. Both renderers settle
// the transition immediately and expose neither, so the vectors carry those
// fields for this suite while the renderers assert the state and the signal
// sequence the same fields produce.

import { describe, it, expect } from '@gjsify/unit';

import { BACK_BUTTON_FALLBACK_TOOLTIP, NavigationViewState, describeNavigationDiagnostic } from './navigation-view.js';
import type { NavigationDiagnostic, NavigationStackChange } from './navigation-view.js';
import { NAVIGATION_VIEW_VECTORS, collectNavigationState, runNavigationSteps } from './conformance/navigation-view.js';
import type {
    ExpectedNavigationChange,
    NavigationPageId,
    NavigationVectorAdapter,
} from './conformance/navigation-view.js';

/** The page handle the core suite uses — an opaque object, as a renderer's is. */
interface TestPage {
    id: NavigationPageId;
}

/** A `NavigationViewState` wired up as a vector adapter, plus its recorded output. */
function makeAdapter(): {
    adapter: NavigationVectorAdapter<TestPage>;
    diagnostics: NavigationDiagnostic[];
    changes: NavigationStackChange<TestPage>[];
} {
    const diagnostics: NavigationDiagnostic[] = [];
    const changes: NavigationStackChange<TestPage>[] = [];
    const state = new NavigationViewState<TestPage>({ onDiagnostic: (d) => diagnostics.push({ ...d }) });
    state.subscribe((change) => changes.push(change));

    const handles = new Map<NavigationPageId, TestPage>();
    const page = (id: NavigationPageId): TestPage => {
        let handle = handles.get(id);
        if (handle === undefined) {
            handle = { id };
            handles.set(id, handle);
        }
        return handle;
    };

    const adapter: NavigationVectorAdapter<TestPage> = {
        // The headless state has no animation, so `finishTransition` returns
        // nothing to compare — only an animating RENDERER defers.
        defersTransition: false,
        page,
        idOf: (p) => p?.id ?? null,
        add: (p, props) => state.add(p, props),
        remove: (p) => state.remove(p),
        push: (p, props) => state.push(p, props),
        pushByTag: (tag) => state.pushByTag(tag),
        pop: () => state.pop(),
        popToPage: (p) => state.popToPage(p),
        popToTag: (tag) => state.popToTag(tag),
        replace: (pages, props) => state.replace(pages, props),
        replaceWithTags: (tags) => state.replaceWithTags(tags),
        setTag: (p, tag) => state.setTag(p, tag),
        setTitle: (p, title) => state.setTitle(p, title),
        setCanPop: (p, canPop) => state.setCanPop(p, canPop),
        setAnimateTransitions: (value) => {
            state.setAnimateTransitions(value);
        },
        setPopOnEscape: (value) => {
            state.setPopOnEscape(value);
        },
        popFromShortcut: () => state.popFromShortcut(),
        popFromEscape: () => state.popFromEscape(),
        finishTransition: () => state.finishTransition(),
        stack: () => state.stack,
        pages: () => state.pages,
        visiblePage: () => state.visiblePage,
        visiblePageTag: () => state.visiblePageTag,
        depth: () => state.depth,
        animateTransitions: () => state.animateTransitions,
        popOnEscape: () => state.popOnEscape,
        canGoBack: () => state.canGoBack(),
        backButtonTooltip: () => state.backButtonTooltip(),
        findPage: (tag) => state.findPage(tag),
        getPreviousPage: (p) => state.getPreviousPage(p),
        pageState: (p) => ({
            registered: state.isRegistered(p),
            tag: state.tagOf(p),
            title: state.titleOf(p),
            canPop: state.canPopOf(p),
            removeOnPop: state.isRemoveOnPop(p),
        }),
    };
    return { adapter, diagnostics, changes };
}

/** A change, with page handles reduced to ids so it compares against a vector row. */
function asExpected(
    change: NavigationStackChange<TestPage>,
    idOf: (page: TestPage | null | undefined) => NavigationPageId | null,
): ExpectedNavigationChange {
    return {
        reason: change.reason,
        stack: change.stack.map((p) => idOf(p) as NavigationPageId),
        visiblePage: idOf(change.visiblePage),
        visiblePageTag: change.visiblePageTag,
        previousVisiblePage: idOf(change.previousVisiblePage),
        popped: change.popped.map((p) => idOf(p) as NavigationPageId),
        removed: change.removed.map((p) => idOf(p) as NavigationPageId),
        removeAfterTransition: idOf(change.removeAfterTransition),
        animate: change.animate,
        pop: change.pop,
        tagNotify: change.tagNotify,
    };
}

export default async () => {
    await describe('NavigationViewState (libadwaita conformance vectors)', async () => {
        for (const vector of NAVIGATION_VIEW_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { adapter, diagnostics, changes } = makeAdapter();

                for (const outcome of runNavigationSteps(vector.steps, adapter)) {
                    if (outcome.expected === undefined) continue;
                    expect({ at: outcome.index, result: outcome.result }).toStrictEqual({
                        at: outcome.index,
                        result: outcome.expected,
                    });
                }

                for (const check of collectNavigationState(vector.expect, adapter)) {
                    expect({ [check.label]: check.actual }).toStrictEqual({ [check.label]: check.expected });
                }

                if (vector.expect.diagnostics !== undefined) {
                    expect(diagnostics).toStrictEqual([...vector.expect.diagnostics]);
                }
                if (vector.expect.changes !== undefined) {
                    expect(changes.map((c) => asExpected(c, adapter.idOf))).toStrictEqual([...vector.expect.changes]);
                }
            });
        }
    });

    await describe('NavigationViewState seams', async () => {
        await it('fans out to every subscriber and honours unsubscribe', () => {
            const state = new NavigationViewState<{ id: string }>();
            const a: string[] = [];
            const b: string[] = [];
            const unsubscribeA = state.subscribe((c) => a.push(c.reason));
            state.subscribe((c) => b.push(c.reason));

            const root = { id: 'root' };
            state.add(root);
            unsubscribeA();
            state.push({ id: 'detail' });

            expect(a).toStrictEqual(['add']);
            expect(b).toStrictEqual(['add', 'push']);
        });

        await it('survives a listener unsubscribing mid-fan-out', () => {
            const state = new NavigationViewState<{ id: string }>();
            const seen: string[] = [];
            const unsubscribeFirst = state.subscribe(() => {
                seen.push('first');
                unsubscribeFirst();
            });
            state.subscribe(() => seen.push('second'));
            state.add({ id: 'root' });
            // The snapshot copy is what keeps 'second' from being skipped.
            expect(seen).toStrictEqual(['first', 'second']);
        });

        await it('hands out snapshots, not its own arrays', () => {
            const state = new NavigationViewState<{ id: string }>();
            const root = { id: 'root' };
            state.add(root);
            (state.stack as { id: string }[]).push({ id: 'forged' });
            (state.pages as { id: string }[]).push({ id: 'forged' });
            expect(state.depth).toBe(1);
            expect(state.pages).toHaveLength(1);
        });

        await it('reports nothing when no diagnostic sink was supplied', () => {
            // A view built without the seam must still REJECT the mutation, silently.
            const state = new NavigationViewState<{ id: string }>();
            const a = { id: 'a' };
            const b = { id: 'b' };
            expect(state.add(a, { tag: 'x' })).toBe(true);
            expect(state.add(b, { tag: 'x' })).toBe(false);
            expect(state.pages).toHaveLength(1);
        });
    });

    await describe('describeNavigationDiagnostic (the g_critical wording)', async () => {
        await it('keeps the four libadwaita messages verbatim', () => {
            expect(describeNavigationDiagnostic({ code: 'duplicate-tag', tag: 'sidebar' })).toBe(
                'Duplicate page tag in AdwNavigationView: sidebar',
            );
            // push_to_stack picks its wording from use_tag_for_errors (:943-949).
            expect(describeNavigationDiagnostic({ code: 'already-in-stack', tag: 'sidebar' })).toBe(
                "Page with the tag 'sidebar' is already in navigation stack",
            );
            expect(describeNavigationDiagnostic({ code: 'already-in-stack', title: 'Home' })).toBe(
                "Page 'Home' is already in navigation stack",
            );
            expect(describeNavigationDiagnostic({ code: 'tag-not-found', tag: 'nope' })).toBe(
                "No page with the tag 'nope' found in AdwNavigationView",
            );
            expect(describeNavigationDiagnostic({ code: 'not-in-stack', title: 'Extra' })).toBe(
                "Page 'Extra' is not in the navigation stack",
            );
        });
    });

    await describe('AdwBackButton derivation', async () => {
        await it('lets a renderer substitute its own translated fallback', () => {
            const state = new NavigationViewState<{ id: string }>();
            const root = { id: 'root' };
            state.add(root, { title: '' });
            state.push({ id: 'detail' });
            expect(state.backButtonTooltip()).toBe(BACK_BUTTON_FALLBACK_TOOLTIP);
            expect(state.backButtonTooltip('Zurück')).toBe('Zurück');
        });
    });
};
