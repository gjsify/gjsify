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
};
