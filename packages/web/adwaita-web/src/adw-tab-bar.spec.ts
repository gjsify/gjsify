// DOM-level tests for <adw-tab-bar>: the strip libadwaita binds to a view through
// `Adw.TabBar:view`. Everything under test is derived from a live view, so each case
// drives the view and reads the bar — the same arrangement `adw-tab-button.spec.ts` uses
// for the one widget that is also a view's companion.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwTabBar } from './elements/adw-tab-bar.js';
import type { AdwTabView } from './elements/adw-tab-view.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let serial = 0;

/** A view with `titles`, a bar bound to it BY ID, and the action widgets' slots empty. */
function mount(titles: readonly string[]): { bar: AdwTabBar; view: AdwTabView; host: HTMLElement } {
    const id = `bar-view-${(serial += 1)}`;
    const host = document.createElement('div');
    const pages = titles.map((title) => `<adw-tab-page title="${title}"></adw-tab-page>`).join('');
    host.innerHTML = `<adw-tab-view id="${id}">${pages}</adw-tab-view><adw-tab-bar view="${id}"></adw-tab-bar>`;
    document.body.appendChild(host);
    return {
        bar: host.querySelector('adw-tab-bar') as AdwTabBar,
        view: host.querySelector('adw-tab-view') as AdwTabView,
        host,
    };
}

const chips = (bar: AdwTabBar) => [...bar.querySelectorAll('.adw-tab')] as HTMLElement[];
const chipTitles = (bar: AdwTabBar) => chips(bar).map((chip) => chip.querySelector('.adw-tab-title')?.textContent);

