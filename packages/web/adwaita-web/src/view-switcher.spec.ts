// DOM-level conformance tests for <adw-view-switcher>,
// <adw-inline-view-switcher> and <adw-view-switcher-bar>, driven by the SAME
// vectors the core suite and the NativeScript suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// The two renderers used to carry independent copies of everything a switcher
// derives, and FIVE libadwaita rules lived in neither of them: the
// button-visibility predicate `visible && (title != NULL || icon-name != NULL)`,
// the `image-missing` icon fallback, the bar's `reveal && more-than-one-visible-
// page` gate, the inline switcher's two index spaces, and the badge /
// needs-attention label with the screen-reader description AdwIndicatorBin
// derives from them. On top of that the browser switcher CLAMPED an out-of-range
// index into range where libadwaita refuses. Nothing failed, because nothing
// compared them. This suite is that comparison.
import { describe, expect, it } from '@gjsify/unit';

import {
    INLINE_TOGGLE_VECTORS,
    INLINE_TOOLTIP_VECTORS,
    VIEW_SWITCHER_BAR_REVEAL_VECTORS,
    VIEW_SWITCHER_BUTTON_VECTORS,
    VIEW_SWITCHER_SELECTION_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type {
    ViewSwitcherVectorChange,
    ViewSwitcherVectorOp,
    ViewSwitcherVectorPage,
} from '@gjsify/adwaita-core/conformance';
import { VIEW_SWITCHER_DRAG_SWITCH_DELAY, normalizeIconName } from '@gjsify/adwaita-core';

import type { AdwViewSwitcher } from './elements/adw-view-switcher.js';
import type { AdwInlineViewSwitcher } from './elements/adw-inline-view-switcher.js';
import type { AdwViewSwitcherBar } from './elements/adw-view-switcher-bar.js';
import type { AdwViewStack } from './elements/adw-view-stack.js';

/** Declare one vector page as markup, keeping "absent" and "empty" distinct. */
function declarePage(tag: string, page: ViewSwitcherVectorPage): HTMLElement {
    const element = document.createElement(tag);
    element.setAttribute('name', page.name);
    // `getAttribute` returns null for an absent attribute, which IS C's NULL —
    // so an absent or explicitly-null title must not become `title=""`.
    if (typeof page.title === 'string') element.setAttribute('title', page.title);
    if (typeof page.iconName === 'string') element.setAttribute('icon-name', page.iconName);
    if (page.visible === false) element.setAttribute('hidden', '');
    if (page.useUnderline) element.setAttribute('use-underline', '');
    if (page.badgeNumber) element.setAttribute('badge-number', String(page.badgeNumber));
    if (page.needsAttention) element.setAttribute('needs-attention', '');

    const body = document.createElement('p');
    body.className = 'page-body';
    body.textContent = page.name;
    element.appendChild(body);
    return element;
}

/** A mounted switcher, with every selection change recorded in vector shape. */
interface Mounted<T extends HTMLElement> {
    element: T;
    host: HTMLElement;
    changes: ViewSwitcherVectorChange[];
}

/** Mount an <adw-view-switcher> whose pages are DECLARED as markup. */
function mountSwitcher(pages: readonly ViewSwitcherVectorPage[], policy?: string): Mounted<AdwViewSwitcher> {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const element = document.createElement('adw-view-switcher') as AdwViewSwitcher;
    if (policy !== undefined) element.setAttribute('policy', policy);
    for (const page of pages) element.appendChild(declarePage('adw-view-switcher-page', page));

    const changes: ViewSwitcherVectorChange[] = [];
    // The listener is attached BEFORE the element connects so the auto-pick
    // notification is observable — the switcher used to be silent there.
    element.addEventListener('notify::visible-child', (event) => {
        const detail = (event as CustomEvent<{ index: number; name: string; title: string; interactive: boolean }>)
            .detail;
        changes.push({
            selected: detail.index,
            name: detail.name,
            title: detail.title,
            interactive: detail.interactive,
        });
    });

    host.appendChild(element);
    return { element, host, changes };
}

/** Mount an <adw-inline-view-switcher> whose pages are DECLARED as markup. */
function mountInline(pages: readonly ViewSwitcherVectorPage[], displayMode?: string): Mounted<AdwInlineViewSwitcher> {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const element = document.createElement('adw-inline-view-switcher') as AdwInlineViewSwitcher;
    if (displayMode !== undefined) element.setAttribute('display-mode', displayMode);
    for (const page of pages) element.appendChild(declarePage('adw-view-stack-page', page));

    const changes: ViewSwitcherVectorChange[] = [];
    element.addEventListener('notify::active', (event) => {
        const detail = (event as CustomEvent<{ active: number; name: string; interactive: boolean }>).detail;
        changes.push({ selected: detail.active, name: detail.name, title: '', interactive: detail.interactive });
    });

    host.appendChild(element);
    return { element, host, changes };
}

/** Apply one vector op through the element's own public surface. */
function applyOp(element: AdwViewSwitcher, op: ViewSwitcherVectorOp): void {
    switch (op.kind) {
        case 'selectIndex':
            element.active = op.index;
            break;
        case 'selectName':
            element.visibleChildName = op.name;
            break;
        case 'setPageVisible':
            element.setPageVisible(op.name, op.visible);
            break;
    }
}

/** The rendered buttons of a switcher, in page order. */
function buttonsOf(element: HTMLElement, selector: string): HTMLElement[] {
    return Array.from(element.querySelectorAll(selector)) as HTMLElement[];
}

/** The text of a button's parts, `null` when the part is absent. */
function partText(button: HTMLElement, selector: string): string | null {
    const part = button.querySelector(selector) as HTMLElement | null;
    return part ? (part.textContent ?? '') : null;
}

export const AdwViewSwitcherTest = async () => {
    await describe('adw-view-switcher buttons (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_BUTTON_VECTORS) {
            // A `selected: -1` row cannot be staged here: this element bundles its
            // own stack, whose auto-pick takes the first visible page, and the only
            // way to reach "nothing selected" is to hide every page — which would
            // change the very `visible` flags the row is asserting. The core suite
            // drives that row directly.
            if (vector.selected < 0) continue;
            await it(vector.rule, () => {
                const { element, host } = mountSwitcher(vector.pages, vector.policy);
                // The vectors carry an explicit selection; drive it through the
                // element rather than assuming the auto-pick landed there.
                element.active = vector.selected;

                const buttons = buttonsOf(element, '.adw-view-switcher-button');
                expect(buttons).toHaveLength(vector.buttons.length);

                vector.buttons.forEach((model, index) => {
                    const button = buttons[index]!;
                    // The button-visibility rule, which BOTH ports lacked.
                    expect(button.hidden).toBe(!model.visible);
                    expect(button.getAttribute('aria-selected')).toBe(String(model.selected));
                    expect(partText(button, '.adw-view-switcher-label')).toBe(model.label);
                    // The icon node always exists and always names an icon —
                    // `image-missing` when the page has none.
                    const icon = button.querySelector('.adw-icon') as HTMLElement;
                    expect(icon.classList.contains(`adw-icon--${normalizeIconName(model.iconName)}`)).toBe(true);
                    expect(partText(button, '.adw-view-switcher-indicator')).toBe(model.badgeLabel);
                    expect(button.getAttribute('aria-description')).toBe(model.description || null);
                });

                // The policy style class lives on the single `viewswitcher` node.
                expect(element.classList.contains(vector.policy)).toBe(true);
                host.remove();
            });
        }

        await it('hides a titleless, iconless button in the LAYOUT, not just visually', () => {
            // The `[hidden]` UA rule loses to the component's own author
            // `display: inline-flex` unless the stylesheet re-asserts it — the
            // same cascade trap the switcher BAR was fixed for.
            const { element, host } = mountSwitcher([{ name: 'a', title: 'A' }, { name: 'b' }]);
            const buttons = buttonsOf(element, '.adw-view-switcher-button');
            expect(getComputedStyle(buttons[1]!).display).toBe('none');
            expect(getComputedStyle(buttons[0]!).display).not.toBe('none');
            host.remove();
        });
    });

    await describe('adw-view-switcher selection (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_SELECTION_VECTORS) {
            await it(vector.rule, () => {
                const { element, host, changes } = mountSwitcher(vector.pages);
                expect(changes).toStrictEqual([...vector.setupChanges]);

                changes.length = 0;
                for (const op of vector.ops) applyOp(element, op);

                expect(changes).toStrictEqual([...vector.changes]);
                expect(element.active).toBe(vector.selected);
                expect(element.visibleChildName).toBe(vector.selectedName);

                // The DOM must agree with the model: exactly the selected page's
                // body is shown, and none at all when the selection is -1.
                const bodies = buttonsOf(element, '.adw-view-switcher-page');
                const shown = bodies.map((body) => !(body as HTMLElement).hidden);
                const expectedShown = vector.pages.map((_page, index) => index === vector.selected);
                expect(shown).toStrictEqual(expectedShown);

                // The reflected attribute must not claim a selection that was
                // refused — the old element clamped instead, so `active="99"`
                // silently became the last page.
                expect(element.getAttribute('active')).toBe(String(vector.selected));
                host.remove();
            });
        }

        await it('dispatches notify::policy, which the header only ever promised', () => {
            const { element, host } = mountSwitcher([{ name: 'a', title: 'A' }]);
            const policies: string[] = [];
            element.addEventListener('notify::policy', (event) => {
                policies.push((event as CustomEvent<{ policy: string }>).detail.policy);
            });

            element.policy = 'wide';
            expect(element.policy).toBe('wide');
            element.policy = 'wide'; // idempotent — no second event
            expect(policies).toStrictEqual(['wide']);

            // An unrecognised value is REFUSED and keeps the current policy.
            element.setAttribute('policy', 'bogus');
            expect(element.policy).toBe('wide');
            expect(policies).toStrictEqual(['wide']);
            host.remove();
        });

        await it('scopes its page query, so a nested switcher keeps its own pages', () => {
            // Both switchers use the same tag for their pages; an unscoped
            // querySelectorAll let the outer one adopt the inner one's.
            const host = document.createElement('div');
            document.body.appendChild(host);

            const outer = document.createElement('adw-view-switcher') as AdwViewSwitcher;
            const outerPage = declarePage('adw-view-switcher-page', { name: 'outer', title: 'Outer' });
            const inner = document.createElement('adw-view-switcher') as AdwViewSwitcher;
            inner.appendChild(declarePage('adw-view-switcher-page', { name: 'inner-a', title: 'A' }));
            inner.appendChild(declarePage('adw-view-switcher-page', { name: 'inner-b', title: 'B' }));
            outerPage.appendChild(inner);
            outer.appendChild(outerPage);
            host.appendChild(outer);

            expect(outer.pages.map((page) => page.name)).toStrictEqual(['outer']);
            expect(inner.pages.map((page) => page.name)).toStrictEqual(['inner-a', 'inner-b']);
            host.remove();
        });

        await it('switches pages after a 500 ms drag hover, and not before', async () => {
            const { element, host } = mountSwitcher([
                { name: 'a', title: 'A' },
                { name: 'b', title: 'B' },
                { name: 'c', title: 'C' },
            ]);
            const buttons = buttonsOf(element, '.adw-view-switcher-button');

            buttons[2]!.dispatchEvent(new Event('dragenter'));
            await new Promise((resolve) => setTimeout(resolve, VIEW_SWITCHER_DRAG_SWITCH_DELAY / 2));
            expect(element.active).toBe(0);

            await new Promise((resolve) => setTimeout(resolve, VIEW_SWITCHER_DRAG_SWITCH_DELAY));
            expect(element.active).toBe(2);

            // Leaving before the dwell elapses cancels it.
            buttons[0]!.dispatchEvent(new Event('dragenter'));
            buttons[0]!.dispatchEvent(new Event('dragleave'));
            await new Promise((resolve) => setTimeout(resolve, VIEW_SWITCHER_DRAG_SWITCH_DELAY * 1.5));
            expect(element.active).toBe(2);
            host.remove();
        });
    });

    await describe('adw-inline-view-switcher toggles (libadwaita conformance vectors)', async () => {
        for (const vector of INLINE_TOGGLE_VECTORS) {
            await it(vector.rule, () => {
                const { element, host } = mountInline(vector.pages, vector.displayMode);

                const toggles = buttonsOf(element, '.adw-inline-view-switcher-toggle');
                // A hidden page produces NO toggle — the whole reason the two
                // index spaces exist. The old element made one per declared page.
                expect(toggles).toHaveLength(vector.toggles.length);

                vector.toggles.forEach((model, index) => {
                    const toggle = toggles[index]!;
                    expect(toggle.dataset.toggleIndex).toBe(String(model.toggleIndex));
                    expect(toggle.dataset.pageIndex).toBe(String(model.pageIndex));
                    expect(partText(toggle, '.adw-inline-view-switcher-label')).toBe(
                        model.showLabel ? model.label : null,
                    );
                    const icon = toggle.querySelector('.adw-icon') as HTMLElement | null;
                    expect(icon !== null).toBe(model.showIcon);
                    if (icon) {
                        expect(icon.classList.contains(`adw-icon--${normalizeIconName(model.iconName)}`)).toBe(true);
                    }
                    expect(toggle.getAttribute('title')).toBe(model.tooltip || null);
                    expect(partText(toggle, '.adw-inline-view-switcher-indicator')).toBe(model.badgeLabel);
                    expect(toggle.getAttribute('aria-description')).toBe(model.description || null);
                });

                // Every panel still exists — only the toggles are compacted.
                expect(buttonsOf(element, '.adw-inline-view-switcher-page')).toHaveLength(vector.pages.length);
                host.remove();
            });
        }

        for (const vector of INLINE_TOOLTIP_VECTORS) {
            // A NULL title has no attribute spelling that differs from an absent
            // one, and both are covered by the toggle vectors above.
            if (vector.title === null) continue;
            await it(`tooltip in ${vector.displayMode} — ${vector.rule}`, () => {
                const { element, host } = mountInline(
                    [{ name: 'a', title: vector.title, useUnderline: vector.useUnderline }],
                    vector.displayMode,
                );
                const toggle = buttonsOf(element, '.adw-inline-view-switcher-toggle')[0]!;
                expect(toggle.getAttribute('title')).toBe(vector.tooltip || null);
                host.remove();
            });
        }

        await it("defaults to 'labels' and REFUSES an unknown display mode", () => {
            // The old element defaulted to 'both' and replaced the current mode
            // with 'both' for any unrecognised value.
            const { element, host } = mountInline([
                { name: 'a', title: 'A', iconName: 'go-home-symbolic' },
                { name: 'b', title: 'B' },
            ]);
            expect(element.displayMode).toBe('labels');
            expect(element.querySelector('.adw-inline-view-switcher-toggle .adw-icon')).toBe(null);

            const modes: string[] = [];
            element.addEventListener('notify::display-mode', (event) => {
                modes.push((event as CustomEvent<{ displayMode: string }>).detail.displayMode);
            });

            element.setAttribute('display-mode', 'icons');
            expect(element.displayMode).toBe('icons');
            element.setAttribute('display-mode', 'bogus');
            expect(element.displayMode).toBe('icons');
            expect(modes).toStrictEqual(['icons']);
            host.remove();
        });

        await it('maps a toggle back to its PAGE when hidden pages shift the indices', () => {
            const { element, host, changes } = mountInline([
                { name: 'a', title: 'A' },
                { name: 'b', title: 'B', visible: false },
                { name: 'c', title: 'C' },
            ]);
            changes.length = 0;

            const toggles = buttonsOf(element, '.adw-inline-view-switcher-toggle');
            // Toggle 1 is page 2 — clicking it must select the PAGE, not the
            // toggle index, which is what the missing child-index mapping did.
            toggles[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(element.active).toBe(2);
            expect(element.activeToggle).toBe(1);
            expect(changes).toStrictEqual([{ selected: 2, name: 'c', title: '', interactive: true }]);
            host.remove();
        });

        await it('reports -1 when the visible page has no toggle', () => {
            const { element, host } = mountInline([
                { name: 'a', title: 'A' },
                { name: 'b', title: 'B' },
            ]);
            // Hiding the page a switcher is showing normally moves the selection;
            // force the "selected page is hidden" state the C sentinel exists for
            // by hiding every OTHER page first.
            element.setPageVisible('a', false);
            expect(element.active).toBe(1);
            element.setPageVisible('b', false);
            expect(element.active).toBe(-1);
            expect(element.activeToggle).toBe(-1);
            expect(buttonsOf(element, '.adw-inline-view-switcher-toggle')).toHaveLength(0);
            host.remove();
        });
    });

    await describe('adw-view-switcher-bar reveal (libadwaita conformance vectors)', async () => {
        for (const vector of VIEW_SWITCHER_BAR_REVEAL_VECTORS) {
            await it(vector.rule, () => {
                const host = document.createElement('div');
                document.body.appendChild(host);

                const stack = document.createElement('adw-view-stack') as AdwViewStack;
                stack.id = `bar-stack-${Math.random().toString(36).slice(2)}`;
                vector.pages.forEach((page, index) => {
                    const pageEl = document.createElement('adw-view-stack-page');
                    pageEl.setAttribute('name', `p${index}`);
                    pageEl.setAttribute('title', `P${index}`);
                    if (!page.visible) pageEl.setAttribute('hidden', '');
                    stack.appendChild(pageEl);
                });
                host.appendChild(stack);

                const bar = document.createElement('adw-view-switcher-bar') as AdwViewSwitcherBar;
                bar.setAttribute('stack', stack.id);
                host.appendChild(bar);

                bar.reveal = vector.reveal;
                expect(bar.reveal).toBe(vector.reveal);
                // The derivation both ports skipped: a one-page stack keeps the
                // bar collapsed however loudly the layout asks.
                expect(bar.revealed).toBe(vector.revealed);
                expect(bar.hidden).toBe(!vector.revealed);
                expect(getComputedStyle(bar).display).toBe(vector.revealed ? 'block' : 'none');
                host.remove();
            });
        }

        await it('keeps tracking its stack after being detached and re-inserted', () => {
            // `disconnectedCallback` dropped the listener and `connectedCallback`
            // only re-added it when `ref && !this._stack` — which is never true
            // on a re-attach, so the bar stopped tracking for good.
            const host = document.createElement('div');
            document.body.appendChild(host);

            const stack = document.createElement('adw-view-stack') as AdwViewStack;
            for (const name of ['a', 'b']) {
                const pageEl = document.createElement('adw-view-stack-page');
                pageEl.setAttribute('name', name);
                pageEl.setAttribute('title', name.toUpperCase());
                stack.appendChild(pageEl);
            }
            host.appendChild(stack);

            const bar = document.createElement('adw-view-switcher-bar') as AdwViewSwitcherBar;
            host.appendChild(bar);
            bar.setStack(stack);
            bar.reveal = true;

            bar.remove();
            host.appendChild(bar);

            stack.visibleChildName = 'b';
            const buttons = buttonsOf(bar, '.adw-view-switcher-bar-button');
            expect(buttons[1]!.getAttribute('aria-selected')).toBe('true');
            expect(buttons[0]!.getAttribute('aria-selected')).toBe('false');
            host.remove();
        });
    });
};
