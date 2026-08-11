// DOM-level conformance tests for <adw-navigation-view>, driven by the SAME
// vectors the NativeScript renderer and the headless core assert against
// (`@gjsify/adwaita-core/conformance`).
//
// Four rows of the shared table are the ones independent copies of the stack machine got
// wrong: a programmatic `pop()` IGNORES `can-pop` (which gates only the back button and
// the shortcut pops), `replace(['some-tag'])` resolves a tag belonging to a
// dynamically-pushed page, `popToTag()` pops in ONE atomic splice emitting one
// transition rather than N, and a duplicate `tag` is refused, not silently accepted.
import { describe, expect, it } from '@gjsify/unit';

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
import type { AdwNavigationPageProps } from '@gjsify/adwaita-core';

import type { AdwNavigationPage, AdwNavigationView } from './elements/adw-navigation-view.js';

/** Write vector props onto the element — the attributes ARE the authoring surface. */
function applyProps(page: AdwNavigationPage, props?: AdwNavigationPageProps): void {
    if (props === undefined) return;
    if ('tag' in props) page.tag = props.tag ?? null;
    if (props.title !== undefined) page.title = props.title;
    if (props.canPop !== undefined) page.canPop = props.canPop;
}

/** Mount an empty view and adapt it to the vector driver. */
function mountView() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = document.createElement('adw-navigation-view') as AdwNavigationView;
    host.appendChild(view);

    const handles = new Map<NavigationPageId, AdwNavigationPage>();
    const ids = new Map<AdwNavigationPage, NavigationPageId>();
    const page = (id: NavigationPageId): AdwNavigationPage => {
        let element = handles.get(id);
        if (element === undefined) {
            element = document.createElement('adw-navigation-page') as AdwNavigationPage;
            handles.set(id, element);
            ids.set(element, id);
        }
        return element;
    };
    const idOf = (element: AdwNavigationPage | null | undefined): NavigationPageId | null =>
        element === null || element === undefined ? null : (ids.get(element) ?? null);

    const events: NavigationEventRecord[] = [];
    for (const type of ['pushed', 'popped', 'replaced', 'notify::visible-page'] as const) {
        view.addEventListener(type, (event) => {
            const detail = (event as CustomEvent<{ page: AdwNavigationPage | null }>).detail;
            events.push({ type, page: idOf(detail?.page ?? null) });
        });
    }

    const adapter: NavigationVectorAdapter<AdwNavigationPage> = {
        page,
        idOf,
        // The slide is a CSS animation on the incoming page, so the element settles
        // the deferred destroy inside its own change handler.
        defersTransition: false,
        add: (p, props) => {
            applyProps(p, props);
            return view.addPage(p);
        },
        remove: (p) => view.removePage(p),
        push: (p, props) => {
            applyProps(p, props);
            return view.push(p);
        },
        pushByTag: (tag) => view.pushByTag(tag),
        pop: () => view.pop(),
        popToPage: (p) => view.popToPage(p),
        popToTag: (tag) => view.popToTag(tag),
        replace: (pages, props) => {
            if (props !== undefined) {
                for (const p of pages) {
                    if (p !== null) applyProps(p, props(p));
                }
            }
            view.replace([...pages]);
        },
        replaceWithTags: (tags) => view.replaceWithTags(tags),
        // The property setters go through `setAttribute`, so these rows also
        // exercise the attribute → core sync that keeps the back button live.
        // A rejected rename is rolled back, which is what makes the boolean right.
        setTag: (p, tag) => {
            const before = p.tag;
            p.tag = tag;
            return p.tag !== before;
        },
        setTitle: (p, title) => {
            const before = p.title;
            p.title = title;
            return p.title !== before;
        },
        setCanPop: (p, canPop) => {
            const before = p.canPop;
            p.canPop = canPop;
            return p.canPop !== before;
        },
        setAnimateTransitions: (value) => {
            view.animateTransitions = value;
        },
        setPopOnEscape: (value) => {
            view.popOnEscape = value;
        },
        popFromShortcut: () => (dispatchKey(view, 'ArrowLeft', true) ? 'stop' : 'propagate'),
        popFromEscape: () => (dispatchKey(view, 'Escape', false) ? 'stop' : 'propagate'),
        finishTransition: () => [],
        stack: () => view.navigationStack,
        pages: () => view.pages,
        visiblePage: () => view.visiblePage,
        visiblePageTag: () => view.visiblePageTag,
        depth: () => view.depth,
        animateTransitions: () => view.animateTransitions,
        popOnEscape: () => view.popOnEscape,
        canGoBack: () => view.canGoBack,
        backButtonTooltip: () => view.backButtonTooltip,
        findPage: (tag) => view.findPage(tag),
        getPreviousPage: (p) => view.getPreviousPage(p),
        // `removeOnPop` is core-only; its DOM-visible consequence is the page
        // leaving `pages` (and the document), which every row still asserts.
        pageState: (p) => ({
            registered: view.pages.includes(p),
            tag: p.tag,
            title: p.title,
            canPop: p.canPop,
        }),
    };

    return { adapter, view, host, events, page, idOf };
}

