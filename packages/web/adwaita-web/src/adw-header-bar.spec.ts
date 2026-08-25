// DOM-level tests for <adw-header-bar>'s title.
//
// `title` must be OBSERVED, not read once at `connectedCallback`: a header bar tracking
// the open document keeps its construction-time title otherwise, and nothing notices
// because the attribute is still there and A title still renders.
//
// `Adw.HeaderBar` builds its centre from `title`/`subtitle` through a derived
// `AdwWindowTitle` bound to the properties, unless a `title-widget` replaces it — the
// either/or the `slot="center"` case below asserts.

import { describe, expect, it } from '@gjsify/unit';

/** The rendered centre text of a mounted header bar. */
function centerText(bar: HTMLElement): string {
    return bar.querySelector('.adw-header-bar-center')?.textContent ?? '';
}

/** Mount a header bar with the given attributes and slotted children. */
function mountHeaderBar(attrs: Record<string, string>, slotted: readonly HTMLElement[] = []): HTMLElement {
    const bar = document.createElement('adw-header-bar');
    for (const [name, value] of Object.entries(attrs)) bar.setAttribute(name, value);
    for (const child of slotted) bar.appendChild(child);
    document.body.appendChild(bar);
    return bar;
}

/** A `slot="center"` title-widget, the equivalent of `Adw.HeaderBar:title-widget`. */
function centerWidget(text: string): HTMLElement {
    const widget = document.createElement('div');
    widget.setAttribute('slot', 'center');
    widget.id = 'url-entry';
    widget.textContent = text;
    return widget;
}

/** Remove every header bar a test mounted. */
function unmountAll(): void {
    for (const bar of Array.from(document.querySelectorAll('adw-header-bar'))) bar.remove();
    for (const host of Array.from(document.querySelectorAll('[data-header-bar-host]'))) host.remove();
}

/** The long title both geometry tests use, so the narrow bar really has to give way. */
const LONG_TITLE = 'A very very long document title indeed';

/**
 * A header bar of a fixed width, one start button and two end buttons.
 *
 * The asymmetry is the point: it is what tells "centred on the BAR" apart from
 * "centred in the space the buttons left over".
 */
function mountSizedHeaderBar(width: number): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute('data-header-bar-host', '');
    host.style.width = `${width}px`;
    document.body.appendChild(host);

    const bar = document.createElement('adw-header-bar');
    bar.setAttribute('title', LONG_TITLE);
    for (const [slot, count] of [
        ['start', 1],
        ['end', 2],
    ] as const) {
        for (let i = 0; i < count; i++) {
            const button = document.createElement('button');
            button.className = 'adw-header-btn';
            button.setAttribute('slot', slot);
            button.textContent = '+';
            bar.appendChild(button);
        }
    }
    // The bar enters the document last, so this geometry is measured on the PARSE-TIME
    // path. It used to be the only path that worked — the sections were built in
    // `connectedCallback` from a one-shot snapshot — and that is no longer a constraint:
    // `slotted-children.spec.ts` requires the appended path to place a child identically.
    host.appendChild(bar);
    return bar;
}

/** The rect of one part of a mounted header bar. */
function rectOf(bar: HTMLElement, selector: string): DOMRect {
    return (bar.querySelector(selector) as HTMLElement).getBoundingClientRect();
}

