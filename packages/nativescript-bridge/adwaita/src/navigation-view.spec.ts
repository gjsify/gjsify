// AdwNavigationView conformance tests, driven by the SAME vectors the web
// renderer and the headless core assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this suite imports `./widgets/navigation-stack.js`, never
// `./widgets/adw-navigation-view.js`. The widget `extends GridLayout`, which
// evaluates the bare `@nativescript/core` specifier at module-eval and is
// unresolvable off NativeScript; the adapter carries TYPE-ONLY NS imports and so
// loads on GJS and Node. Everything the widget still owns on top of it — grid
// child management and `notify()` — is fed in through the host seam and asserted
// here as an operation log, so the real code is under test rather than a copy of
// it. The predecessor of this file did assert against a copy: a
// `MockNavigationView` in `index.spec.ts` whose `push()` behaved differently from
// the widget, which is precisely why the widget's missing already-in-stack guard
// and its leak of dynamically-pushed pages were never caught.
import { describe, it, expect } from '@gjsify/unit';

import {
    NAVIGATION_VIEW_VECTORS,
    collectNavigationState,
    navigationEventLog,
    runNavigationSteps,
} from '@gjsify/adwaita-core/conformance';
import type {
    NavigationEventRecord,
    NavigationPageId,
    NavigationVectorAdapter,
} from '@gjsify/adwaita-core/conformance';
import type { View } from '@nativescript/core';

import {
    NOTIFY_VISIBLE_PAGE,
    NS_NAVIGATION_PAGE_CLASS,
    POPPED,
    PUSHED,
    REPLACED,
    NsNavigationStack,
    navigationPageClassName,
} from './widgets/navigation-stack.js';
import type { NsNavigationEvent, NsPageVisibility } from './widgets/navigation-stack.js';

/** The slice of an NS `View` the navigation grid actually writes to. */
interface FakeView {
    id: NavigationPageId;
    className: string;
    visibility: string;
}

/** One host call, recorded so the view-tree half is asserted rather than assumed. */
type HostOp =
    | { op: 'attach' | 'detach'; page: NavigationPageId }
    | { op: 'visibility'; page: NavigationPageId; value: NsPageVisibility };

/**
 * The widget's constructor body, minus `GridLayout`: the same host seam the real
 * `AdwNavigationView` supplies, with the grid replaced by a recorded child list.
 */
function makeNavigation() {
    const handles = new Map<NavigationPageId, FakeView>();
    const ids = new Map<FakeView, NavigationPageId>();
    const children: FakeView[] = [];
    const ops: HostOp[] = [];
    const events: NsNavigationEvent[] = [];
    const warnings: string[] = [];

    const page = (id: NavigationPageId): FakeView => {
        let view = handles.get(id);
        if (view === undefined) {
            view = { id, className: '', visibility: '' };
            handles.set(id, view);
            ids.set(view, id);
        }
        return view;
    };
    const idOf = (view: unknown): NavigationPageId | null =>
        view === null || view === undefined ? null : (ids.get(view as FakeView) ?? null);

    const nav = new NsNavigationStack(
        {
            attachPage: (view) => {
                const fake = view as unknown as FakeView;
                fake.className = navigationPageClassName(fake.className);
                children.push(fake);
                ops.push({ op: 'attach', page: idOf(fake) as NavigationPageId });
            },
            detachPage: (view) => {
                const fake = view as unknown as FakeView;
                const index = children.indexOf(fake);
                if (index !== -1) children.splice(index, 1);
                ops.push({ op: 'detach', page: idOf(fake) as NavigationPageId });
            },
            setPageVisibility: (view, visibility) => {
                const fake = view as unknown as FakeView;
                fake.visibility = visibility;
                ops.push({ op: 'visibility', page: idOf(fake) as NavigationPageId, value: visibility });
            },
            emit: (event) => events.push(event),
        },
        { onDiagnostic: (diagnostic) => warnings.push(diagnostic.code) },
    );

    const adapter: NavigationVectorAdapter<FakeView> = {
        page,
        idOf,
        defersTransition: false,
        add: (p, props) =>
            nav.add(p as unknown as View, props?.tag ?? null, { title: props?.title, canPop: props?.canPop }),
        remove: (p) => nav.remove(p as unknown as View),
        push: (p, props) => nav.push(p as unknown as View, props),
        pushByTag: (tag) => nav.pushByTag(tag),
        pop: () => nav.pop(),
        popToPage: (p) => nav.popToPage(p as unknown as View),
        popToTag: (tag) => nav.popToTag(tag),
        replace: (pages, props) =>
            nav.replace(
                pages as unknown as ReadonlyArray<View | null>,
                props === undefined ? undefined : (view) => props(view as unknown as FakeView),
            ),
        replaceWithTags: (tags) => nav.replaceWithTags(tags),
        setTag: (p, tag) => nav.setTag(p as unknown as View, tag),
        setTitle: (p, title) => nav.setTitle(p as unknown as View, title),
        setCanPop: (p, canPop) => nav.setCanPop(p as unknown as View, canPop),
        setAnimateTransitions: (value) => {
            nav.setAnimateTransitions(value);
        },
        setPopOnEscape: (value) => {
            nav.setPopOnEscape(value);
        },
        popFromShortcut: () => nav.popFromShortcut(),
        popFromEscape: () => nav.popFromEscape(),
        finishTransition: () => nav.finishTransition() as unknown as readonly FakeView[],
        stack: () => nav.stack as unknown as readonly FakeView[],
        pages: () => nav.pages as unknown as readonly FakeView[],
        visiblePage: () => nav.visiblePage as unknown as FakeView | null,
        visiblePageTag: () => nav.visiblePageTag,
        depth: () => nav.depth,
        animateTransitions: () => nav.animateTransitions,
        popOnEscape: () => nav.popOnEscape,
        canGoBack: () => nav.canGoBack(),
        backButtonTooltip: () => nav.backButtonTooltip(),
        findPage: (tag) => nav.findPage(tag) as unknown as FakeView | null,
        getPreviousPage: (p) => nav.getPreviousPage(p as unknown as View) as unknown as FakeView | null,
        // `removeOnPop` is core-only; its NS-visible consequence is the page
        // leaving `pages` (and the grid), which every row still asserts.
        pageState: (p) => ({
            registered: nav.isRegistered(p as unknown as View),
            tag: nav.tagOf(p as unknown as View),
            title: nav.titleOf(p as unknown as View),
            canPop: nav.canPopOf(p as unknown as View),
        }),
    };

    /** The emitted signals reduced to the shape `navigationEventLog` produces. */
    const eventLog = (): NavigationEventRecord[] =>
        events.map((event) => ({
            type: event.name as NavigationEventRecord['type'],
            page: idOf(event.page),
        }));

    return { adapter, nav, children, ops, events, warnings, eventLog, idOf, page };
}