/**
 * Send a real key event and report whether the view consumed it. The keyboard is
 * how `pop_shortcut_cb` / `escape_shortcut_cb` are reachable from the DOM, so the
 * shortcut vectors drive the actual listener rather than a method behind it.
 */
function dispatchKey(view: AdwNavigationView, key: string, altKey: boolean): boolean {
    const event = new KeyboardEvent('keydown', { key, altKey, bubbles: true, cancelable: true });
    view.dispatchEvent(event);
    return event.defaultPrevented;
}

/** Which page element is currently shown. */
function renderedPage(view: AdwNavigationView): AdwNavigationPage | null {
    const shown = Array.from(view.querySelectorAll('adw-navigation-page')).filter(
        (page) => !(page as HTMLElement).hidden,
    );
    expect(shown.length <= 1).toBe(true);
    return (shown[0] as AdwNavigationPage | undefined) ?? null;
}

/** Build a page carrying a header bar, so the automatic back button has somewhere to go. */
function pageWithHeaderBar(title: string, tag?: string): AdwNavigationPage {
    const page = document.createElement('adw-navigation-page') as AdwNavigationPage;
    page.setAttribute('title', title);
    if (tag !== undefined) page.setAttribute('tag', tag);
    page.appendChild(document.createElement('adw-header-bar'));
    return page;
}

/** The injected back button on the visible page, if any. */
function backButton(view: AdwNavigationView): HTMLElement | null {
    return view.querySelector('.adw-navigation-back-button') as HTMLElement | null;
}