export const AdwHeaderBarTest = async () => {
    await describe('<adw-header-bar> title', async () => {
        await it('renders the title it was created with', () => {
            const bar = mountHeaderBar({ title: 'Documents' });
            expect(centerText(bar)).toBe('Documents');
            unmountAll();
        });

        await it('follows a LATER write, instead of freezing at connect time', () => {
            const bar = mountHeaderBar({ title: 'Documents' });
            bar.setAttribute('title', 'Pictures');
            expect(centerText(bar)).toBe('Pictures');
            unmountAll();
        });

        await it('clears when the attribute is removed', () => {
            const bar = mountHeaderBar({ title: 'Documents' });
            bar.removeAttribute('title');
            expect(centerText(bar)).toBe('');
            unmountAll();
        });

        await it('a title set before the element is connected still lands', () => {
            const bar = document.createElement('adw-header-bar');
            bar.setAttribute('title', 'Early');
            document.body.appendChild(bar);
            expect(centerText(bar)).toBe('Early');
            unmountAll();
        });

        await it('a slot="center" widget wins, and a title write does not overwrite it', () => {
            const bar = mountHeaderBar({ title: 'Ignored' }, [centerWidget('example.org')]);
            expect(bar.querySelector('#url-entry')).toBeTruthy();
            expect(centerText(bar)).toBe('example.org');

            bar.setAttribute('title', 'Still ignored');
            expect(centerText(bar)).toBe('example.org');
            unmountAll();
        });
    });

    // The centre is the `<adw-window-title>` Adw.HeaderBar itself derives, so the three
    // rules that element holds through @gjsify/adwaita-core reach the header bar too.
    // None of them did while the centre was a bare span.
    await describe('<adw-header-bar> derives an <adw-window-title>', async () => {
        await it('builds one rather than a bare span', () => {
            const bar = mountHeaderBar({ title: 'Documents' });
            expect(bar.querySelector('adw-window-title')).toBeTruthy();
            unmountAll();
        });

        await it('renders a subtitle, which it could not before', () => {
            const bar = mountHeaderBar({ title: 'Documents', subtitle: '12 items' });
            expect(centerText(bar)).toContain('Documents');
            expect(centerText(bar)).toContain('12 items');
            unmountAll();
        });

        await it('hides the title line when the title is empty — the blank-line bug', () => {
            // adw-window-title.c:207-208. A header bar with only a subtitle used to
            // reserve an empty line above it, because the span was always there.
            const bar = mountHeaderBar({ title: '', subtitle: 'Loading…' });
            const titleEl = bar.querySelector('.adw-window-title-title') as HTMLElement | null;
            expect(titleEl?.hidden).toBe(true);
            unmountAll();
        });

        await it('a subtitle survives a title write', () => {
            const bar = mountHeaderBar({ title: 'Documents', subtitle: '12 items' });
            bar.setAttribute('title', 'Pictures');
            expect(centerText(bar)).toContain('Pictures');
            expect(centerText(bar)).toContain('12 items');
            unmountAll();
        });
    });

    // `Adw.HeaderBar` lays its three sections out with a `GtkCenterBox`
    // (adw-header-bar.c:992), whose two rules pull in opposite directions and were
    // each broken on their own once. Both are asserted here, because a fix for
    // either one is exactly what breaks the other:
    //
    //   - the centre is centred on the WHOLE bar, not in the space the sides left
    //     over, so a bar with unequal sides still shows its title in the middle;
    //   - `shrink_center_last` is FALSE, so the centre is clamped to
    //     `size - (start.natural + end.natural)` and pushed in from either side
    //     (gtkcenterlayout.c:155-157). The TITLE gives way, never the buttons.
    await describe('<adw-header-bar> centre placement (GtkCenterBox)', async () => {
        await it('centres the title on the BAR even when the two sides differ', () => {
            const bar = mountSizedHeaderBar(600);
            const barBox = bar.getBoundingClientRect();
            const start = rectOf(bar, '.adw-header-bar-start');
            const end = rectOf(bar, '.adw-header-bar-end');
            const title = rectOf(bar, '.adw-window-title-title');

            // The discriminator: with equal sides, centring on the bar and centring
            // between the buttons are the same answer and this proves nothing.
            expect(Math.round(end.width) > Math.round(start.width)).toBe(true);

            const off = Math.abs((title.left + title.right) / 2 - (barBox.left + barBox.right) / 2);
            expect(off <= 1).toBe(true);
            unmountAll();
        });

        await it('ellipsizes instead of painting the title over the buttons', () => {
            const bar = mountSizedHeaderBar(260);
            const barBox = bar.getBoundingClientRect();
            const start = rectOf(bar, '.adw-header-bar-start');
            const end = rectOf(bar, '.adw-header-bar-end');
            const centre = rectOf(bar, '.adw-header-bar-center');
            const titleEl = bar.querySelector('.adw-window-title-title') as HTMLElement;

            // The discriminator: the untruncated title really is wider than the whole
            // bar, so there is a collision to avoid in the first place.
            expect(titleEl.scrollWidth > Math.round(barBox.width)).toBe(true);

            // A centred grid item is sized `fit-content`, whose floor is its own
            // min-content — the whole `nowrap` string. That drew the centre section
            // 277px wide in a 260px bar, starting outside it and running over all
            // three buttons. Stretched into its track it can only be the leftover.
            expect(centre.left >= start.right - 0.5).toBe(true);
            expect(centre.right <= end.left + 0.5).toBe(true);
            expect(centre.left >= barBox.left - 0.5 && centre.right <= barBox.right + 0.5).toBe(true);
            expect(titleEl.scrollWidth > titleEl.clientWidth).toBe(true);
            unmountAll();
        });
    });
};
