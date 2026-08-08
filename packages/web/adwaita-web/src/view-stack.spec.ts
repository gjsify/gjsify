// DOM-level conformance tests for <adw-view-stack>, driven by the SAME vectors
// the core suite and the NativeScript renderer assert against
// (`@gjsify/adwaita-core/conformance`).
//
// The two renderers used to carry independent copies of the selection logic —
// the same four-clause index guard, the same `findIndex` by name, the same
// `?? ''` fallbacks — and both had drifted away from libadwaita in the same
// ways: `visibleChildIndex = 1.5` passed the `Number.isFinite` guard and blanked
// the entire stack, the per-page `visible` flag did not exist so the auto-pick
// took the first page ADDED instead of the first VISIBLE one, an empty
// `visible-child-name` was treated as "no name" by the declarative path but as a
// legal lookup by the property path, and the auto-pick notified nothing so a
// bound switcher needed a manual `refresh()`. Nothing failed, because nothing
// compared them. This suite is that comparison.
import { describe, expect, it } from '@gjsify/unit';

import type { ViewStackVectorChange, ViewStackVectorOp, ViewStackVectorPage } from '@gjsify/adwaita-core/conformance';
import {
    VIEW_STACK_ICON_NAME_VECTORS,
    VIEW_STACK_PAGE_VECTORS,
    VIEW_STACK_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import type { AdwViewStack } from './elements/adw-view-stack.js';

/** A stack mounted from markup, with every `notify::visible-child` recorded. */
interface MountedStack {
    stack: AdwViewStack;
    host: HTMLElement;
    changes: ViewStackVectorChange[];
}

/**
 * Mount a stack whose pages are DECLARED as markup, driving the attribute path.
 *
 * Attributes are set through `setAttribute` rather than an HTML string on
 * purpose: several vectors hinge on an exact name — the empty string, the NFD
 * spelling of `Übersicht` — which an attribute value in parsed markup is not a
 * reliable carrier for. The change listener is attached BEFORE the element is
 * connected so the auto-pick notification is observable, which is the whole
 * point of the fix that made it fire at all.
 */
function mountStack(pages: readonly ViewStackVectorPage[], visibleChildName?: string): MountedStack {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const stack = document.createElement('adw-view-stack') as AdwViewStack;
    if (visibleChildName !== undefined) stack.setAttribute('visible-child-name', visibleChildName);

    for (const page of pages) {
        const pageEl = document.createElement('adw-view-stack-page');
        pageEl.setAttribute('name', page.name);
        if (page.title !== undefined) pageEl.setAttribute('title', page.title);
        if (page.icon !== undefined) pageEl.setAttribute('icon-name', page.icon);
        if (page.visible === false) pageEl.setAttribute('hidden', '');
        const body = document.createElement('p');
        body.className = 'page-body';
        body.textContent = page.name;
        pageEl.appendChild(body);
        stack.appendChild(pageEl);
    }

    const changes: ViewStackVectorChange[] = [];
    stack.addEventListener('notify::visible-child', (event) => {
        changes.push((event as CustomEvent<ViewStackVectorChange>).detail);
    });

    host.appendChild(stack);
    return { stack, host, changes };
}

/** Apply one vector op through the element's own public surface. */
function applyOp(stack: AdwViewStack, op: ViewStackVectorOp): void {
    switch (op.kind) {
        case 'selectIndex':
            stack.visibleChildIndex = op.index;
            break;
        case 'selectName':
            stack.visibleChildName = op.name;
            break;
        case 'setPageVisible':
            stack.setPageVisible(op.name, op.visible);
            break;
        case 'removePage':
            stack.removePage(op.name);
            break;
    }
}

/** Which page wrappers are actually SHOWN — what the user sees, not what the model says. */
function shownPages(stack: AdwViewStack): boolean[] {
    const wrappers = Array.from(stack.querySelectorAll(':scope > .adw-view-stack-child')) as HTMLElement[];
    return wrappers.map((wrapper) => !wrapper.hidden);
}

export const AdwViewStackTest = async () => {
    await describe('adw-view-stack selection (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_STACK_VECTORS) {
            await it(vector.rule, () => {
                const { stack, host, changes } = mountStack(vector.pages);

                expect(changes).toStrictEqual([...vector.setupChanges]);

                changes.length = 0;
                for (const op of vector.ops) applyOp(stack, op);

                expect(changes).toStrictEqual([...vector.changes]);
                expect(stack.visibleChildIndex).toBe(vector.visibleIndex);
                expect(stack.visibleChildName).toBe(vector.visibleName);
                expect(stack.pages.length).toBe(vector.count);
                expect(stack.pages[stack.visibleChildIndex]?.title ?? '').toBe(vector.visibleTitle);

                // The DOM must agree with the model: exactly the selected page is
                // shown, and nothing at all when the selection is -1. A stack that
                // stored an unreachable index (the 1.5 bug) showed NOTHING while
                // still reporting a selection.
                const expectedShown = vector.pages.map(() => false).slice(0, vector.count);
                if (vector.visibleIndex >= 0) expectedShown[vector.visibleIndex] = true;
                expect(shownPages(stack)).toStrictEqual(expectedShown);
                expect(stack.visibleChild).toBe(
                    vector.visibleIndex >= 0 ? (stack.pages[vector.visibleIndex]?.content ?? null) : null,
                );

                host.remove();
            });
        }
    });

    await describe('adw-view-stack page descriptors (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_STACK_PAGE_VECTORS) {
            await it(vector.rule, () => {
                const { stack, host } = mountStack([vector.page]);
                const page = stack.pages[0]!;
                expect(page.name).toBe(vector.page.name);
                expect(page.title).toBe(vector.title);
                expect(page.icon).toBe(vector.icon);
                expect(page.visible).toBe(vector.visible);
                host.remove();
            });
        }

        for (const { icon, normalized, rule } of VIEW_STACK_ICON_NAME_VECTORS) {
            // `null`/`undefined` have no attribute spelling — an absent icon-name
            // is the same input and is covered by the page-descriptor rows above.
            if (typeof icon !== 'string') continue;
            await it(`icon-name="${icon}" → ${JSON.stringify(normalized)} — ${rule}`, () => {
                const { stack, host } = mountStack([{ name: 'a', icon }]);
                expect(stack.pages[0]!.icon).toBe(normalized);
                host.remove();
            });
        }

        await it('adopts the declared markup as the page BODY, dropping the wrapper tag', () => {
            const { stack, host } = mountStack([{ name: 'learn' }, { name: 'code' }]);
            expect(stack.querySelectorAll('adw-view-stack-page').length).toBe(0);
            expect(stack.pages[0]!.content!.querySelector('.page-body')!.textContent).toBe('learn');
            host.remove();
        });
    });

    await describe('adw-view-stack imperative pages (Adw.ViewStack.add)', async () => {
        await it('keeps pages added BEFORE the stack enters the document', () => {
            // The regression: connectedCallback used to overwrite the page list
            // with whatever <adw-view-stack-page> children it found — none, for
            // imperative use — and then replaceChildren() the subtree away, so
            // this exact order silently destroyed the caller's element.
            // libadwaita has no parse-once phase (adw-view-stack.c:2160-2251).
            const stack = document.createElement('adw-view-stack') as AdwViewStack;
            const content = document.createElement('div');
            content.textContent = 'learn body';
            stack.add(content, 'learn', 'Learn');

            document.body.appendChild(stack);

            expect(stack.pages.length).toBe(1);
            expect(stack.visibleChildName).toBe('learn');
            expect(content.isConnected).toBe(true);
            expect(content.hidden).toBe(false);
            stack.remove();
        });

        await it('notifies for the auto-shown first page, so a bound switcher needs no refresh()', () => {
            const stack = document.createElement('adw-view-stack') as AdwViewStack;
            const changes: ViewStackVectorChange[] = [];
            stack.addEventListener('notify::visible-child', (event) => {
                changes.push((event as CustomEvent<ViewStackVectorChange>).detail);
            });
            document.body.appendChild(stack);

            stack.add(document.createElement('div'), 'learn', 'Learn');
            stack.add(document.createElement('div'), 'code', 'Code');

            expect(changes).toStrictEqual([{ index: 0, name: 'learn', title: 'Learn', interactive: false }]);
            stack.remove();
        });

        await it('detaches the content when a page is removed', () => {
            const stack = document.createElement('adw-view-stack') as AdwViewStack;
            document.body.appendChild(stack);
            const first = document.createElement('div');
            const second = document.createElement('div');
            stack.add(first, 'learn');
            stack.add(second, 'code');

            expect(stack.removePage('learn')).toBe(true);
            expect(first.isConnected).toBe(false);
            expect(second.isConnected).toBe(true);
            // The removed page WAS the visible one, so nothing is shown now.
            expect(stack.visibleChildIndex).toBe(-1);
            expect(second.hidden).toBe(true);
            stack.remove();
        });
    });

    await describe('adw-view-stack visible-child-name attribute', async () => {
        await it('selects the declared page instead of the auto-pick', () => {
            const { stack, host } = mountStack([{ name: 'learn' }, { name: 'code' }], 'code');
            expect(stack.visibleChildName).toBe('code');
            expect(shownPages(stack)).toStrictEqual([false, true]);
            host.remove();
        });

        await it('treats an EMPTY declared name as a legal lookup, not as "no name"', () => {
            // The declarative path used `initialName ? … : -1`, so an explicit
            // empty name fell through to page 0 while the PROPERTY path matched
            // the page named '' — one port, two answers for one input.
            // g_strcmp0("", "") is 0 (adw-view-stack.c:901).
            const { stack, host } = mountStack([{ name: 'a' }, { name: '' }], '');
            expect(stack.visibleChildIndex).toBe(1);
            expect(shownPages(stack)).toStrictEqual([false, true]);
            host.remove();
        });

        await it('reflects the selection back, including an empty name', () => {
            const { stack, host } = mountStack([{ name: 'a' }, { name: '' }]);
            expect(stack.getAttribute('visible-child-name')).toBe('a');
            stack.visibleChildIndex = 1;
            // The old reflection was guarded by `if (current && …)`, so a stack of
            // nameless pages never reflected its selection at all.
            expect(stack.getAttribute('visible-child-name')).toBe('');
            host.remove();
        });

        await it('drops the attribute when nothing is selected', () => {
            const { stack, host } = mountStack([{ name: 'a' }]);
            expect(stack.getAttribute('visible-child-name')).toBe('a');
            stack.removePage('a');
            expect(stack.hasAttribute('visible-child-name')).toBe(false);
            host.remove();
        });

        await it('drives the selection when the attribute changes later', () => {
            const { stack, host, changes } = mountStack([{ name: 'learn' }, { name: 'code' }]);
            changes.length = 0;
            stack.setAttribute('visible-child-name', 'code');
            expect(stack.visibleChildIndex).toBe(1);
            expect(changes).toStrictEqual([{ index: 1, name: 'code', title: 'code', interactive: true }]);
            host.remove();
        });

        await it('does not bounce the selection back when a duplicate name is reflected', () => {
            // Reflection writes the attribute, which re-enters
            // attributeChangedCallback; with duplicate names a naive re-lookup
            // would resolve to the FIRST match and undo the selection.
            const { stack, host } = mountStack([{ name: 'dup' }, { name: 'dup' }]);
            stack.visibleChildIndex = 1;
            expect(stack.visibleChildIndex).toBe(1);
            expect(stack.getAttribute('visible-child-name')).toBe('dup');
            host.remove();
        });
    });
};