export const AdwTabBarTest = async () => {
    await describe('<adw-tab-bar> binds to a view', async () => {
        await it('resolves `view` by element id and draws one chip per page', async () => {
            const { bar, view, host } = mount(['One', 'Two', 'Three']);
            expect(bar.view).toBe(view);
            expect(chipTitles(bar)).toStrictEqual(['One', 'Two', 'Three']);
            host.remove();
        });

        await it('takes the view directly through the property', async () => {
            const view = document.createElement('adw-tab-view') as AdwTabView;
            document.body.appendChild(view);
            view.appendPage({ id: 'a', title: 'A' });
            const bar = document.createElement('adw-tab-bar') as AdwTabBar;
            document.body.appendChild(bar);
            bar.view = view;
            expect(bar.view).toBe(view);
            expect(chipTitles(bar)).toStrictEqual(['A']);
            bar.remove();
            view.remove();
        });

        await it('follows pages added, removed and reordered after connect', async () => {
            const { bar, view, host } = mount(['One', 'Two']);
            const first = view.pages[0].id;
            view.appendPage({ id: 'three', title: 'Three' });
            expect(chipTitles(bar)).toStrictEqual(['One', 'Two', 'Three']);
            view.reorderPage('three', 0);
            expect(chipTitles(bar)).toStrictEqual(['Three', 'One', 'Two']);
            view.closePage(first);
            expect(chipTitles(bar)).toStrictEqual(['Three', 'Two']);
            host.remove();
        });

        await it('reflects a title change without rebuilding the chip', async () => {
            const { bar, view, host } = mount(['One']);
            const chip = chips(bar)[0];
            view.setPageTitle(view.pages[0].id, 'Renamed');
            expect(chips(bar)[0]).toBe(chip);
            expect(chip.querySelector('.adw-tab-title')?.textContent).toBe('Renamed');
            host.remove();
        });
    });

    await describe('<adw-tab-bar> selection', async () => {
        await it('marks the selected chip and moves the roving tabindex with it', async () => {
            const { bar, view, host } = mount(['One', 'Two']);
            expect(chips(bar).map((chip) => chip.classList.contains('active'))).toStrictEqual([true, false]);
            expect(chips(bar).map((chip) => chip.tabIndex)).toStrictEqual([0, -1]);

            view.selectNthPage(1);
            expect(chips(bar).map((chip) => chip.classList.contains('active'))).toStrictEqual([false, true]);
            expect(chips(bar).map((chip) => chip.tabIndex)).toStrictEqual([-1, 0]);
            expect(chips(bar).map((chip) => chip.getAttribute('aria-selected'))).toStrictEqual(['false', 'true']);
            host.remove();
        });

        await it('selects on a chip press and closes on the close affordance', async () => {
            const { bar, view, host } = mount(['One', 'Two']);
            const second = view.pages[1].id;
            chips(bar)[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(view.selectedId).toBe(second);

            const close = chips(bar)[1].querySelector('.adw-tab-close') as HTMLElement;
            // The close affordance is hidden until the tab is hovered or selected, and this
            // one is the selected tab, so `tabCloseVisible` shows it on its own.
            expect(close.hidden).toBe(false);
            close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(chipTitles(bar)).toStrictEqual(['One']);
            host.remove();
        });

        await it('ArrowRight and End move the selection from the keyboard', async () => {
            const { bar, view, host } = mount(['One', 'Two', 'Three']);
            const ids = view.pages.map((page) => page.id);
            chips(bar)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            expect(view.selectedId).toBe(ids[1]);
            chips(bar)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
            expect(view.selectedId).toBe(ids[2]);
            host.remove();
        });
    });

    await describe('<adw-tab-bar> tabs-revealed', async () => {
        await it('is up without `autohide`, whatever the page count', async () => {
            const { bar, host } = mount(['One']);
            expect(bar.tabsRevealed).toBe(true);
            expect(bar.hidden).toBe(false);
            host.remove();
        });

        await it('hides with `autohide` on a single page and comes back for two', async () => {
            const { bar, view, host } = mount(['One']);
            bar.autohide = true;
            // `tabsRevealed` reads the LIVE attribute, so the write is the whole input.
            expect(bar.tabsRevealed).toBe(false);
            expect(bar.hidden).toBe(true);

            view.appendPage({ id: 'two', title: 'Two' });
            expect(bar.tabsRevealed).toBe(true);
            expect(bar.hidden).toBe(false);
            host.remove();
        });

        await it('stays up with `autohide` on a single PINNED page', async () => {
            const { bar, host } = mount(['Pinned']);
            bar.autohide = true;
            const page = bar.view?.pages[0];
            expect(page?.pinned).toBe(false);
            // A declared `<adw-tab-page>` with no `page-id` gets a generated one, which an
            // author cannot predict — so the pin goes in through the page's own id.
            bar.view?.setPagePinned(page?.id ?? '', true);
            expect(bar.tabsRevealed).toBe(true);
            expect(bar.hidden).toBe(false);
            host.remove();
        });
    });

    await describe('<adw-tab-bar> properties', async () => {
        await it('carries expand-tabs and inverted as attributes, and says so', async () => {
            const { bar, host } = mount(['One', 'Two']);
            expect(bar.expandTabs).toBe(false);
            expect(bar.inverted).toBe(false);
            bar.expandTabs = true;
            bar.inverted = true;
            expect(bar.hasAttribute('expand-tabs')).toBe(true);
            expect(bar.hasAttribute('inverted')).toBe(true);
            host.remove();
        });

        await it('notifies each property on a real change', async () => {
            const { bar, host } = mount(['One']);
            const seen: string[] = [];
            for (const name of ['autohide', 'expand-tabs', 'inverted', 'extra-drag-preload']) {
                bar.addEventListener(`notify::${name}`, () => seen.push(name));
            }
            bar.autohide = true;
            bar.inverted = true;
            expect(seen).toStrictEqual(['autohide', 'inverted']);
            host.remove();
        });

        await it('notifies `view` when it is rebound', async () => {
            const { bar, view, host } = mount(['One']);
            let notified = false;
            bar.addEventListener('notify::view', () => (notified = true));
            const other = document.createElement('adw-tab-view') as AdwTabView;
            document.body.appendChild(other);
            other.appendPage({ id: 'z', title: 'Z' });
            bar.setView(other);
            expect(notified).toBe(true);
            expect(chipTitles(bar)).toStrictEqual(['Z']);
            bar.setView(view);
            expect(chipTitles(bar)).toStrictEqual(['One']);
            other.remove();
            host.remove();
        });
    });

    await describe('<adw-tab-bar> action widgets', async () => {
        await it('routes a `slot="start-action-widget"` child into the leading bin', async () => {
            const { bar, host } = mount(['One']);
            const button = document.createElement('button');
            button.slot = 'start-action-widget';
            // Appended AFTER connect on purpose: `bindSlottedChildren` observes the host, so
            // a late child lands where a parse-time one would — on the observer's microtask,
            // which is why the read below waits for one.
            bar.appendChild(button);
            await settle();
            expect(bar.startActionWidget).toBe(button);
            expect(bar.querySelector('.adw-tab-bar-start-action button')).toBe(button);
            // The bin leads the box, which is the order `AdwTabBar`'s template puts the two
            // action bins in (adw-tab-bar.ui).
            expect(bar.querySelector('.adw-tab-box')?.previousElementSibling).toBe(
                bar.querySelector('.adw-tab-bar-start-action'),
            );
            host.remove();
        });

        await it('routes a `slot="end-action-widget"` child into the trailing bin', async () => {
            const { bar, host } = mount(['One']);
            const button = document.createElement('button');
            button.slot = 'end-action-widget';
            bar.appendChild(button);
            await settle();
            expect(bar.endActionWidget).toBe(button);
            expect(bar.querySelector('.adw-tab-bar-end-action button')).toBe(button);
            host.remove();
        });

        await it('takes an action widget through the property too', async () => {
            const { bar, host } = mount(['One']);
            const button = document.createElement('button');
            bar.endActionWidget = button;
            expect(bar.querySelector('.adw-tab-bar-end-action')?.lastElementChild).toBe(button);
            bar.endActionWidget = null;
            expect(bar.endActionWidget).toBe(null);
            host.remove();
        });
    });

    await describe('<adw-tab-bar> overflow and the extra drop target', async () => {
        await it('reports `is-overflowing` off the strip, not off the chip count', async () => {
            const { bar, host } = mount(['One', 'Two']);
            // Nothing is scrolled yet, so the strip fits its chips and does NOT overflow:
            // the indicator is the adjustment's answer, not a threshold on `nPages`.
            expect(bar.isOverflowing).toBe(false);
            expect((bar.querySelector('.adw-tab-box-overflow') as HTMLElement).hidden).toBe(true);
            host.remove();
        });

        await it('dispatches `extra-drag-value` on hover-start and carries the action back', async () => {
            const { bar, host } = mount(['One']);
            bar.setupExtraDropTarget(['text/plain']);
            let seen: unknown = 'unset';
            bar.addEventListener('extra-drag-value', (event) => {
                seen = (event as CustomEvent).detail.action;
                (event as CustomEvent).detail.action = 'move';
            });
            const transfer = new DataTransfer();
            transfer.setData('text/plain', 'payload');
            bar.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
            // Hover-start emits a NULL action, and `extra-drag-preferred-action` is whatever
            // the handler answered with.
            expect(seen).toBe(null);
            expect(bar.extraDragPreferredAction).toBe('move');
            host.remove();
        });

        await it('dispatches a cancelable `extra-drag-drop` carrying the dropped data', async () => {
            const { bar, host } = mount(['One']);
            bar.setupExtraDropTarget(['text/plain'], ['copy']);
            let detail: { action: unknown; data: unknown } | null = null;
            bar.addEventListener('extra-drag-drop', (event) => {
                detail = (event as CustomEvent).detail;
            });
            const transfer = new DataTransfer();
            transfer.setData('text/plain', 'payload');
            bar.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
            expect(detail?.data).toBe('payload');
            expect(detail?.action).toBe('copy');
            host.remove();
        });

        await it('leaves a drop of an unlisted type to the page', async () => {
            const { bar, host } = mount(['One']);
            bar.setupExtraDropTarget(['text/plain']);
            let dropped = false;
            bar.addEventListener('extra-drag-drop', () => (dropped = true));
            const transfer = new DataTransfer();
            transfer.setData('application/x-elsewhere', 'payload');
            bar.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
            expect(dropped).toBe(false);
            host.remove();
        });
    });
};