export const AdwNavigationViewTest = async () => {
    await describe('adw-navigation-view stack (libadwaita conformance vectors)', async () => {
        for (const vector of NAVIGATION_VIEW_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { adapter, host, events } = mountView();

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
                    expect(events).toStrictEqual(navigationEventLog(vector.expect.changes));
                }

                host.remove();
            });
        }
    });

    await describe('adw-navigation-view declared markup', async () => {
        await it('auto-pushes the first declared page and announces it', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            view.append(pageWithHeaderBar('Home', 'root'), pageWithHeaderBar('Detail', 'detail'));

            // Subscribe BEFORE connecting: the auto-push happens at connect time and
            // used to emit nothing at all, so a listener never saw the view fill.
            const seen: string[] = [];
            view.addEventListener('pushed', () => seen.push('pushed'));
            view.addEventListener('notify::visible-page', (event) => {
                seen.push(`visible:${(event as CustomEvent<{ tag: string | null }>).detail.tag}`);
            });

            host.appendChild(view);
            document.body.appendChild(host);

            expect(seen).toStrictEqual(['pushed', 'visible:root']);
            expect(view.visiblePageTag).toBe('root');
            expect(view.depth).toBe(1);
            expect(view.pages).toHaveLength(2);
            expect(renderedPage(view)).toBe(view.findPage('root'));
            host.remove();
        });

        await it('shows only the top of the stack', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            view.append(pageWithHeaderBar('Home', 'root'), pageWithHeaderBar('Detail', 'detail'));
            host.appendChild(view);
            document.body.appendChild(host);

            view.pushByTag('detail');
            expect(renderedPage(view)).toBe(view.findPage('detail'));
            view.pop();
            expect(renderedPage(view)).toBe(view.findPage('root'));
            host.remove();
        });

        await it('drops a declared page whose tag collides', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            const duplicate = pageWithHeaderBar('Other', 'root');
            view.append(pageWithHeaderBar('Home', 'root'), duplicate);
            host.appendChild(view);
            document.body.appendChild(host);

            expect(view.pages).toHaveLength(1);
            expect(duplicate.isConnected).toBe(false);
            expect(renderedPage(view)).toBe(view.findPage('root'));
            host.remove();
        });
    });

    await describe('adw-navigation-view back button', async () => {
        await it('appears above the root and carries the PREVIOUS page title', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            view.append(pageWithHeaderBar('Home', 'root'), pageWithHeaderBar('Detail', 'detail'));
            host.appendChild(view);
            document.body.appendChild(host);

            expect(backButton(view)).toBe(null);
            view.pushByTag('detail');
            // The old element hardcoded "Back" here, where the C uses the title of
            // the page the button reveals (adw-back-button.c query_tooltip).
            expect(backButton(view)?.getAttribute('tooltip')).toBe('Home');

            view.pop();
            expect(backButton(view)).toBe(null);
            host.remove();
        });

        await it('falls back to "Back" when the previous page has no title', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            const root = pageWithHeaderBar('', 'root');
            view.append(root, pageWithHeaderBar('Detail', 'detail'));
            host.appendChild(view);
            document.body.appendChild(host);

            view.pushByTag('detail');
            expect(backButton(view)?.getAttribute('tooltip')).toBe('Back');
            host.remove();
        });

        await it('re-syncs when can-pop changes at runtime', () => {
            // The regression: `can-pop` was in observedAttributes but nothing acted
            // on it, so the button only reflected the last stack mutation's value.
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            const detail = pageWithHeaderBar('Detail', 'detail');
            view.append(pageWithHeaderBar('Home', 'root'), detail);
            host.appendChild(view);
            document.body.appendChild(host);

            view.pushByTag('detail');
            expect(backButton(view)).not.toBe(null);

            detail.canPop = false;
            expect(backButton(view)).toBe(null);
            expect(view.canGoBack).toBe(false);

            detail.canPop = true;
            expect(backButton(view)).not.toBe(null);
            host.remove();
        });

        await it('follows a runtime title change on the previous page', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            const root = pageWithHeaderBar('Home', 'root');
            view.append(root, pageWithHeaderBar('Detail', 'detail'));
            host.appendChild(view);
            document.body.appendChild(host);

            view.pushByTag('detail');
            root.title = 'Start';
            expect(backButton(view)?.getAttribute('tooltip')).toBe('Start');
            host.remove();
        });

        await it('is suppressed by no-back-button without disabling the pop', () => {
            const host = document.createElement('div');
            const view = document.createElement('adw-navigation-view') as AdwNavigationView;
            const detail = pageWithHeaderBar('Detail', 'detail');
            detail.setAttribute('no-back-button', '');
            view.append(pageWithHeaderBar('Home', 'root'), detail);
            host.appendChild(view);
            document.body.appendChild(host);

            view.pushByTag('detail');
            expect(backButton(view)).toBe(null);
            // AdwHeaderBar:show-back-button removes the BUTTON, not the shortcut.
            expect(view.canGoBack).toBe(true);
            expect(view.pop()).toBe(true);
            host.remove();
        });
    });

    await describe('adw-navigation-view DOM lifecycle', async () => {
        await it('takes a dynamically-pushed page out of the document when it is popped', () => {
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            adapter.push(page('sheet'));
            expect(page('sheet').isConnected).toBe(true);

            expect(view.pop()).toBe(true);
            expect(page('sheet').isConnected).toBe(false);
            expect(view.pages).toHaveLength(1);
            host.remove();
        });

        await it('keeps a statically-added page in the document across push and pop', () => {
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));
            expect(view.pop()).toBe(true);
            expect(page('detail').isConnected).toBe(true);
            expect((page('detail') as HTMLElement).hidden).toBe(true);
            host.remove();
        });

        await it('mirrors animate-transitions onto the animated class and the core', () => {
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            expect(view.classList.contains('animated')).toBe(true);

            view.animateTransitions = false;
            expect(view.classList.contains('animated')).toBe(false);
            expect(view.animateTransitions).toBe(false);
            host.remove();
        });
    });

    await describe('adw-navigation-view keyboard shortcuts', async () => {
        await it('pops on Escape and stops the event', () => {
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));

            expect(dispatchKey(view, 'Escape', false)).toBe(true);
            expect(view.depth).toBe(1);
            host.remove();
        });

        await it('leaves Escape alone when pop-on-escape is off', () => {
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));
            view.popOnEscape = false;

            expect(dispatchKey(view, 'Escape', false)).toBe(false);
            expect(view.depth).toBe(2);
            host.remove();
        });

        await it('stops Alt+Left WITHOUT popping a can-pop="false" page', () => {
            // GDK_EVENT_STOP so the key never reaches an enclosing navigation view
            // (pop_shortcut_cb).
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));
            page('detail').canPop = false;

            expect(dispatchKey(view, 'ArrowLeft', true)).toBe(true);
            expect(view.depth).toBe(2);
            // …while a manual pop() still works, which is the whole point of can-pop.
            expect(view.pop()).toBe(true);
            expect(view.depth).toBe(1);
            host.remove();
        });

        await it('ignores an unrelated key', () => {
            const { adapter, view, host, page } = mountView();
            adapter.add(page('root'));
            adapter.add(page('detail'));
            adapter.push(page('detail'));

            expect(dispatchKey(view, 'ArrowLeft', false)).toBe(false);
            expect(view.depth).toBe(2);
            host.remove();
        });
    });
};
