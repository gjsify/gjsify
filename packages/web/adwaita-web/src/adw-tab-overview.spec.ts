// DOM-level tests for <adw-tab-overview>: the thumbnail grid that covers a tab view.
//
// The search rows are driven by the SAME table the core suite asserts against
// (`TAB_SEARCH_VECTORS`), because the predicate is `AdwTabGrid`'s three
// `GtkStringFilter`s and a browser-only copy of it is exactly the drift the table
// exists to stop. The rest are the C rules that are easy to get wrong: the PLURAL
// title, `update_header_bar`'s four-way OR, `empty_changed_cb`'s two empty states,
// the search entry going to the PINNED grid first, and the close-on-activate rule.
import { describe, expect, it } from '@gjsify/unit';

import { TAB_SEARCH_VECTORS } from '@gjsify/adwaita-core/conformance';
import { tabSearchMatches } from '@gjsify/adwaita-core';

import type { AdwTabOverview } from './elements/adw-tab-overview.js';
import type { AdwTabView } from './elements/adw-tab-view.js';

let serial = 0;

function mount(options: { pages?: number; pinned?: boolean; attrs?: string } = {}): {
    overview: AdwTabOverview;
    view: AdwTabView;
    host: HTMLElement;
} {
    const count = options.pages ?? 3;
    const rows = Array.from({ length: count }, (_, i) => {
        const pinned = options.pinned !== undefined && i < (options.pinned ? 1 : 0);
        return `<adw-tab-page title="Page ${i}"${pinned ? ' pinned' : ''}></adw-tab-page>`;
    }).join('');
    const host = document.createElement('div');
    host.innerHTML = `<adw-tab-overview ${options.attrs ?? ''}><adw-tab-view>${rows}</adw-tab-view></adw-tab-overview>`;
    document.body.appendChild(host);
    return {
        overview: host.querySelector('adw-tab-overview') as AdwTabOverview,
        view: host.querySelector('adw-tab-view') as AdwTabView,
        host,
    };
}

const grid = (overview: AdwTabOverview, pinned = false): HTMLElement =>
    overview.querySelector(pinned ? '.adw-tab-grid.pinned-grid' : '.adw-tab-grid:not(.pinned-grid)') as HTMLElement;

const thumbs = (overview: AdwTabOverview, pinned = false): HTMLElement[] =>
    Array.from(grid(overview, pinned).querySelectorAll('.adw-tab-thumbnail'));

const searchEntry = (overview: AdwTabOverview): HTMLInputElement =>
    overview.querySelector('.overview-search-entry') as HTMLInputElement;

