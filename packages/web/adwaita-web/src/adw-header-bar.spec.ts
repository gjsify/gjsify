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
};