export default async () => {
    await describe('AdwNavigationView stack (libadwaita conformance vectors)', async () => {
        for (const vector of NAVIGATION_VIEW_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { adapter, eventLog } = makeNavigation();

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

                if (vector.expect.changes !== undefined) {
                    expect(eventLog()).toStrictEqual(navigationEventLog(vector.expect.changes));
                }
            });
        }
    });

    await describe('AdwNavigationView view tree', async () => {
        await it('overlays every registered page and raises only the top', () => {
            const { adapter, children, page } = makeNavigation();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));

            expect(children.map((view) => view.id)).toStrictEqual(['root', 'detail']);
            expect(page('root').visibility).toBe('collapse');
            expect(page('detail').visibility).toBe('visible');

            adapter.pop();
            expect(page('root').visibility).toBe('visible');
            expect(page('detail').visibility).toBe('collapse');
        });

        await it('tags every managed page with the navigation-page class', () => {
            const { adapter, page } = makeNavigation();
            page('root').className = 'my-page';
            adapter.add(page('root'));
            expect(page('root').className).toBe(`my-page ${NS_NAVIGATION_PAGE_CLASS}`);
            expect(navigationPageClassName(null)).toBe(NS_NAVIGATION_PAGE_CLASS);
        });

        await it('removes a dynamically-pushed page from the grid when it is popped', () => {
            // The regression: the old widget only did `this._stack.pop()`, so the
            // view leaked and a later push resurrected the same instance.
            const { adapter, children, ops, page } = makeNavigation();
            adapter.add(page('root'));
            adapter.push(page('sheet'));
            expect(children.map((view) => view.id)).toStrictEqual(['root', 'sheet']);

            adapter.pop();
            expect(children.map((view) => view.id)).toStrictEqual(['root']);
            expect(ops.filter((entry) => entry.op === 'detach').map((entry) => entry.page)).toStrictEqual(['sheet']);
            expect(adapter.pages().map((view) => view.id)).toStrictEqual(['root']);
        });

        await it('keeps a statically-added page in the grid across push and pop', () => {
            const { adapter, children, page } = makeNavigation();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));
            adapter.pop();
            expect(children.map((view) => view.id)).toStrictEqual(['root', 'detail']);
        });
    });

    await describe('AdwNavigationView signals', async () => {
        await it('emits pushed for the auto-push of the first added page', () => {
            // The old widget passed emit=false there, so a listener attached before
            // the first add() never saw the view become non-empty.
            const { adapter, events, idOf } = makeNavigation();
            adapter.add(adapter.page('root'), { tag: 'root' });
            expect(events.map((event) => event.name)).toStrictEqual([PUSHED, NOTIFY_VISIBLE_PAGE]);
            expect(events.map((event) => idOf(event.page))).toStrictEqual(['root', 'root']);
            expect(events[0]!.tag).toBe('root');
            expect(events[1]!.depth).toBe(1);
        });

        await it('emits one popped per page of an atomic pop-to', () => {
            const { adapter, events, idOf, page } = makeNavigation();
            adapter.add(page('a'), { tag: 'a' });
            adapter.push(page('b'));
            adapter.push(page('c'));
            events.length = 0;

            expect(adapter.popToTag('a')).toBe(true);
            expect(events.map((event) => event.name)).toStrictEqual([POPPED, POPPED, NOTIFY_VISIBLE_PAGE]);
            expect(events.map((event) => idOf(event.page))).toStrictEqual(['c', 'b', 'a']);
        });

        await it('emits replaced without any popped', () => {
            const { adapter, events, page } = makeNavigation();
            adapter.add(page('a'));
            adapter.add(page('b'));
            events.length = 0;
            adapter.replace([page('b'), page('a')]);
            expect(events.map((event) => event.name)).toStrictEqual([REPLACED]);
        });

        await it('reports a rejected mutation instead of failing silently', () => {
            const { adapter, warnings, page } = makeNavigation();
            adapter.add(page('a'), { tag: 'x' });
            adapter.add(page('b'), { tag: 'x' });
            adapter.pushByTag('nope');
            expect(warnings).toStrictEqual(['duplicate-tag', 'tag-not-found']);
        });
    });
};