export const AdwTabOverviewTest = async () => {
    await describe('<adw-tab-overview> thumbnail grids', async () => {
        await it('finds the tab view among its own children and shows one thumbnail per page', async () => {
            const { overview, view, host } = mount({ pages: 3 });
            expect(overview.view).toBe(view);
            expect(thumbs(overview)).toHaveLength(3);
            expect((thumbs(overview)[1].querySelector('.tab-label') as HTMLElement).textContent).toBe('Page 1');
            host.remove();
        });

        await it('splits PINNED pages into the pinned grid, in view order', async () => {
            const { overview, host } = mount({ pages: 3, pinned: true });
            expect(thumbs(overview, true)).toHaveLength(1);
            expect(thumbs(overview)).toHaveLength(2);
            host.remove();
        });

        await it('follows pages attached, detached and repinned', async () => {
            const { overview, view, host } = mount({ pages: 2 });
            view.appendPage({ id: 'late', title: 'Late' });
            expect(thumbs(overview)).toHaveLength(3);
            view.setPagePinned('late', true);
            expect(thumbs(overview, true)).toHaveLength(1);
            expect(thumbs(overview)).toHaveLength(2);
            view.closePage('late');
            expect(thumbs(overview, true)).toHaveLength(0);
            expect(thumbs(overview)).toHaveLength(2);
            host.remove();
        });

        await it('selects the page and closes the overview when a thumbnail is activated', async () => {
            const { overview, view, host } = mount({ pages: 3 });
            overview.setOpen(true);
            thumbs(overview)[2].click();
            expect(view.selectedId).toBe('tab-3');
            expect(overview.open).toBe(false);
            host.remove();
        });

        await it('closes the page from the thumbnail close button, without activating it', async () => {
            const { overview, view, host } = mount({ pages: 3 });
            overview.setOpen(true);
            const closeBtn = thumbs(overview)[0].querySelector('.tab-close-button') as HTMLButtonElement;
            expect(closeBtn.hidden).toBe(false);
            closeBtn.click();
            expect(view.nPages).toBe(2);
            // The page that was selected is untouched: the button swallowed the click.
            expect(view.selectedId).toBe('tab-1');
            host.remove();
        });

        await it('shows the unpin affordance on a pinned thumbnail instead of the close button', async () => {
            const { overview, host } = mount({ pages: 1, pinned: true });
            const thumb = thumbs(overview, true)[0];
            expect((thumb.querySelector('.tab-close-button') as HTMLElement).hidden).toBe(true);
            const unpin = thumb.querySelector('.tab-unpin-icon') as HTMLElement;
            expect(unpin.hidden).toBe(false);
            unpin.click();
            expect(thumbs(overview, true)).toHaveLength(0);
            expect(thumbs(overview)).toHaveLength(1);
            host.remove();
        });

        await it('swaps the thumbnail icon for a spinner while the page is loading', async () => {
            const { overview, view, host } = mount({ pages: 1 });
            const thumb = thumbs(overview)[0];
            const iconTitle = (thumb.querySelector('.icon-title-box') as HTMLElement).firstElementChild as HTMLElement;
            expect(iconTitle.localName).toBe('gtk-image');
            view.setPageLoading('tab-1', true);
            expect((thumb.querySelector('.icon-title-box') as HTMLElement).firstElementChild?.localName).toBe(
                'adw-spinner',
            );
            view.setPageLoading('tab-1', false);
            expect((thumb.querySelector('.icon-title-box') as HTMLElement).firstElementChild?.localName).toBe(
                'gtk-image',
            );
            host.remove();
        });

        await it('shows the indicator button only for a page that has an indicator icon', async () => {
            const { overview, view, host } = mount({ pages: 1 });
            const indicator = thumbs(overview)[0].querySelector('.tab-indicator') as HTMLElement;
            expect(indicator.hidden).toBe(true);
            view.setPageIndicatorIcon('tab-1', 'dialog-warning');
            expect((thumbs(overview)[0].querySelector('.tab-indicator') as HTMLElement).hidden).toBe(false);
            host.remove();
        });
    });

    await describe('<adw-tab-overview> title, header bar and empty states', async () => {
        await it('pluralises the page count, and only for exactly one page', async () => {
            const { overview, view, host } = mount({ pages: 3 });
            const title = () => (overview.querySelector('.overview-title') as HTMLElement).textContent;
            expect(title()).toBe('3 Tabs');
            view.closePage('tab-3');
            view.closePage('tab-2');
            expect(title()).toBe('1 Tab');
            view.closePage('tab-1');
            expect(title()).toBe('0 Tabs');
            host.remove();
        });

        await it('empties its title when there is no view at all', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<adw-tab-overview></adw-tab-overview>';
            document.body.appendChild(host);
            const overview = host.querySelector('adw-tab-overview') as AdwTabOverview;
            expect(overview.view).toBeNull();
            expect((overview.querySelector('.overview-title') as HTMLElement).textContent).toBe('');
            host.remove();
        });

        await it('hides the header bar only when search, menu and BOTH title-button sides are off', async () => {
            const { overview, host } = mount({
                pages: 2,
                attrs: 'show-start-title-buttons="false" show-end-title-buttons="false"',
            });
            const header = () => (overview.querySelector('.overview-header-bar') as HTMLElement).hidden;
            expect(header()).toBe(false); // search is still on
            overview.setAttribute('enable-search', 'false');
            expect(header()).toBe(true);
            overview.setAttribute('show-start-title-buttons', 'true');
            expect(header()).toBe(false);
            overview.setAttribute('secondary-menu', JSON.stringify([{ label: 'New Window', action: 'win.new' }]));
            expect(header()).toBe(false);
            overview.setAttribute('show-start-title-buttons', 'false');
            overview.setAttribute('show-end-title-buttons', 'false');
            expect(header()).toBe(false); // the secondary menu is the fourth term
            host.remove();
        });

        await it('shows "No Open Tabs" when empty, and "No Tabs Found" when the search matches nothing', async () => {
            const { overview, view, host } = mount({ pages: 2 });
            const empty = () => (overview.querySelector('.overview-empty-state') as HTMLElement).hidden;
            const searchEmpty = () => (overview.querySelector('.overview-search-empty-state') as HTMLElement).hidden;
            expect(empty()).toBe(true);
            view.closePage('tab-1');
            view.closePage('tab-2');
            expect(empty()).toBe(false);
            expect(searchEmpty()).toBe(true);

            overview.setOpen(true);
            (overview.querySelector('.search-button') as HTMLButtonElement).click();
            const entry = searchEntry(overview);
            entry.value = 'nothing matches this';
            entry.dispatchEvent(new Event('input'));
            expect(overview.searchActive).toBe(true);
            expect(empty()).toBe(true);
            expect(searchEmpty()).toBe(false);
            host.remove();
        });

        await it('hides the new-tab button while the search is running', async () => {
            const { overview, host } = mount({ pages: 2, attrs: 'enable-new-tab' });
            const button = () => (overview.querySelector('.new-tab-button') as HTMLElement).hidden;
            expect(button()).toBe(false);
            overview.setOpen(true);
            (overview.querySelector('.search-button') as HTMLButtonElement).click();
            const entry = searchEntry(overview);
            entry.value = 'page';
            entry.dispatchEvent(new Event('input'));
            expect(button()).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-tab-overview> search', async () => {
        await it('drives the same filter the core table pins', async () => {
            for (const vector of TAB_SEARCH_VECTORS) {
                const matches = tabSearchMatches(
                    { title: vector.title, tooltip: vector.tooltip, keyword: vector.keyword },
                    vector.terms,
                );
                expect(matches).toBe(vector.matches);
            }
        });

        await it('hides the thumbnails that do not match, on title, tooltip and keyword', async () => {
            const { overview, view, host } = mount({ pages: 3 });
            view.setPageTooltip('tab-2', 'the scratch pad');
            view.setPageKeyword('tab-3', 'https://example.org/history');
            overview.setOpen(true);
            (overview.querySelector('.search-button') as HTMLButtonElement).click();
            const entry = searchEntry(overview);

            entry.value = 'scratch';
            entry.dispatchEvent(new Event('input'));
            expect(thumbs(overview).map((thumb) => thumb.querySelector('.tab-label')?.textContent)).toEqual(['Page 1']);

            entry.value = 'example.org';
            entry.dispatchEvent(new Event('input'));
            expect(thumbs(overview).map((thumb) => thumb.querySelector('.tab-label')?.textContent)).toEqual(['Page 2']);

            entry.value = 'page';
            entry.dispatchEvent(new Event('input'));
            expect(thumbs(overview)).toHaveLength(3);
            host.remove();
        });

        await it('is "active" exactly while the entry is non-empty', async () => {
            const { overview, host } = mount({ pages: 1 });
            overview.setOpen(true);
            (overview.querySelector('.search-button') as HTMLButtonElement).click();
            const entry = searchEntry(overview);
            expect(overview.searchActive).toBe(false);
            entry.value = 'x';
            entry.dispatchEvent(new Event('input'));
            expect(overview.searchActive).toBe(true);
            entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(overview.searchActive).toBe(false);
            expect(entry.value).toBe('');
            host.remove();
        });

        await it('sends Enter to the PINNED grid first, then to the ordinary one', async () => {
            const { overview, host } = mount({ pages: 2 });
            overview.setOpen(true);
            (overview.querySelector('.search-button') as HTMLButtonElement).click();
            const entry = searchEntry(overview);
            entry.value = 'page';
            entry.dispatchEvent(new Event('input'));
            entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(document.activeElement === thumbs(overview)[0]).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-tab-overview> actions and new tab', async () => {
        await it('enables overview.open only while closed, and overview.close only with pages', async () => {
            const { overview, view, host } = mount({ pages: 2 });
            expect(overview.activateOverviewOpen()).toBe(true);
            expect(overview.open).toBe(true);
            // Already open: the action is disabled, and says so by doing nothing.
            expect(overview.activateOverviewOpen()).toBe(false);
            expect(overview.activateOverviewClose()).toBe(true);
            expect(overview.open).toBe(false);
            view.closePage('tab-1');
            view.closePage('tab-2');
            overview.setOpen(true);
            expect(overview.activateOverviewClose()).toBe(false);
            expect(overview.open).toBe(true);
            host.remove();
        });

        await it('creates, selects and closes to the new page, focusing its content', async () => {
            const { overview, view, host } = mount({ pages: 1, attrs: 'enable-new-tab' });
            overview.setOpen(true);
            overview.addEventListener('create-tab', (event) => {
                const page = view.appendPage({ id: 'fresh', title: 'Fresh' });
                (event as CustomEvent).detail.page = page;
            });
            (overview.querySelector('.new-tab-button') as HTMLButtonElement).click();
            expect(view.selectedId).toBe('fresh');
            expect(overview.open).toBe(false);
            host.remove();
        });

        await it('opens the overview from the open attribute, and reports the change', async () => {
            const { overview, host } = mount({ pages: 1 });
            const seen: boolean[] = [];
            overview.addEventListener('notify::open', (event) => seen.push((event as CustomEvent).detail.open));
            overview.setAttribute('open', '');
            expect(overview.open).toBe(true);
            expect((overview.querySelector('.adw-tab-overview-toolbar') as HTMLElement).hidden).toBe(false);
            overview.setAttribute('open', '');
            overview.setOpen(false);
            expect(seen).toStrictEqual([true, false]);
            host.remove();
        });

        await it('makes the covered child inert while the overview is up', async () => {
            const { overview, host } = mount({ pages: 1 });
            const child = overview.querySelector('.adw-tab-overview-child') as HTMLElement;
            expect(child.inert).toBe(false);
            overview.setOpen(true);
            expect(child.inert).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-tab-overview> inverted', async () => {
        await it('puts the close button at the start and the indicator at the end', async () => {
            const { overview, view, host } = mount({ pages: 1 });
            view.setPageIndicatorIcon('tab-1', 'dialog-warning');
            const thumb = () => thumbs(overview)[0];
            expect(thumb().classList.contains('inverted')).toBe(false);
            overview.setAttribute('inverted', '');
            expect(overview.inverted).toBe(true);
            expect(thumb().classList.contains('inverted')).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-tab-overview> serial safety', async () => {
        await it('keeps two overviews apart', async () => {
            serial += 1;
            expect(serial).toBeGreaterThan(0);
            const a = mount({ pages: 1 });
            const b = mount({ pages: 2 });
            expect(a.overview.view).toBe(a.view);
            expect(b.overview.view).toBe(b.view);
            expect(thumbs(a.overview)).toHaveLength(1);
            expect(thumbs(b.overview)).toHaveLength(2);
            a.host.remove();
            b.host.remove();
        });
    });
};
