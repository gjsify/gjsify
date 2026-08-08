// AdwViewStack conformance tests, driven by the SAME vectors the core suite and
// the `<adw-view-stack>` browser suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this imports `./widgets/view-stack-state.js`, NOT the widget. A
// widget module `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node,
// so `adw-view-stack.ts` cannot be loaded here. It is a thin `GridLayout`
// wrapper over exactly the surface below: `add()` forwards to
// `state.addPage({ name, title, icon, content })`, every accessor forwards to
// the same state, and the subscription applies {@link applyViewStackVisibility}
// and notifies {@link viewStackNotifyPayload}.
//
// The suite this replaces was a `MockViewStack` in `index.spec.ts` that
// transcribed the widget's own guards — the same `Number.isFinite` check, the
// same `findIndex`, the same `?? ''`. A test that re-implements the code under
// test cannot detect the drift it exists to catch, and in this family it did
// not: the mock, the web port and the NS port all accepted a fractional index
// and all lacked the per-page `visible` flag.
import { describe, expect, it } from '@gjsify/unit';

import type { ViewStackVectorChange, ViewStackVectorOp, ViewStackVectorPage } from '@gjsify/adwaita-core/conformance';
import {
    VIEW_STACK_ICON_NAME_VECTORS,
    VIEW_STACK_PAGE_VECTORS,
    VIEW_STACK_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { ViewStackState } from '@gjsify/adwaita-core';
import type { View } from '@nativescript/core';

import {
    applyViewStackVisibility,
    createViewStackState,
    pageVisibilities,
    viewStackNotifyPayload,
    type NsPageVisibility,
} from './widgets/view-stack-state.js';

/**
 * A stand-in for a page's content view. Only `visibility` is ever touched by the
 * stack, so this is the whole contract — not a re-implementation of anything.
 */
function fakeView(): View {
    return { visibility: 'visible' } as unknown as View;
}

/** Apply one vector op through the surface the widget's accessors forward to. */
function applyOp(state: ViewStackState<View>, op: ViewStackVectorOp): boolean {
    switch (op.kind) {
        case 'selectIndex':
            return state.setVisibleIndex(op.index);
        case 'selectName':
            return state.setVisibleName(op.name);
        case 'setPageVisible':
            return state.setPageVisible(op.name, op.visible);
        case 'removePage':
            return state.removePage(op.name);
    }
}

/** Seed a stack state with the vector's pages, each backed by its own fake view. */
function seed(state: ViewStackState<View>, pages: readonly ViewStackVectorPage[]): void {
    // Exactly what `AdwViewStack.add()` forwards, plus the `visible` flag that
    // `AdwViewStackPage:visible` carries (adw-view-stack.c:475-479).
    for (const page of pages) state.addPage({ ...page, content: fakeView() });
}

export default async () => {
    await describe('AdwViewStack selection (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_STACK_VECTORS) {
            await it(vector.rule, () => {
                const state = createViewStackState();
                const changes: ViewStackVectorChange[] = [];
                state.subscribe((change) => changes.push(viewStackNotifyPayload(change)));

                seed(state, vector.pages);
                expect(changes).toStrictEqual([...vector.setupChanges]);

                changes.length = 0;
                const results = vector.ops.map((op) => applyOp(state, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.visibleIndex).toBe(vector.visibleIndex);
                expect(state.visibleName).toBe(vector.visibleName);
                expect(state.visibleTitle).toBe(vector.visibleTitle);
                expect(state.count).toBe(vector.count);
                expect(state.visiblePage?.content ?? null).toBe(
                    vector.visibleIndex >= 0 ? (state.pages[vector.visibleIndex]!.content ?? null) : null,
                );

                // The native projection must agree with the model: exactly the
                // selected page is `visible`, and NOTHING is when the selection is
                // -1. Both ports used to collapse every page while still reporting
                // a selection whenever the index was unreachable.
                const expected: NsPageVisibility[] = state.pages.map(() => 'collapse');
                if (vector.visibleIndex >= 0) expected[vector.visibleIndex] = 'visible';
                expect(pageVisibilities(state)).toStrictEqual(expected);

                applyViewStackVisibility(state);
                expect(state.pages.map((page) => page.content!.visibility)).toStrictEqual(expected);
            });
        }
    });

    await describe('AdwViewStack page descriptors (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_STACK_PAGE_VECTORS) {
            await it(vector.rule, () => {
                const state = createViewStackState();
                const page = state.addPage({ ...vector.page, content: fakeView() });
                expect(page.name).toBe(vector.page.name);
                expect(page.title).toBe(vector.title);
                expect(page.icon).toBe(vector.icon);
                expect(page.visible).toBe(vector.visible);
            });
        }

        for (const { icon, normalized, rule } of VIEW_STACK_ICON_NAME_VECTORS) {
            await it(`icon ${JSON.stringify(icon)} → ${JSON.stringify(normalized)} — ${rule}`, () => {
                const state = createViewStackState();
                // A bound switcher bar reads `page.icon` unconditionally; the NS
                // port used to store `undefined` here, which the web switcher's
                // `page.icon.length` would have thrown on.
                expect(state.addPage({ name: 'a', icon, content: fakeView() }).icon).toBe(normalized);
            });
        }
    });

    await describe('AdwViewStack native projection', async () => {
        await it('swaps `visibility` rather than reordering — NS has no page stack', () => {
            const state = createViewStackState();
            const first = fakeView();
            const second = fakeView();
            state.addPage({ name: 'learn', content: first });
            state.addPage({ name: 'code', content: second });
            applyViewStackVisibility(state);
            expect([first.visibility, second.visibility]).toStrictEqual(['visible', 'collapse']);

            state.setVisibleName('code');
            // `applyViewStackVisibility` PUSHES the current state onto the views;
            // it does not subscribe. The widget re-applies from its own change
            // listener, so the spec has to do the same.
            applyViewStackVisibility(state);
            expect([first.visibility, second.visibility]).toStrictEqual(['collapse', 'visible']);
        });

        await it('leaves a page without content alone instead of throwing', () => {
            const state = createViewStackState();
            state.addPage({ name: 'headless' });
            applyViewStackVisibility(state);
            expect(state.visibleName).toBe('headless');
        });

        await it('emits a payload that carries no live model object', () => {
            // The event escapes into consumer code; handing out the descriptor
            // would let a listener mutate the stack's own page record.
            const state = createViewStackState();
            const payloads: ViewStackVectorChange[] = [];
            state.subscribe((change) => payloads.push(viewStackNotifyPayload(change)));
            state.addPage({ name: 'learn', title: 'Learn', content: fakeView() });

            expect(payloads).toStrictEqual([{ index: 0, name: 'learn', title: 'Learn', interactive: false }]);
            expect(Object.keys(payloads[0]!).sort()).toStrictEqual(['index', 'interactive', 'name', 'title']);
        });
    });
};
