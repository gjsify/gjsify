// View-stack selection specs — driven by the shared conformance vectors, so
// this suite and the two renderer suites assert the SAME table.

import { describe, it, expect } from '@gjsify/unit';

import { ViewStackState, normalizeIconName, resolvePageTitle, type ViewStackStateChange } from './view-stack.js';
import {
    VIEW_STACK_ICON_NAME_VECTORS,
    VIEW_STACK_PAGE_VECTORS,
    VIEW_STACK_VECTORS,
    type ViewStackVectorChange,
    type ViewStackVectorOp,
} from './conformance/view-stack.js';

/** The comparable half of a change — the renderer suites re-emit exactly this. */
function plain(change: ViewStackStateChange): ViewStackVectorChange {
    return { index: change.index, name: change.name, title: change.title, interactive: change.interactive };
}

/** Apply one vector op through the core surface, returning whether it changed anything. */
function applyOp(state: ViewStackState, op: ViewStackVectorOp): boolean {
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

export default async () => {
    await describe('ViewStackState (Adw.ViewStack selection conformance vectors)', async () => {
        for (const vector of VIEW_STACK_VECTORS) {
            await it(vector.rule, () => {
                const state = new ViewStackState();
                const changes: ViewStackVectorChange[] = [];
                state.subscribe((change) => changes.push(plain(change)));

                for (const page of vector.pages) state.addPage(page);
                expect(changes).toStrictEqual([...vector.setupChanges]);

                changes.length = 0;
                const results = vector.ops.map((op) => applyOp(state, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(changes).toStrictEqual([...vector.changes]);
                expect(state.visibleIndex).toBe(vector.visibleIndex);
                expect(state.visibleName).toBe(vector.visibleName);
                expect(state.visibleTitle).toBe(vector.visibleTitle);
                expect(state.count).toBe(vector.count);
                // -1 and `undefined` must agree — a renderer reads `.content` off
                // `visiblePage` and would otherwise paint page 0 for "none".
                expect(state.visiblePage === undefined).toBe(vector.visibleIndex < 0);
                if (vector.duplicateNames) expect([...state.duplicateNames]).toStrictEqual([...vector.duplicateNames]);
                if (vector.diagnostics) expect([...state.diagnostics]).toStrictEqual([...vector.diagnostics]);
            });
        }
    });

    await describe('ViewStackState page descriptors', async () => {
        for (const vector of VIEW_STACK_PAGE_VECTORS) {
            await it(vector.rule, () => {
                const state = new ViewStackState();
                const info = state.addPage(vector.page);
                expect(info.name).toBe(vector.page.name);
                expect(info.title).toBe(vector.title);
                expect(info.icon).toBe(vector.icon);
                expect(info.visible).toBe(vector.visible);
                expect(state.pages[0]).toBe(info);
            });
        }

        await it('exposes the pages frozen, so a bound switcher cannot mutate the model', () => {
            const state = new ViewStackState();
            state.addPage({ name: 'a' });
            expect(Object.isFrozen(state.pages)).toBe(true);
        });

        await it('carries the renderer content through untouched', () => {
            const content = { node: 'opaque' };
            const state = new ViewStackState<typeof content>();
            state.addPage({ name: 'a', content });
            expect(state.visiblePage?.content).toBe(content);
        });
    });

    await describe('ViewStackState.indexOfName / isSelected', async () => {
        await it('finds the first exact match, -1 when absent (find_page_for_name)', () => {
            const state = new ViewStackState();
            for (const name of ['a', 'dup', 'c', 'dup']) state.addPage({ name });
            expect(state.indexOfName('dup')).toBe(1);
            expect(state.indexOfName('missing')).toBe(-1);
            expect(state.indexOfName('')).toBe(-1);
        });

        await it('reports an out-of-range position as not selected, never as an error', () => {
            // adw_view_stack_pages_is_selected, adw-view-stack.c:659-672.
            const state = new ViewStackState();
            for (const name of ['a', 'b', 'c']) state.addPage({ name });
            state.setVisibleIndex(1);
            expect(state.isSelected(1)).toBe(true);
            expect(state.isSelected(0)).toBe(false);
            expect(state.isSelected(3)).toBe(false);
            expect(state.isSelected(-1)).toBe(false);
            expect(state.isSelected(1.5)).toBe(false);
        });
    });

    await describe('ViewStackState.duplicateNames', async () => {
        await it('is DERIVED from the current pages, so removing the duplicate clears it', () => {
            // C only warns once, at add time (adw-view-stack.c:1122). Deriving the
            // list instead of logging it keeps it honest after a removal, while
            // `diagnostics` stays the append-only record of what C would have printed.
            const state = new ViewStackState();
            for (const name of ['dup', 'other', 'dup']) state.addPage({ name });
            expect([...state.duplicateNames]).toStrictEqual(['dup']);
            expect([...state.diagnostics]).toStrictEqual([
                'While adding page: duplicate child name in AdwViewStack: dup',
            ]);

            state.removePage('dup');
            expect([...state.duplicateNames]).toStrictEqual([]);
        });
    });

    await describe('ViewStackState.subscribe', async () => {
        await it('returns an unsubscribe that stops further changes', () => {
            const state = new ViewStackState();
            let calls = 0;
            const unsubscribe = state.subscribe(() => calls++);
            state.addPage({ name: 'a' });
            expect(calls).toBe(1);
            unsubscribe();
            state.addPage({ name: 'b' });
            state.setVisibleIndex(1);
            expect(calls).toBe(1);
        });

        await it('cannot skip a listener when one unsubscribes mid-fan-out', () => {
            const state = new ViewStackState();
            const hits: number[] = [];
            const first = state.subscribe(() => {
                hits.push(1);
                first();
            });
            state.subscribe(() => hits.push(2));
            state.addPage({ name: 'a' });
            expect(hits).toStrictEqual([1, 2]);
        });
    });

    await describe('normalizeIconName / resolvePageTitle', async () => {
        for (const { icon, normalized, rule } of VIEW_STACK_ICON_NAME_VECTORS) {
            await it(`${JSON.stringify(icon)} → ${JSON.stringify(normalized)} — ${rule}`, () => {
                expect(normalizeIconName(icon)).toBe(normalized);
            });
        }

        await it('falls a missing title back to the name, but keeps an explicit empty one', () => {
            expect(resolvePageTitle(undefined, 'learn')).toBe('learn');
            expect(resolvePageTitle(null, 'learn')).toBe('learn');
            expect(resolvePageTitle('', 'learn')).toBe('');
            expect(resolvePageTitle('Learn', 'learn')).toBe('Learn');
        });
    });
};
