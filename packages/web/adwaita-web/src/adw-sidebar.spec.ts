// DOM-level conformance tests for <adw-sidebar>, driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The two renderers used to carry independent selection logic, and it had
// drifted apart AND away from libadwaita: `selected = 5` on a 3-item sidebar
// gave "no selection" in GTK, `2` here (it clamped to the last row) and `0` on
// NativeScript (it dropped the write). This element also keyed section headers
// off the DECLARATION index, so an empty leading section drew a stray separator
// and cost the next section its `.first` flush-to-top padding. Nothing failed,
// because nothing compared them. This suite is that comparison.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwSidebarItemSpec, AdwSidebarSectionSpec } from '@gjsify/adwaita-core';
import {
    SIDEBAR_ACTIVATION_VECTORS,
    SIDEBAR_CLAMP_VECTORS,
    SIDEBAR_FILTER_VECTORS,
    SIDEBAR_ITEM_FLAG_VECTORS,
    SIDEBAR_MODEL_VECTORS,
    SIDEBAR_MODE_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { AdwSidebar } from './elements/adw-sidebar.js';

/**
 * Mount a sidebar built from DECLARED children, the way an author writes it —
 * the element consumes them at connect time, so they all have to exist before
 * the host is appended.
 */
function mountSidebar(
    sections: ReadonlyArray<AdwSidebarSectionSpec>,
    attributes: { mode?: string; selected?: string } = {},
): { sidebar: AdwSidebar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const sidebar = document.createElement('adw-sidebar') as AdwSidebar;
    if (attributes.mode !== undefined) sidebar.setAttribute('mode', attributes.mode);
    if (attributes.selected !== undefined) sidebar.setAttribute('selected', attributes.selected);

    for (const section of sections) {
        const sectionEl = document.createElement('adw-sidebar-section');
        if (section.title !== undefined) sectionEl.setAttribute('title', section.title);

        for (const item of section.items) {
            sectionEl.appendChild(createItem(item));
        }
        sidebar.appendChild(sectionEl);
    }

    host.appendChild(sidebar);
    return { sidebar, host };
}

function createItem(item: AdwSidebarItemSpec): HTMLElement {
    const el = document.createElement('adw-sidebar-item');
    el.setAttribute('title', item.title);
    if (item.subtitle !== undefined) el.setAttribute('subtitle', item.subtitle);
    if (item.iconName !== undefined) el.setAttribute('icon-name', item.iconName);
    if (item.enabled === false) el.setAttribute('disabled', '');
    if (item.visible === false) el.setAttribute('hidden', '');
    return el;
}

/** The rendered rows, in render order. */
function rowsOf(sidebar: AdwSidebar): HTMLButtonElement[] {
    return Array.from(sidebar.querySelectorAll('.adw-sidebar-item')) as HTMLButtonElement[];
}

/** The rendered headers, reduced to the three things the C source derives. */
function headersOf(sidebar: AdwSidebar): { kind: string; title: string; first: boolean }[] {
    return Array.from(sidebar.querySelectorAll('.adw-sidebar-section-header')).map((el) => ({
        kind: el.classList.contains('has-title') ? 'title' : 'separator',
        title: el.querySelector('.adw-sidebar-section-heading')?.textContent ?? '',
        first: el.classList.contains('first'),
    }));
}

/** A sidebar of `count` plain rows — the shape the clamp vectors are stated over. */
function countedSections(count: number): AdwSidebarSectionSpec[] {
    if (count === 0) return [];
    return [{ items: Array.from({ length: count }, (_, i) => ({ title: `Item ${i}` })) }];
}

export const AdwSidebarTest = async () => {
    await describe('adw-sidebar selection bounds (libadwaita conformance vectors)', async () => {
        for (const { index, count, selected, rule } of SIDEBAR_CLAMP_VECTORS) {
            await it(`selected="${index}" on ${count} rows → ${selected} — ${rule}`, () => {
                const { sidebar, host } = mountSidebar(countedSections(count), { selected: String(index) });

                expect(sidebar.selected).toBe(selected);
                // The attribute is normalised back, so it never claims an index
                // the property does not report.
                expect(sidebar.getAttribute('selected')).toBe(String(selected));
                expect(rowsOf(sidebar).filter((row) => row.classList.contains('selected'))).toHaveLength(
                    selected === -1 ? 0 : 1,
                );

                host.remove();
            });
        }

        await it('auto-selects the first row when no index is declared', () => {
            const { sidebar, host } = mountSidebar(countedSections(3));
            expect(sidebar.selected).toBe(0);
            expect(rowsOf(sidebar)[0]!.classList.contains('selected')).toBe(true);
            host.remove();
        });

        await it('notifies on a programmatic change, not only on a click', () => {
            const { sidebar, host } = mountSidebar(countedSections(3));
            const seen: { selected: number; interactive: boolean }[] = [];
            sidebar.addEventListener('notify::selected', (event) => {
                seen.push((event as CustomEvent).detail as { selected: number; interactive: boolean });
            });

            sidebar.selected = 2;
            expect(seen).toHaveLength(1);
            expect(seen[0]!.selected).toBe(2);
            expect(seen[0]!.interactive).toBe(false);

            host.remove();
        });
    });

    await describe('adw-sidebar rows + headers (libadwaita conformance vectors)', async () => {
        for (const vector of SIDEBAR_MODEL_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { sidebar, host } = mountSidebar(vector.sections);

                expect(rowsOf(sidebar)).toHaveLength(vector.count);
                expect(
                    rowsOf(sidebar).map((row) => row.querySelector('.adw-sidebar-item-title')?.textContent ?? ''),
                ).toStrictEqual(vector.flat.map((entry) => entry.title));
                expect(headersOf(sidebar)).toStrictEqual(
                    vector.headers.map((header) => ({
                        kind: header.kind as string,
                        title: header.title,
                        first: header.first,
                    })),
                );

                host.remove();
            });
        }

        await it('draws no section container for a section that renders no rows', () => {
            // The old element appended a header AND an empty `.adw-sidebar-section`
            // per DECLARED section, which in page mode is a visible empty card.
            const { sidebar, host } = mountSidebar([{ title: 'Empty', items: [] }, { items: [{ title: 'A' }] }]);
            expect(sidebar.querySelectorAll('.adw-sidebar-section')).toHaveLength(1);
            expect(headersOf(sidebar)).toHaveLength(0);
            host.remove();
        });
    });

    await describe('adw-sidebar item labels (string_is_not_empty bindings)', async () => {
        for (const vector of SIDEBAR_ITEM_FLAG_VECTORS) {
            await it(`${JSON.stringify(vector.item)} — ${vector.rule}`, () => {
                const { sidebar, host } = mountSidebar([{ items: [vector.item] }]);
                const row = rowsOf(sidebar)[0]!;

                expect((row.querySelector('.adw-sidebar-item-title') as HTMLElement).hidden).toBe(!vector.titleVisible);
                expect((row.querySelector('.adw-sidebar-item-subtitle') as HTMLElement).hidden).toBe(
                    !vector.subtitleVisible,
                );
                expect((row.querySelector('.adw-sidebar-item-icon') as HTMLElement).hidden).toBe(!vector.iconVisible);

                host.remove();
            });
        }
    });

    await describe('adw-sidebar activation (row-selected then row-activated)', async () => {
        for (const vector of SIDEBAR_ACTIVATION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { sidebar, host } = mountSidebar(vector.sections);
                sidebar.selected = vector.initialSelected;

                const activations: number[] = [];
                const notifications: number[] = [];
                sidebar.addEventListener('activated', (event) => {
                    activations.push(((event as CustomEvent).detail as { index: number }).index);
                });
                sidebar.addEventListener('notify::selected', (event) => {
                    notifications.push(((event as CustomEvent).detail as { selected: number }).selected);
                });

                const row = rowsOf(sidebar)[vector.activate];
                if (row) row.click();
                else expect(vector.activated).toBe(false);

                expect(activations).toHaveLength(vector.activated ? 1 : 0);
                expect(notifications).toHaveLength(vector.selectionChanged ? 1 : 0);
                expect(sidebar.selected).toBe(vector.selected);

                host.remove();
            });
        }

        await it('re-clicking the selected row still fires activated — the split-view reveal', () => {
            const { sidebar, host } = mountSidebar([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            const activations: number[] = [];
            sidebar.addEventListener('activated', () => activations.push(1));

            rowsOf(sidebar)[0]!.click();
            rowsOf(sidebar)[0]!.click();
            expect(activations).toHaveLength(2);
            expect(sidebar.selected).toBe(0);

            host.remove();
        });

        await it('tags a click as interactive and a property write as not', () => {
            const { sidebar, host } = mountSidebar([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            const flags: boolean[] = [];
            sidebar.addEventListener('notify::selected', (event) => {
                flags.push(((event as CustomEvent).detail as { interactive: boolean }).interactive);
            });

            rowsOf(sidebar)[1]!.click();
            sidebar.selected = 0;
            expect(flags).toStrictEqual([true, false]);

            host.remove();
        });
    });

    await describe('adw-sidebar filter + empty state (Adw.Sidebar:filter / update_placeholder)', async () => {
        for (const vector of SIDEBAR_FILTER_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const { sidebar, host } = mountSidebar(vector.sections);
                sidebar.filter = (item) => vector.keepTitles.includes(item.title);

                expect(rowsOf(sidebar)).toHaveLength(vector.visibleIndices.length);
                expect(headersOf(sidebar)).toStrictEqual(
                    vector.headers.map((header) => ({
                        kind: header.kind as string,
                        title: header.title,
                        first: header.first,
                    })),
                );
                expect(sidebar.classList.contains('empty')).toBe(vector.isEmpty);

                host.remove();
            });
        }

        await it('keeps the selection index in the UNFILTERED space', () => {
            const { sidebar, host } = mountSidebar([{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }]);
            sidebar.selected = 2;
            sidebar.filter = (item) => item.title !== 'A';

            expect(sidebar.selected).toBe(2);
            expect(sidebar.selectedItem?.title).toBe('C');
            expect(rowsOf(sidebar)).toHaveLength(2);
            expect(rowsOf(sidebar)[1]!.classList.contains('selected')).toBe(true);

            host.remove();
        });
    });

    await describe('adw-sidebar mode (adw_sidebar_set_mode)', async () => {
        for (const { mode, selectionVisible, rule } of SIDEBAR_MODE_VECTORS) {
            await it(`${mode} paints the selection: ${selectionVisible} — ${rule}`, () => {
                const { sidebar, host } = mountSidebar(countedSections(3), { mode, selected: '1' });

                expect(sidebar.mode).toBe(mode);
                expect(sidebar.selected).toBe(1);
                expect(rowsOf(sidebar)[1]!.classList.contains('selected')).toBe(selectionVisible);
                // Tracked either way — aria still reports which item is current.
                expect(rowsOf(sidebar)[1]!.getAttribute('aria-selected')).toBe('true');

                host.remove();
            });
        }

        await it('keeps the selection across a mode switch and back', () => {
            const { sidebar, host } = mountSidebar(countedSections(3), { selected: '2' });

            sidebar.mode = 'page';
            expect(sidebar.selected).toBe(2);
            expect(rowsOf(sidebar)[2]!.classList.contains('selected')).toBe(false);

            sidebar.mode = 'sidebar';
            expect(sidebar.selected).toBe(2);
            expect(rowsOf(sidebar)[2]!.classList.contains('selected')).toBe(true);

            host.remove();
        });
    });

    await describe('adw-sidebar live model changes', async () => {
        await it('rebuilds when the sections are replaced, re-running the 0 → n auto-select', () => {
            const { sidebar, host } = mountSidebar([{ items: [{ title: 'A' }, { title: 'B' }] }]);
            sidebar.selected = 1;

            sidebar.sections = [{ title: 'New', items: [{ title: 'X' }, { title: 'Y' }, { title: 'Z' }] }];
            expect(rowsOf(sidebar)).toHaveLength(3);
            expect(sidebar.selected).toBe(0);
            expect(headersOf(sidebar)).toStrictEqual([{ kind: 'title', title: 'New', first: true }]);

            host.remove();
        });

        await it('follows a declared item attribute change without touching the selection', () => {
            // <adw-sidebar-item> declared `observedAttributes` with no
            // attributeChangedCallback behind it, so every post-construction
            // change was silently lost. The declared element is detached once
            // consumed, so the link back to its spec cannot be a DOM lookup.
            const declared = createItem({ title: 'A' });
            const sectionEl = document.createElement('adw-sidebar-section');
            sectionEl.append(declared, createItem({ title: 'B' }));

            const host = document.createElement('div');
            document.body.appendChild(host);
            const sidebar = document.createElement('adw-sidebar') as AdwSidebar;
            sidebar.appendChild(sectionEl);
            host.appendChild(sidebar);

            sidebar.selected = 1;
            declared.setAttribute('title', 'Renamed');
            declared.setAttribute('icon-name', 'folder-symbolic');

            const row = rowsOf(sidebar)[0]!;
            expect(row.querySelector('.adw-sidebar-item-title')?.textContent).toBe('Renamed');
            expect((row.querySelector('.adw-sidebar-item-icon') as HTMLElement).hidden).toBe(false);
            expect(sidebar.selected).toBe(1);

            host.remove();
        });
    });
};
